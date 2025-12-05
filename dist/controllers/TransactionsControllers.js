"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsController = void 0;
const crypto_1 = require("crypto");
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const TransactionsSchema_1 = require("./schemas/TransactionsSchema");
const normalizeCategory = (category) => {
    if (!category || category === "todas")
        return undefined;
    return category;
};
// interpreta "2025-12-01" como meia-noite UTC estável
const parseDateStringToUTC = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};
class TransactionsController {
    constructor() {
        // GET /transactions
        this.getTransactions = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId) {
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                }
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const { month: monthParam, year: yearParam, type: typeParam, category: categoryParam, responsible: responsibleParam, } = TransactionsSchema_1.GetTransactionsQuerySchema.parse(req.query);
                const effectiveType = typeParam ?? "todas";
                const now = new Date();
                const currentYear = now.getUTCFullYear();
                const currentMonth = now.getUTCMonth() + 1;
                const month = monthParam ? Number(monthParam) : currentMonth;
                const year = yearParam ? Number(yearParam) : currentYear;
                const category = normalizeCategory(categoryParam);
                const startDate = new Date(Date.UTC(year, month - 1, 1));
                const endDate = new Date(Date.UTC(year, month, 1));
                const expenseWhere = {
                    accountId,
                    date: {
                        gte: startDate,
                        lt: endDate,
                    },
                };
                const incomeWhere = {
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
                }
                else if (responsibleParam === "parceiro") {
                    expenseWhere.createdById = { not: userId };
                    incomeWhere.createdById = { not: userId };
                }
                const includeCreditCard = { creditCard: true };
                const shouldFetchExpenses = effectiveType === "todas" || effectiveType === "expense";
                const shouldFetchIncomes = effectiveType === "todas" || effectiveType === "income";
                const [expenses, incomes] = await Promise.all([
                    shouldFetchExpenses
                        ? database_1.prisma.expense.findMany({
                            where: expenseWhere,
                            include: includeCreditCard,
                            // ainda mantemos ordenação básica por data desc no banco
                            orderBy: { date: "desc" },
                        })
                        : Promise.resolve([]),
                    shouldFetchIncomes
                        ? database_1.prisma.income.findMany({
                            where: incomeWhere,
                            orderBy: { date: "desc" },
                        })
                        : Promise.resolve([]),
                ]);
                // 🔥 UNIFICA + ORDENA AQUI (data desc + createdAt desc)
                const merged = [
                    ...expenses.map((e) => ({ kind: "expense", data: e })),
                    ...incomes.map((i) => ({ kind: "income", data: i })),
                ];
                merged.sort((a, b) => {
                    // primeiro: data (field date do modelo)
                    const diffDate = b.data.date.getTime() - a.data.date.getTime();
                    if (diffDate !== 0)
                        return diffDate;
                    // segundo: createdAt (se existir nos modelos)
                    const aCreated = a.data.createdAt;
                    const bCreated = b.data.createdAt;
                    if (aCreated && bCreated) {
                        const diffCreated = bCreated.getTime() - aCreated.getTime();
                        if (diffCreated !== 0)
                            return diffCreated;
                    }
                    // fallback (mantém ordem se empatar tudo)
                    return 0;
                });
                const transactions = merged.map((item) => item.kind === "expense"
                    ? this.mapExpenseToDTO(item.data, userId)
                    : this.mapIncomeToDTO(item.data, userId));
                return res.json({ transactions });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /transactions/expenses
        this.createExpense = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const parsed = TransactionsSchema_1.CreateExpenseSchema.parse(req.body);
                const { value, category, description, date, paidBy, splitType, customSplit, paymentMethod, creditCardId, installments, currentInstallment, } = parsed;
                const safeDescription = description?.trim() ?? "";
                // valor da PARCELA
                const amount = value;
                const parsedDate = parseDateStringToUTC(date);
                const payer = paidBy === "parceiro" ? "partner" : "user";
                // ---------- SPLIT ----------
                let dbSplitType = "equal"; // equal, proportional, custom, solo
                let userAmount = null;
                let partnerAmount = null;
                if (splitType === "50-50") {
                    dbSplitType = "equal";
                    userAmount = Number((amount / 2).toFixed(2));
                    partnerAmount = Number((amount - userAmount).toFixed(2));
                }
                else if (splitType === "proporcional") {
                    dbSplitType = "proportional";
                    const { userAmount: u, partnerAmount: p } = await this.calculateProportionalSplit(user.accountId, parsedDate, amount);
                    userAmount = u;
                    partnerAmount = p;
                }
                else if (splitType === "customizada") {
                    dbSplitType = "custom";
                    const userPercent = customSplit?.you ?? 50;
                    userAmount = Number(((amount * userPercent) / 100).toFixed(2));
                    partnerAmount = Number((amount - userAmount).toFixed(2));
                    if (userPercent === 100 || userPercent === 0) {
                        dbSplitType = "solo";
                    }
                }
                const dbPaymentMethod = paymentMethod === "cartao" ? "credit_card" : "money";
                let creditCardIdToUse = null;
                if (dbPaymentMethod === "credit_card") {
                    if (!creditCardId) {
                        throw new HttpError_1.HttpError(400, "Selecione um cartão para pagamento no crédito.");
                    }
                    const card = await database_1.prisma.creditCard.findFirst({
                        where: {
                            id: creditCardId,
                            accountId: user.accountId,
                        },
                    });
                    if (!card) {
                        throw new HttpError_1.HttpError(400, "Cartão inválido para esta conta.");
                    }
                    creditCardIdToUse = card.id;
                }
                const dbInstallments = typeof installments === "number" && installments > 1 ? installments : 1;
                const dbCurrentInstallment = typeof currentInstallment === "number" && currentInstallment >= 1
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
                    const installmentGroupId = (0, crypto_1.randomUUID)();
                    const createdExpenses = await database_1.prisma.$transaction(async (tx) => {
                        const results = [];
                        for (let i = 1; i <= dbInstallments; i++) {
                            const installmentDate = new Date(baseDateUTC);
                            installmentDate.setUTCMonth(installmentDate.getUTCMonth() + (i - 1));
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
                        transactions: createdExpenses.map((e) => this.mapExpenseToDTO(e, userId)),
                    });
                }
                // À vista / 1x
                const expense = await database_1.prisma.expense.create({
                    data: {
                        ...baseData,
                        date: parsedDate,
                        installments: dbInstallments,
                        currentInstallment: dbCurrentInstallment > dbInstallments
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
            }
            catch (err) {
                next(err);
            }
        };
        // PUT /transactions/expenses/:id
        this.updateExpense = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.expense.findFirst({
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
                const parsed = TransactionsSchema_1.UpdateExpenseSchema.parse(req.body);
                const { value, category, description, date, paidBy, splitType, customSplit, paymentMethod, creditCardId, installments, currentInstallment, scope, } = parsed;
                const amount = value;
                const parsedDate = parseDateStringToUTC(date);
                const safeDescription = description?.trim() ?? "";
                const payer = paidBy === "parceiro" ? "partner" : "user";
                // SPLIT
                let dbSplitType = "equal";
                let userAmount = null;
                let partnerAmount = null;
                if (splitType === "50-50") {
                    dbSplitType = "equal";
                    userAmount = Number((amount / 2).toFixed(2));
                    partnerAmount = Number((amount - userAmount).toFixed(2));
                }
                else if (splitType === "proporcional") {
                    dbSplitType = "proportional";
                    const { userAmount: u, partnerAmount: p } = await this.calculateProportionalSplit(existing.accountId, parsedDate, amount);
                    userAmount = u;
                    partnerAmount = p;
                }
                else if (splitType === "customizada") {
                    dbSplitType = "custom";
                    const userPercent = customSplit?.you ?? 50;
                    userAmount = Number(((amount * userPercent) / 100).toFixed(2));
                    partnerAmount = Number((amount - userAmount).toFixed(2));
                    if (userPercent === 100 || userPercent === 0) {
                        dbSplitType = "solo";
                    }
                }
                const dbPaymentMethod = paymentMethod === "cartao" ? "credit_card" : "money";
                let creditCardIdToUse = null;
                if (dbPaymentMethod === "credit_card") {
                    if (!creditCardId) {
                        throw new HttpError_1.HttpError(400, "Selecione um cartão para pagamento no crédito.");
                    }
                    const card = await database_1.prisma.creditCard.findFirst({
                        where: {
                            id: creditCardId,
                            accountId: existing.accountId,
                        },
                    });
                    if (!card) {
                        throw new HttpError_1.HttpError(400, "Cartão inválido para esta conta.");
                    }
                    creditCardIdToUse = card.id;
                }
                const dbInstallments = typeof installments === "number" && installments > 0
                    ? installments
                    : existing.installments ?? 1;
                const dbCurrentInstallment = typeof currentInstallment === "number" && currentInstallment >= 1
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
                    creditCardId: dbPaymentMethod === "credit_card" ? creditCardIdToUse : null,
                };
                const fullUpdateData = {
                    ...commonUpdateData,
                    date: parsedDate,
                    installments: dbInstallments,
                    currentInstallment: dbCurrentInstallment,
                };
                const shouldCascade = scope === "all" &&
                    existing.paymentMethod === "credit_card" &&
                    (existing.installments ?? 1) > 1 &&
                    !!existing.installmentGroupId;
                if (shouldCascade) {
                    await database_1.prisma.expense.updateMany({
                        where: {
                            accountId: existing.accountId,
                            installmentGroupId: existing.installmentGroupId,
                        },
                        data: commonUpdateData,
                    });
                    const one = await database_1.prisma.expense.findUnique({
                        where: { id: existing.id },
                        include: { creditCard: true },
                    });
                    return res.json({
                        message: "Todas as parcelas foram atualizadas com sucesso.",
                        transaction: one ? this.mapExpenseToDTO(one, userId) : null,
                    });
                }
                const updated = await database_1.prisma.expense.update({
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
            }
            catch (err) {
                next(err);
            }
        };
        // DELETE /transactions/expenses/:id
        this.deleteExpense = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.expense.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Despesa não encontrada." });
                }
                if (existing.installmentGroupId && (existing.installments ?? 1) > 1) {
                    await database_1.prisma.expense.deleteMany({
                        where: {
                            accountId: existing.accountId,
                            installmentGroupId: existing.installmentGroupId,
                        },
                    });
                    return res.status(200).json({
                        message: "Todas as parcelas dessa compra foram excluídas.",
                    });
                }
                await database_1.prisma.expense.delete({
                    where: { id: existing.id },
                });
                return res.status(204).send();
            }
            catch (err) {
                next(err);
            }
        };
        // POST /transactions/incomes
        this.createIncome = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const parsed = TransactionsSchema_1.CreateIncomeSchema.parse(req.body);
                const { value, category, description, date, receivedBy } = parsed;
                const safeDescription = description?.trim() ?? "";
                const amount = value;
                const parsedDate = parseDateStringToUTC(date);
                let owner = "user";
                if (receivedBy === "parceiro")
                    owner = "partner";
                if (receivedBy === "compartilhado")
                    owner = "shared";
                const income = await database_1.prisma.income.create({
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
            }
            catch (err) {
                next(err);
            }
        };
        // PUT /transactions/incomes/:id
        this.updateIncome = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.income.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Receita não encontrada." });
                }
                const parsed = TransactionsSchema_1.UpdateIncomeSchema.parse(req.body);
                const { value, category, description, date, receivedBy } = parsed;
                const safeDescription = description?.trim() ?? "";
                const amount = value;
                const parsedDate = parseDateStringToUTC(date);
                let owner = existing.owner;
                if (receivedBy === "voce")
                    owner = "user";
                if (receivedBy === "parceiro")
                    owner = "partner";
                if (receivedBy === "compartilhado")
                    owner = "shared";
                const updated = await database_1.prisma.income.update({
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
            }
            catch (err) {
                next(err);
            }
        };
        // DELETE /transactions/incomes/:id
        this.deleteIncome = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.income.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Receita não encontrada." });
                }
                await database_1.prisma.income.delete({
                    where: { id: existing.id },
                });
                return res.status(204).send();
            }
            catch (err) {
                next(err);
            }
        };
    }
    // ----------------- HELPERS -----------------
    mapExpenseToDTO(expense, currentUserId) {
        const dateStr = expense.date.toISOString().split("T")[0];
        const payerLabel = expense.payer === "partner" ? "Parceiro" : "Você";
        const amount = expense.amount;
        let userAmount = typeof expense.userAmount === "number" ? expense.userAmount : undefined;
        let partnerAmount = typeof expense.partnerAmount === "number"
            ? expense.partnerAmount
            : undefined;
        if (userAmount === undefined || partnerAmount === undefined) {
            if (expense.splitType === "solo") {
                if (expense.payer === "user") {
                    userAmount = amount;
                    partnerAmount = 0;
                }
                else {
                    userAmount = 0;
                    partnerAmount = amount;
                }
            }
            else {
                userAmount = Number((amount / 2).toFixed(2));
                partnerAmount = Number((amount - userAmount).toFixed(2));
            }
        }
        const paymentMethod = expense.paymentMethod === "credit_card" ? "card" : "cash";
        const installments = typeof expense.installments === "number" && expense.installments > 0
            ? expense.installments
            : 1;
        const currentInstallment = typeof expense.currentInstallment === "number" &&
            expense.currentInstallment > 0
            ? expense.currentInstallment
            : 1;
        const installmentStr = installments > 1 ? `${currentInstallment}/${installments}` : null;
        // responsável agora = quem pagou
        const responsible = payerLabel;
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
    mapIncomeToDTO(income, currentUserId) {
        const dateStr = income.date.toISOString().split("T")[0];
        let receivedBy = "Você";
        if (income.owner === "partner")
            receivedBy = "Parceiro";
        if (income.owner === "shared")
            receivedBy = "Compartilhado";
        // responsável = dono da receita
        let responsible = "Você";
        if (income.owner === "partner")
            responsible = "Parceiro";
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
    async calculateProportionalSplit(accountId, expenseDate, amount) {
        const year = expenseDate.getUTCFullYear();
        const month = expenseDate.getUTCMonth();
        const monthStart = new Date(Date.UTC(year, month, 1));
        const monthEnd = new Date(Date.UTC(year, month + 1, 1));
        const [userAgg, partnerAgg] = await Promise.all([
            database_1.prisma.income.aggregate({
                where: {
                    accountId,
                    owner: "user",
                    date: { gte: monthStart, lt: monthEnd },
                },
                _sum: { amount: true },
            }),
            database_1.prisma.income.aggregate({
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
exports.TransactionsController = TransactionsController;
