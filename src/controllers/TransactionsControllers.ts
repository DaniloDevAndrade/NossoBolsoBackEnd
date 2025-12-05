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
  date: string; // yyyy-MM-dd

  // quem criou esse registro (para debug, filtros, etc.)
  createdById: string;

  // responsabilidade calculada no back
  // (agora baseada em quem pagou / dono da receita, não em createdById)
  responsible: "Você" | "Parceiro";

  // income
  receivedBy?: "Você" | "Parceiro" | "Compartilhado";

  // expense
  paidBy?: "Você" | "Parceiro";
  youPay?: number;
  partnerPays?: number;
  paymentMethod?: "cash" | "card";
  cardId?: string | null;
  cardName?: string | null;
  cardDigits?: string | null;

  // parcelas
  installments?: number | null; // total de parcelas
  currentInstallment?: number | null; // parcela atual
  installment?: string | null; // "2/12"
};

const normalizeCategory = (category?: string) => {
  if (!category || category === "todas") return undefined;
  return category;
};

// interpreta "2025-12-01" como meia-noite UTC estável
const parseDateStringToUTC = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

export class TransactionsController {
  // GET /transactions
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
    });

    if (!user || !user.accountId) {
      throw new HttpError(
        400,
        "Usuário não possui conta financeira configurada."
      );
    }

    const accountId = user.accountId;

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
      expenseWhere.createdById = userId;
      incomeWhere.createdById = userId;
    } else if (responsibleParam === "parceiro") {
      expenseWhere.createdById = { not: userId };
      incomeWhere.createdById = { not: userId };
    }

    const includeCreditCard = { creditCard: true };

    const shouldFetchExpenses =
      effectiveType === "todas" || effectiveType === "expense";
    const shouldFetchIncomes =
      effectiveType === "todas" || effectiveType === "income";

    const [expenses, incomes] = await Promise.all([
      shouldFetchExpenses
        ? prisma.expense.findMany({
            where: expenseWhere,
            include: includeCreditCard,
            // ainda mantemos ordenação básica por data desc no banco
            orderBy: { date: "desc" },
          })
        : Promise.resolve([]),
      shouldFetchIncomes
        ? prisma.income.findMany({
            where: incomeWhere,
            orderBy: { date: "desc" },
          })
        : Promise.resolve([]),
    ]);

    // 🔥 UNIFICA + ORDENA AQUI (data desc + createdAt desc)
    const merged = [
      ...expenses.map((e) => ({ kind: "expense" as const, data: e })),
      ...incomes.map((i) => ({ kind: "income" as const, data: i })),
    ];

    merged.sort((a, b) => {
      // primeiro: data (field date do modelo)
      const diffDate =
        b.data.date.getTime() - a.data.date.getTime();
      if (diffDate !== 0) return diffDate;

      // segundo: createdAt (se existir nos modelos)
      const aCreated = (a.data as any).createdAt as Date | undefined;
      const bCreated = (b.data as any).createdAt as Date | undefined;

      if (aCreated && bCreated) {
        const diffCreated = bCreated.getTime() - aCreated.getTime();
        if (diffCreated !== 0) return diffCreated;
      }

      // fallback (mantém ordem se empatar tudo)
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

  // POST /transactions/expenses
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
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

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

      // valor da PARCELA
      const amount = value;
      const parsedDate = parseDateStringToUTC(date);

      const payer = paidBy === "parceiro" ? "partner" : "user";

      // ---------- SPLIT ----------
      let dbSplitType: string = "equal"; // equal, proportional, custom, solo
      let userAmount: number | null = null;
      let partnerAmount: number | null = null;

      if (splitType === "50-50") {
        dbSplitType = "equal";
        userAmount = Number((amount / 2).toFixed(2));
        partnerAmount = Number((amount - userAmount).toFixed(2));
      } else if (splitType === "proporcional") {
        dbSplitType = "proportional";

        const { userAmount: u, partnerAmount: p } =
          await this.calculateProportionalSplit(
            user.accountId,
            parsedDate,
            amount
          );

        userAmount = u;
        partnerAmount = p;
      } else if (splitType === "customizada") {
        dbSplitType = "custom";
        const userPercent = customSplit?.you ?? 50;
        userAmount = Number(((amount * userPercent) / 100).toFixed(2));
        partnerAmount = Number((amount - userAmount).toFixed(2));
        if (userPercent === 100 || userPercent === 0) {
          dbSplitType = "solo";
        }
      }

      const dbPaymentMethod =
        paymentMethod === "cartao" ? "credit_card" : "money";

      let creditCardIdToUse: string | null = null;

      if (dbPaymentMethod === "credit_card") {
        if (!creditCardId) {
          throw new HttpError(
            400,
            "Selecione um cartão para pagamento no crédito."
          );
        }

        const card = await prisma.creditCard.findFirst({
          where: {
            id: creditCardId,
            accountId: user.accountId,
          },
        });

        if (!card) {
          throw new HttpError(400, "Cartão inválido para esta conta.");
        }

        creditCardIdToUse = card.id;
      }

      const dbInstallments =
        typeof installments === "number" && installments > 1 ? installments : 1;

      const dbCurrentInstallment =
        typeof currentInstallment === "number" && currentInstallment >= 1
          ? currentInstallment
          : 1;

      const baseData = {
        accountId: user.accountId,
        createdById: user.id,
        description: safeDescription,
        amount,
        category,
        payer,
        splitType: dbSplitType,
        userAmount,
        partnerAmount,
        paymentMethod: dbPaymentMethod,
        creditCardId: creditCardIdToUse,
      };

      // CARTÃO + PARCELADO
      if (dbPaymentMethod === "credit_card" && dbInstallments > 1) {
        const baseDateUTC = parsedDate;
        const installmentGroupId = randomUUID();

        const createdExpenses = await prisma.$transaction(async (tx) => {
          const results: any[] = [];

          for (let i = 1; i <= dbInstallments; i++) {
            const installmentDate = new Date(baseDateUTC);
            installmentDate.setUTCMonth(
              installmentDate.getUTCMonth() + (i - 1)
            );

            const expense = await tx.expense.create({
              data: {
                ...baseData,
                date: installmentDate,
                installments: dbInstallments,
                currentInstallment: i,
                installmentGroupId,
              },
              include: {
                creditCard: true,
              },
            });

            results.push(expense);
          }

          return results;
        });

        return res.status(201).json({
          message: "Despesa parcelada criada com sucesso.",
          transaction: this.mapExpenseToDTO(createdExpenses[0], userId),
          transactions: createdExpenses.map((e) =>
            this.mapExpenseToDTO(e, userId)
          ),
        });
      }

      // À vista / 1x
      const expense = await prisma.expense.create({
        data: {
          ...baseData,
          date: parsedDate,
          installments: dbInstallments,
          currentInstallment:
            dbCurrentInstallment > dbInstallments
              ? dbInstallments
              : dbCurrentInstallment,
        },
        include: {
          creditCard: true,
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

  // PUT /transactions/expenses/:id
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
        include: {
          creditCard: true,
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
        scope,
      } = parsed;

      const amount = value;
      const parsedDate = parseDateStringToUTC(date);
      const safeDescription = description?.trim() ?? "";

      const payer = paidBy === "parceiro" ? "partner" : "user";

      // SPLIT
      let dbSplitType: string = "equal";
      let userAmount: number | null = null;
      let partnerAmount: number | null = null;

      if (splitType === "50-50") {
        dbSplitType = "equal";
        userAmount = Number((amount / 2).toFixed(2));
        partnerAmount = Number((amount - userAmount).toFixed(2));
      } else if (splitType === "proporcional") {
        dbSplitType = "proportional";

        const { userAmount: u, partnerAmount: p } =
          await this.calculateProportionalSplit(
            existing.accountId,
            parsedDate,
            amount
          );

        userAmount = u;
        partnerAmount = p;
      } else if (splitType === "customizada") {
        dbSplitType = "custom";
        const userPercent = customSplit?.you ?? 50;
        userAmount = Number(((amount * userPercent) / 100).toFixed(2));
        partnerAmount = Number((amount - userAmount).toFixed(2));
        if (userPercent === 100 || userPercent === 0) {
          dbSplitType = "solo";
        }
      }

      const dbPaymentMethod =
        paymentMethod === "cartao" ? "credit_card" : "money";

      let creditCardIdToUse: string | null = null;

      if (dbPaymentMethod === "credit_card") {
        if (!creditCardId) {
          throw new HttpError(
            400,
            "Selecione um cartão para pagamento no crédito."
          );
        }

        const card = await prisma.creditCard.findFirst({
          where: {
            id: creditCardId,
            accountId: existing.accountId,
          },
        });

        if (!card) {
          throw new HttpError(400, "Cartão inválido para esta conta.");
        }

        creditCardIdToUse = card.id;
      }

      const dbInstallments =
        typeof installments === "number" && installments > 0
          ? installments
          : existing.installments ?? 1;

      const dbCurrentInstallment =
        typeof currentInstallment === "number" && currentInstallment >= 1
          ? currentInstallment
          : existing.currentInstallment ?? 1;

      const commonUpdateData = {
        description: safeDescription,
        amount,
        category,
        payer,
        splitType: dbSplitType,
        userAmount,
        partnerAmount,
        paymentMethod: dbPaymentMethod,
        creditCardId:
          dbPaymentMethod === "credit_card" ? creditCardIdToUse : null,
      };

      const fullUpdateData = {
        ...commonUpdateData,
        date: parsedDate,
        installments: dbInstallments,
        currentInstallment: dbCurrentInstallment,
      };

      const shouldCascade =
        scope === "all" &&
        existing.paymentMethod === "credit_card" &&
        (existing.installments ?? 1) > 1 &&
        !!existing.installmentGroupId;

      if (shouldCascade) {
        await prisma.expense.updateMany({
          where: {
            accountId: existing.accountId,
            installmentGroupId: existing.installmentGroupId!,
          },
          data: commonUpdateData,
        });

        const one = await prisma.expense.findUnique({
          where: { id: existing.id },
          include: { creditCard: true },
        });

        return res.json({
          message: "Todas as parcelas foram atualizadas com sucesso.",
          transaction: one ? this.mapExpenseToDTO(one, userId) : null,
        });
      }

      const updated = await prisma.expense.update({
        where: { id: existing.id },
        data: fullUpdateData,
        include: {
          creditCard: true,
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

  // DELETE /transactions/expenses/:id
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

      if (existing.installmentGroupId && (existing.installments ?? 1) > 1) {
        await prisma.expense.deleteMany({
          where: {
            accountId: existing.accountId,
            installmentGroupId: existing.installmentGroupId,
          },
        });

        return res.status(200).json({
          message: "Todas as parcelas dessa compra foram excluídas.",
        });
      }

      await prisma.expense.delete({
        where: { id: existing.id },
      });

      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  };

  // POST /transactions/incomes
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
      });

      if (!user || !user.accountId) {
        throw new HttpError(
          400,
          "Usuário não possui conta financeira configurada."
        );
      }

      const parsed = CreateIncomeSchema.parse(req.body);

      const { value, category, description, date, receivedBy } = parsed;

      const safeDescription = description?.trim() ?? "";
      const amount = value;
      const parsedDate = parseDateStringToUTC(date);

      let owner: string = "user";
      if (receivedBy === "parceiro") owner = "partner";
      if (receivedBy === "compartilhado") owner = "shared";

      const income = await prisma.income.create({
        data: {
          accountId: user.accountId,
          createdById: user.id,
          description: safeDescription,
          amount,
          category,
          date: parsedDate,
          owner,
        },
      });

      return res.status(201).json({
        message: "Receita criado com sucesso.",
        transaction: this.mapIncomeToDTO(income, userId),
      });
    } catch (err) {
      next(err);
    }
  };

  // PUT /transactions/incomes/:id
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

      const parsed = UpdateIncomeSchema.parse(req.body);

      const { value, category, description, date, receivedBy } = parsed;

      const safeDescription = description?.trim() ?? "";
      const amount = value;
      const parsedDate = parseDateStringToUTC(date);

      let owner: string = existing.owner;
      if (receivedBy === "voce") owner = "user";
      if (receivedBy === "parceiro") owner = "partner";
      if (receivedBy === "compartilhado") owner = "shared";

      const updated = await prisma.income.update({
        where: { id: existing.id },
        data: {
          description: safeDescription,
          amount,
          category,
          date: parsedDate,
          owner,
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

  // DELETE /transactions/incomes/:id
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

  // ----------------- HELPERS -----------------

  private mapExpenseToDTO(expense: any, currentUserId: string): TransactionDTO {
    const dateStr = expense.date.toISOString().split("T")[0];

    const payerLabel: "Você" | "Parceiro" =
      expense.payer === "partner" ? "Parceiro" : "Você";

    const amount: number = expense.amount;

    let userAmount: number | undefined =
      typeof expense.userAmount === "number" ? expense.userAmount : undefined;
    let partnerAmount: number | undefined =
      typeof expense.partnerAmount === "number"
        ? expense.partnerAmount
        : undefined;

    if (userAmount === undefined || partnerAmount === undefined) {
      if (expense.splitType === "solo") {
        if (expense.payer === "user") {
          userAmount = amount;
          partnerAmount = 0;
        } else {
          userAmount = 0;
          partnerAmount = amount;
        }
      } else {
        userAmount = Number((amount / 2).toFixed(2));
        partnerAmount = Number((amount - userAmount).toFixed(2));
      }
    }

    const paymentMethod: "cash" | "card" =
      expense.paymentMethod === "credit_card" ? "card" : "cash";

    const installments: number =
      typeof expense.installments === "number" && expense.installments > 0
        ? expense.installments
        : 1;

    const currentInstallment: number =
      typeof expense.currentInstallment === "number" &&
      expense.currentInstallment > 0
        ? expense.currentInstallment
        : 1;

    const installmentStr =
      installments > 1 ? `${currentInstallment}/${installments}` : null;

    // responsável agora = quem pagou
    const responsible: "Você" | "Parceiro" = payerLabel;

    return {
      id: expense.id,
      type: "expense",
      description: expense.description,
      category: expense.category,
      value: amount,
      date: dateStr,
      createdById: expense.createdById,
      responsible,
      paidBy: payerLabel,
      youPay: userAmount,
      partnerPays: partnerAmount,
      paymentMethod,
      cardId: expense.creditCardId ?? null,
      cardName: expense.creditCard?.name ?? null,
      cardDigits: expense.creditCard?.lastDigits ?? null,
      installments,
      currentInstallment,
      installment: installmentStr,
    };
  }

  private mapIncomeToDTO(income: any, currentUserId: string): TransactionDTO {
    const dateStr = income.date.toISOString().split("T")[0];

    let receivedBy: "Você" | "Parceiro" | "Compartilhado" = "Você";
    if (income.owner === "partner") receivedBy = "Parceiro";
    if (income.owner === "shared") receivedBy = "Compartilhado";

    // responsável = dono da receita
    let responsible: "Você" | "Parceiro" = "Você";
    if (income.owner === "partner") responsible = "Parceiro";

    return {
      id: income.id,
      type: "income",
      description: income.description ?? "",
      category: income.category,
      value: income.amount,
      date: dateStr,
      createdById: income.createdById,
      responsible,
      receivedBy,
    };
  }

  // cálculo proporcional baseado na renda do mês
  private async calculateProportionalSplit(
    accountId: string,
    expenseDate: Date,
    amount: number
  ): Promise<{ userAmount: number; partnerAmount: number }> {
    const year = expenseDate.getUTCFullYear();
    const month = expenseDate.getUTCMonth();

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 1));

    const [userAgg, partnerAgg] = await Promise.all([
      prisma.income.aggregate({
        where: {
          accountId,
          owner: "user",
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
      prisma.income.aggregate({
        where: {
          accountId,
          owner: "partner",
          date: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const userIncome = userAgg._sum.amount ?? 0;
    const partnerIncome = partnerAgg._sum.amount ?? 0;
    const totalIncome = userIncome + partnerIncome;

    if (totalIncome <= 0) {
      const half = Number((amount / 2).toFixed(2));
      return {
        userAmount: half,
        partnerAmount: Number((amount - half).toFixed(2)),
      };
    }

    const userPercent = userIncome / totalIncome;
    const userAmount = Number((amount * userPercent).toFixed(2));
    const partnerAmount = Number((amount - userAmount).toFixed(2));

    return { userAmount, partnerAmount };
  }
}
