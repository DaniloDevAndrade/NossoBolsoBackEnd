import { Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { AuthedRequest } from "../types/AuthedRequest";
import { prisma } from "../database";
import { HttpError } from "../errors/HttpError";
import {
  CreateExpenseSchema,
  CreateIncomeSchema,
  GetTransactionsQuerySchema,
  UpdateExpenseSchema,
  UpdateIncomeSchema,
} from "./schemas/TransactionsSchema";

type TransactionType = "income" | "expense";

type TransactionDTO = {
  id: string;
  type: TransactionType;
  description: string;
  category: string;
  value: number;
  date: string;
  createdById: string;
  responsible: "Você" | "Parceiro";
  receivedBy?: "Você" | "Parceiro" | "Compartilhado";
  paidBy?: "Você" | "Parceiro";
  youPay?: number;
  partnerPays?: number;
  paymentMethod?: "cash" | "card";
  cardId?: string | null;
  cardName?: string | null;
  cardDigits?: string | null;
  installments?: number | null;
  currentInstallment?: number | null;
  installment?: string | null;
};

const normalizeCategory = (category?: string) => {
  if (!category || category === "todas") return undefined;
  return category;
};

const parseDateStringToUTC = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export class TransactionsController {
  getTransactions = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) {
        throw new HttpError(401, "Usuário não autenticado");
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!user || !user.accountId || !user.account) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const partner = user.account.users.find((u) => u.id !== userId) || null;
      const partnerId = partner?.id || null;

      const {
        month: monthParam,
        year: yearParam,
        type: typeParam,
        category: categoryParam,
        responsible: responsibleParam,
      } = GetTransactionsQuerySchema.parse(req.query);

      const effectiveType: "todas" | "income" | "expense" =
        (typeParam as any) ?? "todas";

      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const currentMonth = now.getUTCMonth() + 1;

      const month = monthParam ? Number(monthParam) : currentMonth;
      const year = yearParam ? Number(yearParam) : currentYear;

      const category = normalizeCategory(categoryParam);

      const startDate = new Date(Date.UTC(year, month - 1, 1));
      const endDate = new Date(Date.UTC(year, month, 1));

      const expenseWhere: any = {
        accountId,
        date: {
          gte: startDate,
          lt: endDate,
        },
      };

      const incomeWhere: any = {
        accountId,
        date: {
          gte: startDate,
          lt: endDate,
        },
      };

      if (category) {
        expenseWhere.category = category;
        incomeWhere.category = category;
      }

      if (responsibleParam === "voce") {
        expenseWhere.responsibleUserId = userId;
        incomeWhere.responsibleUserId = userId;
      } else if (responsibleParam === "parceiro" && partnerId) {
        expenseWhere.responsibleUserId = partnerId;
        incomeWhere.responsibleUserId = partnerId;
      }

      const includeExpense = {
        card: true,
      };

      const includeIncome = {};

      const shouldFetchExpenses =
        effectiveType === "todas" || effectiveType === "expense";
      const shouldFetchIncomes =
        effectiveType === "todas" || effectiveType === "income";

      const [expenses, incomes] = await Promise.all([
        shouldFetchExpenses
          ? prisma.expense.findMany({
              where: expenseWhere,
              include: includeExpense,
              orderBy: { date: "desc" },
            })
          : Promise.resolve([]),
        shouldFetchIncomes
          ? prisma.income.findMany({
              where: incomeWhere,
              include: includeIncome,
              orderBy: { date: "desc" },
            })
          : Promise.resolve([]),
      ]);

      const merged = [
        ...expenses.map((e) => ({ kind: "expense" as const, data: e })),
        ...incomes.map((i) => ({ kind: "income" as const, data: i })),
      ];

      merged.sort((a, b) => {
        const diffDate = b.data.date.getTime() - a.data.date.getTime();
        if (diffDate !== 0) return diffDate;
        const aCreated = (a.data as any).createdAt as Date | undefined;
        const bCreated = (b.data as any).createdAt as Date | undefined;
        if (aCreated && bCreated) {
          const diffCreated = bCreated.getTime() - aCreated.getTime();
          if (diffCreated !== 0) return diffCreated;
        }
        return 0;
      });

      const transactions: TransactionDTO[] = merged.map((item) =>
        item.kind === "expense"
          ? this.mapExpenseToDTO(item.data, userId)
          : this.mapIncomeToDTO(item.data, userId)
      );

      return res.json({ transactions });
    } catch (err) {
      next(err);
    }
  };

  createExpense = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!user || !user.accountId || !user.account) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const partner = user.account.users.find((u) => u.id !== userId) || null;
      const partnerId = partner?.id || null;

      const parsed = CreateExpenseSchema.parse(req.body);

      const {
        value,
        category,
        description,
        date,
        paidBy,
        splitType,
        customSplit,
        paymentMethod,
        creditCardId,
        installments,
        currentInstallment,
      } = parsed;

      const safeDescription = description?.trim() ?? "";
      const parsedDate = parseDateStringToUTC(date);

      const paidByCode = paidBy === "parceiro" ? "partner" : "you";

      let responsibleUserId: string | null = null;
      if (paidByCode === "you") {
        responsibleUserId = userId;
      } else if (paidByCode === "partner" && partnerId) {
        responsibleUserId = partnerId;
      } else {
        responsibleUserId = userId;
      }

      let youPay: number | null = null;
      let partnerPays: number | null = null;

      if (splitType === "50-50") {
        const half = Number((value / 2).toFixed(2));
        youPay = half;
        partnerPays = Number((value - half).toFixed(2));
      } else if (splitType === "proporcional") {
        const proportional = await this.calculateProportionalSplit(
          accountId,
          parsedDate,
          value
        );
        youPay = proportional.youPay;
        partnerPays = proportional.partnerPays;
      } else if (splitType === "customizada") {
        const userPercent = customSplit?.you ?? 50;
        const youVal = Number(((value * userPercent) / 100).toFixed(2));
        youPay = youVal;
        partnerPays = Number((value - youVal).toFixed(2));
      }

      const dbPaymentMethod =
        paymentMethod === "cartao" ? "card" : "cash";

      let cardId: string | null = null;

      if (dbPaymentMethod === "card") {
        if (!creditCardId) {
          throw new HttpError(
            400,
            "Selecione um cartão para pagamento no crédito."
          );
        }

        const card = await prisma.creditCard.findFirst({
          where: {
            id: creditCardId,
            accountId,
          },
        });

        if (!card) {
          throw new HttpError(400, "Cartão inválido para esta conta.");
        }

        cardId = card.id;
      }

      const totalInstallments =
        typeof installments === "number" && installments > 1
          ? installments
          : 1;

      let initialInstallment =
        typeof currentInstallment === "number" && currentInstallment >= 1
          ? currentInstallment
          : 1;

      if (initialInstallment > totalInstallments) {
        throw new HttpError(
          400,
          "Parcela atual não pode ser maior que o número total de parcelas."
        );
      }

      if (dbPaymentMethod === "card" && totalInstallments > 1) {
        const perInstallmentValue = Number(
          (value / totalInstallments).toFixed(2)
        );
        const perInstallmentYouPay =
          youPay != null
            ? Number((youPay / totalInstallments).toFixed(2))
            : null;
        const perInstallmentPartnerPays =
          partnerPays != null
            ? Number((partnerPays / totalInstallments).toFixed(2))
            : null;

        const created = await prisma.$transaction(async (tx) => {
          const results: any[] = [];

          for (
            let installmentNumber = initialInstallment;
            installmentNumber <= totalInstallments;
            installmentNumber++
          ) {
            const installmentDate = new Date(parsedDate);
            installmentDate.setUTCMonth(
              installmentDate.getUTCMonth() + (installmentNumber - 1)
            );

            const exp = await tx.expense.create({
              data: {
                accountId,
                createdById: userId,
                responsibleUserId,
                description: safeDescription,
                category,
                value: perInstallmentValue,
                date: installmentDate,
                paidBy: paidByCode,
                youPay: perInstallmentYouPay,
                partnerPays: perInstallmentPartnerPays,
                paymentMethod: dbPaymentMethod,
                cardId,
                installments: totalInstallments,
                currentInstallment: installmentNumber,
                installment: `${installmentNumber}/${totalInstallments}`,
              },
              include: {
                card: true,
              },
            });

            results.push(exp);
          }

          return results;
        });

        return res.status(201).json({
          message: "Despesa parcelada criada com sucesso.",
          transactions: created.map((e) =>
            this.mapExpenseToDTO(e, userId)
          ),
        });
      }

      const expense = await prisma.expense.create({
        data: {
          accountId,
          createdById: userId,
          responsibleUserId,
          description: safeDescription,
          category,
          value,
          date: parsedDate,
          paidBy: paidByCode,
          youPay,
          partnerPays,
          paymentMethod: dbPaymentMethod,
          cardId,
          installments: totalInstallments,
          currentInstallment: 1,
          installment: totalInstallments > 1 ? `1/${totalInstallments}` : null,
        },
        include: {
          card: true,
        },
      });

      return res.status(201).json({
        message: "Despesa criada com sucesso.",
        transaction: this.mapExpenseToDTO(expense, userId),
      });
    } catch (err) {
      next(err);
    }
  };

  updateExpense = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!user || !user.accountId || !user.account) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const partner = user.account.users.find((u) => u.id !== userId) || null;
      const partnerId = partner?.id || null;

      const existing = await prisma.expense.findFirst({
        where: {
          id,
          accountId,
        },
        include: {
          card: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: "Despesa não encontrada." });
      }

      const parsed = UpdateExpenseSchema.parse(req.body);

      const {
        value,
        category,
        description,
        date,
        paidBy,
        splitType,
        customSplit,
        paymentMethod,
        creditCardId,
        installments,
        currentInstallment,
      } = parsed;

      const safeDescription = description?.trim() ?? "";
      const parsedDate = parseDateStringToUTC(date);

      const paidByCode = paidBy === "parceiro" ? "partner" : "you";

      let responsibleUserId: string | null = null;
      if (paidByCode === "you") {
        responsibleUserId = userId;
      } else if (paidByCode === "partner" && partnerId) {
        responsibleUserId = partnerId;
      } else {
        responsibleUserId = userId;
      }

      let youPay: number | null = null;
      let partnerPays: number | null = null;

      if (splitType === "50-50") {
        const half = Number((value / 2).toFixed(2));
        youPay = half;
        partnerPays = Number((value - half).toFixed(2));
      } else if (splitType === "proporcional") {
        const proportional = await this.calculateProportionalSplit(
          accountId,
          parsedDate,
          value
        );
        youPay = proportional.youPay;
        partnerPays = proportional.partnerPays;
      } else if (splitType === "customizada") {
        const userPercent = customSplit?.you ?? 50;
        const youVal = Number(((value * userPercent) / 100).toFixed(2));
        youPay = youVal;
        partnerPays = Number((value - youVal).toFixed(2));
      }

      const dbPaymentMethod =
        paymentMethod === "cartao" ? "card" : "cash";

      let cardId: string | null = null;

      if (dbPaymentMethod === "card") {
        if (!creditCardId) {
          throw new HttpError(
            400,
            "Selecione um cartão para pagamento no crédito."
          );
        }

        const card = await prisma.creditCard.findFirst({
          where: {
            id: creditCardId,
            accountId,
          },
        });

        if (!card) {
          throw new HttpError(400, "Cartão inválido para esta conta.");
        }

        cardId = card.id;
      }

      const totalInstallments =
        typeof installments === "number" && installments > 0
          ? installments
          : existing.installments ?? 1;

      const currentInst =
        typeof currentInstallment === "number" && currentInstallment >= 1
          ? currentInstallment
          : existing.currentInstallment ?? 1;

      if (currentInst > totalInstallments) {
        throw new HttpError(
          400,
          "Parcela atual não pode ser maior que o número total de parcelas."
        );
      }

      const updated = await prisma.expense.update({
        where: { id: existing.id },
        data: {
          description: safeDescription,
          category,
          value,
          date: parsedDate,
          accountId,
          createdById: existing.createdById,
          responsibleUserId,
          paidBy: paidByCode,
          youPay,
          partnerPays,
          paymentMethod: dbPaymentMethod,
          cardId,
          installments: totalInstallments,
          currentInstallment: currentInst,
          installment:
            totalInstallments > 1 ? `${currentInst}/${totalInstallments}` : null,
        },
        include: {
          card: true,
        },
      });

      return res.json({
        message: "Despesa atualizada com sucesso.",
        transaction: this.mapExpenseToDTO(updated, userId),
      });
    } catch (err) {
      next(err);
    }
  };

  deleteExpense = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const existing = await prisma.expense.findFirst({
        where: {
          id,
          accountId: user.accountId,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: "Despesa não encontrada." });
      }

      await prisma.expense.delete({
        where: { id: existing.id },
      });

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  createIncome = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!user || !user.accountId || !user.account) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const partner = user.account.users.find((u) => u.id !== userId) || null;
      const partnerId = partner?.id || null;

      const parsed = CreateIncomeSchema.parse(req.body);

      const { value, category, description, date, receivedBy } = parsed;

      const safeDescription = description?.trim() ?? "";
      const parsedDate = parseDateStringToUTC(date);

      let receivedByCode: "you" | "partner" | "shared" = "you";
      if (receivedBy === "parceiro") receivedByCode = "partner";
      if (receivedBy === "compartilhado") receivedByCode = "shared";

      let responsibleUserId: string | null = null;
      if (receivedByCode === "you") {
        responsibleUserId = userId;
      } else if (receivedByCode === "partner" && partnerId) {
        responsibleUserId = partnerId;
      } else {
        responsibleUserId = null;
      }

      let youReceive: number | null = null;
      let partnerReceive: number | null = null;

      if (receivedByCode === "you") {
        youReceive = value;
        partnerReceive = 0;
      } else if (receivedByCode === "partner") {
        youReceive = 0;
        partnerReceive = value;
      } else {
        const half = Number((value / 2).toFixed(2));
        youReceive = half;
        partnerReceive = Number((value - half).toFixed(2));
      }

      const income = await prisma.income.create({
        data: {
          accountId,
          createdById: userId,
          responsibleUserId,
          description: safeDescription,
          category,
          value,
          date: parsedDate,
          receivedBy: receivedByCode,
          youReceive,
          partnerReceive,
        },
      });

      return res.status(201).json({
        message: "Receita criada com sucesso.",
        transaction: this.mapIncomeToDTO(income, userId),
      });
    } catch (err) {
      next(err);
    }
  };

  updateIncome = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: {
              users: true,
            },
          },
        },
      });

      if (!user || !user.accountId || !user.account) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const accountId = user.accountId;
      const partner = user.account.users.find((u) => u.id !== userId) || null;
      const partnerId = partner?.id || null;

      const existing = await prisma.income.findFirst({
        where: {
          id,
          accountId,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: "Receita não encontrada." });
      }

      const parsed = UpdateIncomeSchema.parse(req.body);

      const { value, category, description, date, receivedBy } = parsed;

      const safeDescription = description?.trim() ?? "";
      const parsedDate = parseDateStringToUTC(date);

      let receivedByCode: "you" | "partner" | "shared" = "you";
      if (receivedBy === "parceiro") receivedByCode = "partner";
      if (receivedBy === "compartilhado") receivedByCode = "shared";

      let responsibleUserId: string | null = null;
      if (receivedByCode === "you") {
        responsibleUserId = userId;
      } else if (receivedByCode === "partner" && partnerId) {
        responsibleUserId = partnerId;
      } else {
        responsibleUserId = null;
      }

      let youReceive: number | null = null;
      let partnerReceive: number | null = null;

      if (receivedByCode === "you") {
        youReceive = value;
        partnerReceive = 0;
      } else if (receivedByCode === "partner") {
        youReceive = 0;
        partnerReceive = value;
      } else {
        const half = Number((value / 2).toFixed(2));
        youReceive = half;
        partnerReceive = Number((value - half).toFixed(2));
      }

      const updated = await prisma.income.update({
        where: { id: existing.id },
        data: {
          description: safeDescription,
          category,
          value,
          date: parsedDate,
          accountId,
          createdById: existing.createdById,
          responsibleUserId,
          receivedBy: receivedByCode,
          youReceive,
          partnerReceive,
        },
      });

      return res.json({
        message: "Receita atualizada com sucesso.",
        transaction: this.mapIncomeToDTO(updated, userId),
      });
    } catch (err) {
      next(err);
    }
  };

  deleteIncome = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      if (!userId) throw new HttpError(401, "Usuário não autenticado");

      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const existing = await prisma.income.findFirst({
        where: {
          id,
          accountId: user.accountId,
        },
      });

      if (!existing) {
        return res.status(404).json({ message: "Receita não encontrada." });
      }

      await prisma.income.delete({
        where: { id: existing.id },
      });

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  private mapExpenseToDTO(expense: any, currentUserId: string): TransactionDTO {
    const dateStr = expense.date.toISOString().split("T")[0];

    let responsibleLabel: "Você" | "Parceiro" = "Você";
    if (expense.responsibleUserId && expense.responsibleUserId !== currentUserId) {
      responsibleLabel = "Parceiro";
    }

    let paidByLabel: "Você" | "Parceiro" = "Você";
    if (expense.paidBy === "partner") paidByLabel = "Parceiro";

    let youPay: number | undefined =
      typeof expense.youPay === "number" ? expense.youPay : undefined;
    let partnerPays: number | undefined =
      typeof expense.partnerPays === "number" ? expense.partnerPays : undefined;

    if (youPay === undefined || partnerPays === undefined) {
      const half = Number((expense.value / 2).toFixed(2));
      youPay = half;
      partnerPays = Number((expense.value - half).toFixed(2));
    }

    const paymentMethod: "cash" | "card" =
      expense.paymentMethod === "card" ? "card" : "cash";

    const installments: number | null =
      typeof expense.installments === "number"
        ? expense.installments
        : null;

    const currentInstallment: number | null =
      typeof expense.currentInstallment === "number"
        ? expense.currentInstallment
        : null;

    const installmentStr: string | null =
      expense.installment ?? (installments && currentInstallment
        ? `${currentInstallment}/${installments}`
        : null);

    return {
      id: expense.id,
      type: "expense",
      description: expense.description,
      category: expense.category,
      value: expense.value,
      date: dateStr,
      createdById: expense.createdById,
      responsible: responsibleLabel,
      paidBy: paidByLabel,
      youPay,
      partnerPays,
      paymentMethod,
      cardId: expense.cardId ?? null,
      cardName: expense.card?.name ?? null,
      cardDigits: expense.card?.lastDigits ?? null,
      installments,
      currentInstallment,
      installment: installmentStr,
    };
  }

  private mapIncomeToDTO(income: any, currentUserId: string): TransactionDTO {
    const dateStr = income.date.toISOString().split("T")[0];

    let receivedBy: "Você" | "Parceiro" | "Compartilhado" = "Você";
    if (income.receivedBy === "partner") receivedBy = "Parceiro";
    if (income.receivedBy === "shared") receivedBy = "Compartilhado";

    let responsible: "Você" | "Parceiro" = "Você";
    if (income.responsibleUserId && income.responsibleUserId !== currentUserId) {
      responsible = "Parceiro";
    }

    return {
      id: income.id,
      type: "income",
      description: income.description ?? "",
      category: income.category,
      value: income.value,
      date: dateStr,
      createdById: income.createdById,
      responsible,
      receivedBy,
    };
  }

  private async calculateProportionalSplit(
    accountId: string,
    expenseDate: Date,
    amount: number
  ): Promise<{ youPay: number; partnerPays: number }> {
    const year = expenseDate.getUTCFullYear();
    const month = expenseDate.getUTCMonth();

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 1));

    const incomes = await prisma.income.findMany({
      where: {
        accountId,
        date: {
          gte: monthStart,
          lt: monthEnd,
        },
      },
    });

    let userIncome = 0;
    let partnerIncome = 0;

    for (const inc of incomes) {
      if (inc.receivedBy === "you") {
        userIncome += inc.value;
      } else if (inc.receivedBy === "partner") {
        partnerIncome += inc.value;
      } else if (inc.receivedBy === "shared") {
        const half = inc.value / 2;
        userIncome += half;
        partnerIncome += half;
      }
    }

    const totalIncome = userIncome + partnerIncome;

    if (totalIncome <= 0) {
      const half = Number((amount / 2).toFixed(2));
      return {
        youPay: half,
        partnerPays: Number((amount - half).toFixed(2)),
      };
    }

    const userPercent = userIncome / totalIncome;
    const youPay = Number((amount * userPercent).toFixed(2));
    const partnerPays = Number((amount - youPay).toFixed(2));

    return { youPay, partnerPays };
  }
}
