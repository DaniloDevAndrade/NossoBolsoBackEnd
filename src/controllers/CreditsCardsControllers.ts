// src/controllers/CreditCardsController.ts
import { Response, NextFunction } from "express";
import { AuthedRequest } from "../types/AuthedRequest";
import { prisma } from "../database";
import { HttpError } from "../errors/HttpError";
import {
  CreateCreditCardSchema,
  GetCreditCardsQuerySchema,
  UpdateCreditCardSchema,
} from "./schemas/CreditCardsSchema";

type CardOwnerLabel = "Você" | "Parceiro";

type CreditCardDTO = {
  id: string;
  name: string;
  institution: string;
  lastDigits: string;
  limit: number;
  used: number;
  dueDay: number | null;
  closingDay: number | null;

  // 🔥 quem é o dono deste cartão
  owner: CardOwnerLabel;        // "Você" | "Parceiro" relativo a req.userId
  userId: string;               // id do usuário dono do cartão
  isCurrentUserOwner: boolean;  // true se card.userId === req.userId
};

type CardExpenseDTO = {
  id: string;
  description: string;
  category: string;
  value: number;
  date: string; // yyyy-MM-dd
  installment: string | null; // "2/12" ou null
  installmentGroupId: string | null;
  totalValue: number; // soma REAL de todas as parcelas da compra
};

export class CreditCardsController {
  // GET /credit-cards
  // Lista cartões da conta do usuário + total usado na FATURA do mês/ano (considerando closingDay).
  getCreditCards = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;

      const { month: monthParam, year: yearParam } =
        GetCreditCardsQuerySchema.parse(req.query);

      const now = new Date();
      const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
      const year = yearParam ? Number(yearParam) : now.getFullYear();

      // 👉 busca TODAS as despesas de cartão, depois filtra por fatura (billing month/year)
      const cards = await prisma.creditCard.findMany({
        where: {
          accountId,
        },
        include: {
          expenses: {
            where: {
              paymentMethod: "card", // 👈 bate com TransactionsController/schema
            },
          },
        },
      });

      const cardsDTO: CreditCardDTO[] = cards.map((card) => {
        // despesas que pertencem à FATURA (month/year) considerando closingDay
        const expensesOfInvoice = card.expenses.filter((exp) => {
          const { year: billYear, month: billMonth } =
            this.getBillingYearMonth(exp.date, card.closingDay);
          return billYear === year && billMonth === month;
        });

        const cardForDTO = {
          ...card,
          expenses: expensesOfInvoice,
        };

        return this.mapCardToDTO(cardForDTO, user.id);
      });

      return res.json({ cards: cardsDTO });
    } catch (err) {
      next(err);
    }
  };

  // GET /credit-cards/:id
  // Detalhe do cartão + despesas desse cartão na FATURA do mês/ano (considerando closingDay).
  getCreditCardDetails = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const { id } = req.params;

      const { month: monthParam, year: yearParam } =
        GetCreditCardsQuerySchema.parse(req.query);

      const now = new Date();
      const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
      const year = yearParam ? Number(yearParam) : now.getFullYear();

      // 👉 pega TODAS as despesas de cartão e depois filtra pela fatura
      const card = await prisma.creditCard.findFirst({
        where: {
          id,
          accountId,
        },
        include: {
          expenses: {
            where: {
              paymentMethod: "card", // 👈 aqui também
            },
          },
        },
      });

      if (!card) {
        throw new HttpError(404, "Cartão não encontrado.");
      }

      // despesas dessa fatura (month/year) considerando closingDay
      const expensesOfInvoice = card.expenses.filter((expense) => {
        const { year: billYear, month: billMonth } =
          this.getBillingYearMonth(expense.date, card.closingDay);
        return billYear === year && billMonth === month;
      });

      // 2) Descobre os grupos de parcelas PRESENTES nesta fatura
      const groupIds = Array.from(
        new Set(
          expensesOfInvoice
            .map((e) => e.installmentGroupId)
            .filter((v): v is string => !!v)
        )
      );

      // 3) Se houver grupos, busca TODAS as parcelas desses grupos (todos os meses)
      const totalsByGroup = new Map<string, number>();

      if (groupIds.length > 0) {
        const groupExpenses = await prisma.expense.findMany({
          where: {
            accountId,
            cardId: card.id, // 👈 schema usa cardId, não creditCardId
            installmentGroupId: { in: groupIds },
          },
        });

        for (const e of groupExpenses) {
          if (!e.installmentGroupId) continue;
          const prev = totalsByGroup.get(e.installmentGroupId) ?? 0;
          totalsByGroup.set(e.installmentGroupId, prev + (e.value ?? 0)); // 👈 value, não amount
        }
      }

      // 4) DTO do cartão (used = só fatura filtrada)
      const cardDTO = this.mapCardToDTO(
        { ...card, expenses: expensesOfInvoice },
        user.id
      );

      // 5) Mapeia as despesas da FATURA com total REAL da compra
      const expensesDTO: CardExpenseDTO[] = expensesOfInvoice
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((expense) => {
          const dateStr = expense.date.toISOString().split("T")[0];

          let installment: string | null = null;
          if (expense.installments && expense.installments > 1) {
            const current =
              typeof expense.currentInstallment === "number"
                ? expense.currentInstallment
                : 1;
            installment = `${current}/${expense.installments}`;
          }

          let totalValue: number;

          if (expense.installmentGroupId) {
            const totalFromMap = totalsByGroup.get(expense.installmentGroupId);
            if (typeof totalFromMap === "number") {
              totalValue = Number(totalFromMap.toFixed(2));
            } else {
              const totalInstallments =
                expense.installments && expense.installments > 0
                  ? expense.installments
                  : 1;
              totalValue = Number(
                (expense.value * totalInstallments).toFixed(2) // 👈 value
              );
            }
          } else {
            const totalInstallments =
              expense.installments && expense.installments > 0
                ? expense.installments
                : 1;
            totalValue = Number(
              (expense.value * totalInstallments).toFixed(2) // 👈 value
            );
          }

          return {
            id: expense.id,
            description: expense.description,
            category: expense.category,
            value: expense.value, // 👈 valor da PARCELA (value)
            date: dateStr,        // data REAL da compra
            installment,
            installmentGroupId: expense.installmentGroupId ?? null,
            totalValue,
          };
        });

      return res.json({
        card: cardDTO,
        expenses: expensesDTO,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /credit-cards
  createCreditCard = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const parsed = CreateCreditCardSchema.parse(req.body);

      const { ownerDb, userIdForCard } = await this.resolveCardOwner(
        accountId,
        user.id,
        parsed.owner
      );

      const card = await prisma.creditCard.create({
        data: {
          accountId,
          userId: userIdForCard,
          name: parsed.name.trim(),
          institution: parsed.institution, // já validado pelo Zod
          lastDigits: parsed.lastDigits.trim(),
          limit: parsed.limit,
          dueDay: parsed.dueDay,
          closingDay: parsed.closingDay ?? null,
          owner: ownerDb,
        },
        include: {
          expenses: {
            where: {
              paymentMethod: "card", // 👈 ajustado
            },
          },
        },
      });

      const dto: CreditCardDTO = this.mapCardToDTO(
        {
          ...card,
          expenses: card.expenses ?? [],
        },
        user.id
      );

      return res.status(201).json({
        message: "Cartão criado com sucesso.",
        card: dto,
      });
    } catch (err) {
      next(err);
    }
  };

  // PUT /credit-cards/:id
  updateCreditCard = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const { id } = req.params;

      const existing = await prisma.creditCard.findFirst({
        where: {
          id,
          accountId,
        },
      });

      if (!existing) {
        throw new HttpError(404, "Cartão não encontrado.");
      }

      const parsed = UpdateCreditCardSchema.parse(req.body);

      const dataToUpdate: any = {};

      if (parsed.name !== undefined) {
        dataToUpdate.name = parsed.name.trim();
      }

      if (parsed.institution !== undefined) {
        dataToUpdate.institution = parsed.institution;
      }

      if (parsed.lastDigits !== undefined) {
        dataToUpdate.lastDigits = parsed.lastDigits.trim();
      }

      if (parsed.limit !== undefined) {
        dataToUpdate.limit = parsed.limit;
      }

      if (parsed.dueDay !== undefined) {
        dataToUpdate.dueDay = parsed.dueDay;
      }

      if (parsed.closingDay !== undefined) {
        dataToUpdate.closingDay = parsed.closingDay;
      }

      if (parsed.owner !== undefined) {
        const { ownerDb, userIdForCard } = await this.resolveCardOwner(
          accountId,
          user.id,
          parsed.owner as "voce" | "parceiro"
        );
        dataToUpdate.owner = ownerDb;
        dataToUpdate.userId = userIdForCard;
      }

      const updated = await prisma.creditCard.update({
        where: { id: existing.id },
        data: dataToUpdate,
        include: {
          expenses: {
            where: {
              paymentMethod: "card", // 👈 ajustado
            },
          },
        },
      });

      const dto = this.mapCardToDTO(updated, user.id);

      return res.json({
        message: "Cartão atualizado com sucesso.",
        card: dto,
      });
    } catch (err) {
      next(err);
    }
  };

  // DELETE /credit-cards/:id
  deleteCreditCard = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const { id } = req.params;

      const existing = await prisma.creditCard.findFirst({
        where: {
          id,
          accountId,
        },
      });

      if (!existing) {
        throw new HttpError(404, "Cartão não encontrado.");
      }

      const hasExpenses = await prisma.expense.count({
        where: { cardId: existing.id }, // 👈 cardId, não creditCardId
      });

      if (hasExpenses > 0) {
        throw new HttpError(
          400,
          "Não é possível excluir um cartão com despesas vinculadas."
        );
      }

      await prisma.creditCard.delete({
        where: { id: existing.id },
      });

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // ---------- HELPERS ----------

  private async resolveCardOwner(
    accountId: string,
    currentUserId: string,
    ownerInput: "voce" | "parceiro"
  ): Promise<{ ownerDb: "user" | "partner"; userIdForCard: string }> {
    if (ownerInput === "voce") {
      return { ownerDb: "user", userIdForCard: currentUserId };
    }

    // "parceiro"
    const partner = await prisma.user.findFirst({
      where: {
        accountId,
        id: { not: currentUserId },
      },
      orderBy: { createdAt: "asc" },
    });

    if (!partner) {
      throw new HttpError(
        400,
        "Conta ainda não possui parceiro vinculado para atribuir o cartão."
      );
    }

    return { ownerDb: "partner", userIdForCard: partner.id };
  }

  private mapCardToDTO(card: any, currentUserId: string): CreditCardDTO {
    const used = Array.isArray(card.expenses)
      ? card.expenses.reduce(
          (sum: number, exp: any) => sum + (exp.value ?? 0), // 👈 value, não amount
          0
        )
      : 0;

    const isCurrentUserOwner = card.userId === currentUserId;
    const ownerLabel: CardOwnerLabel = isCurrentUserOwner ? "Você" : "Parceiro";

    return {
      id: card.id,
      name: card.name,
      institution: card.institution,
      lastDigits: card.lastDigits,
      limit: card.limit,
      used,
      dueDay: typeof card.dueDay === "number" ? card.dueDay : null,
      closingDay: typeof card.closingDay === "number" ? card.closingDay : null,
      owner: ownerLabel,
      userId: card.userId,
      isCurrentUserOwner,
    };
  }
  
  private getBillingYearMonth(
    date: Date,
    closingDay?: number | null
  ): { year: number; month: number } {
    let year = date.getUTCFullYear();
    let month = date.getUTCMonth() + 1; // 1..12
    const day = date.getUTCDate();

    if (
      typeof closingDay === "number" &&
      closingDay >= 1 &&
      closingDay <= 31
    ) {
      if (day > closingDay) {
        month += 1;
        if (month === 13) {
          month = 1;
          year += 1;
        }
      }
    }

    return { year, month };
  }
}
