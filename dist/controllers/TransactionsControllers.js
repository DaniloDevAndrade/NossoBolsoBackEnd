"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionsController = void 0;
const crypto_1 = require("crypto");
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const TransactionsSchema_1 = require("./schemas/TransactionsSchema");
const parseDateStringToUTC = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};
const clampDayToMonth = (year, month0, day) => {
    // month0 = 0..11
    const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
    return Math.min(day, lastDay);
};
const getFirstInvoiceDate = (purchaseDate, closingDay, dueDay) => {
    const purchaseDay = purchaseDate.getUTCDate();
    // dia da fatura: se tiver dueDay usa ele, senão usa o dia da compra
    const invoiceDay = typeof dueDay === "number" && dueDay >= 1 && dueDay <= 31
        ? dueDay
        : purchaseDay;
    let year = purchaseDate.getUTCFullYear();
    let month0 = purchaseDate.getUTCMonth(); // 0..11
    if (typeof closingDay === "number" &&
        closingDay >= 1 &&
        closingDay <= 31 &&
        purchaseDay >= closingDay) {
        // compra entrou APÓS (ou no) fechamento -> fatura começa no próximo mês
        month0 += 1;
        if (month0 >= 12) {
            month0 = 0;
            year += 1;
        }
    }
    const day = clampDayToMonth(year, month0, invoiceDay);
    return new Date(Date.UTC(year, month0, day));
};
const addMonthsKeepingDay = (baseDate, monthsToAdd) => {
    const baseYear = baseDate.getUTCFullYear();
    const baseMonth0 = baseDate.getUTCMonth();
    const baseDay = baseDate.getUTCDate();
    const totalMonths = baseMonth0 + monthsToAdd;
    const newYear = baseYear + Math.floor(totalMonths / 12);
    const newMonth0 = ((totalMonths % 12) + 12) % 12;
    const day = clampDayToMonth(newYear, newMonth0, baseDay);
    return new Date(Date.UTC(newYear, newMonth0, day));
};
class TransactionsController {
    constructor() {
        // =========================================================
        // GET /transactions
        // Filtro por mês/ano em cima de Expense.date / Income.date
        // (sempre data da COMPRA no caso de cartão)
        // =========================================================
        this.getTransactions = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId) {
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                }
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                    include: {
                        account: true,
                    },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const parsed = TransactionsSchema_1.GetTransactionsQuerySchema.parse(req.query);
                const { month, // number | undefined
                year, // number | undefined
                type, // "todas" | "income" | "expense" | undefined
                category, } = parsed;
                const hasMonthYear = typeof month === "number" && typeof year === "number";
                const expenseWhere = { accountId };
                const incomeWhere = { accountId };
                if (category) {
                    expenseWhere.category = category;
                    incomeWhere.category = category;
                }
                // type = undefined ou "todas" => busca os dois
                const shouldFetchExpenses = !type || type === "expense" || type === "todas";
                const shouldFetchIncomes = !type || type === "income" || type === "todas";
                const [expenses, incomes] = await Promise.all([
                    shouldFetchExpenses
                        ? database_1.prisma.expense.findMany({
                            where: expenseWhere,
                            include: { card: true },
                        })
                        : Promise.resolve([]),
                    shouldFetchIncomes
                        ? database_1.prisma.income.findMany({
                            where: incomeWhere,
                        })
                        : Promise.resolve([]),
                ]);
                const expenseDTOs = expenses.map((e) => this.mapExpenseToDTO(e, userId));
                const incomeDTOs = incomes.map((i) => this.mapIncomeToDTO(i, userId));
                let allDTOs = [...expenseDTOs, ...incomeDTOs];
                // 🔹 Filtro de mês/ano em cima de t.date (data da compra)
                if (hasMonthYear) {
                    allDTOs = allDTOs.filter((t) => {
                        if (!t.date)
                            return false;
                        const [yStr, mStr] = t.date.split("-");
                        const y = Number(yStr);
                        const m = Number(mStr);
                        if (!y || !m)
                            return false;
                        if (y !== year)
                            return false;
                        if (m !== month)
                            return false;
                        return true;
                    });
                }
                // 🔹 Ordenação: mais recente primeiro (data da compra)
                allDTOs.sort((a, b) => {
                    const dateA = new Date(a.date).getTime();
                    const dateB = new Date(b.date).getTime();
                    return dateB - dateA;
                });
                return res.json({
                    transactions: allDTOs,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // =========================================================
        // POST /transactions/expenses
        // Cria despesa. Para cartão parcelado:
        // - value = valor da PARCELA
        // - date = SEMPRE data da COMPRA para TODAS as parcelas
        // =========================================================
        this.createExpense = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
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
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const partner = user.account.users.find((u) => u.id !== userId) || null;
                const partnerId = partner?.id || null;
                const parsed = TransactionsSchema_1.CreateExpenseSchema.parse(req.body);
                const { value, category, description, date, // data da COMPRA
                paidBy, splitType, customSplit, paymentMethod, creditCardId, installments, } = parsed;
                const safeDescription = description?.trim() ?? "";
                const purchaseDate = parseDateStringToUTC(date); // data da compra
                const paidByCode = paidBy === "parceiro" ? "partner" : "you";
                let responsibleUserId = null;
                if (paidByCode === "you") {
                    responsibleUserId = userId;
                }
                else if (paidByCode === "partner" && partnerId) {
                    responsibleUserId = partnerId;
                }
                else {
                    responsibleUserId = userId;
                }
                const dbPaymentMethod = paymentMethod === "cartao" ? "card" : "cash";
                let cardId = null;
                let card = null;
                if (dbPaymentMethod === "card") {
                    if (!creditCardId) {
                        throw new HttpError_1.HttpError(400, "Selecione um cartão para pagamento no crédito.");
                    }
                    card = await database_1.prisma.creditCard.findFirst({
                        where: {
                            id: creditCardId,
                            accountId,
                        },
                    });
                    if (!card) {
                        throw new HttpError_1.HttpError(400, "Cartão inválido para esta conta.");
                    }
                    cardId = card.id;
                }
                const totalInstallments = typeof installments === "number" && installments > 1 ? installments : 1;
                const isCardParcelado = dbPaymentMethod === "card" && totalInstallments > 1;
                // -----------------------------
                // Valor base por PARCELA
                // -----------------------------
                // Regras:
                // - Se cartão parcelado: value (backend) = total da compra
                //   => perInstallmentValue = total / N
                // - Caso contrário: value é o valor da própria despesa (1x)
                const totalValue = value;
                const perInstallmentValue = isCardParcelado
                    ? Number((totalValue / totalInstallments).toFixed(2))
                    : totalValue;
                // -----------------------------
                // Split por parcela
                // -----------------------------
                let youPayPerInstallment = null;
                let partnerPaysPerInstallment = null;
                const baseForSplit = perInstallmentValue;
                if (splitType === "50-50") {
                    const half = Number((baseForSplit / 2).toFixed(2));
                    youPayPerInstallment = half;
                    partnerPaysPerInstallment = Number((baseForSplit - half).toFixed(2));
                }
                else if (splitType === "proporcional") {
                    // usa o mês da compra para calcular proporcional
                    const proportional = await this.calculateProportionalSplit(accountId, purchaseDate, baseForSplit);
                    youPayPerInstallment = proportional.youPay;
                    partnerPaysPerInstallment = proportional.partnerPays;
                }
                else if (splitType === "customizada") {
                    const userPercent = customSplit?.you ?? 50;
                    const youVal = Number(((baseForSplit * userPercent) / 100).toFixed(2));
                    youPayPerInstallment = youVal;
                    partnerPaysPerInstallment = Number((baseForSplit - youVal).toFixed(2));
                }
                // -----------------------------
                // Caso: CARTÃO + PARCELADO
                // -> cria N parcelas, uma por fatura
                // -----------------------------
                if (isCardParcelado && card) {
                    const installmentGroupId = (0, crypto_1.randomUUID)();
                    const firstInvoiceDate = getFirstInvoiceDate(purchaseDate, card.closingDay ?? null, card.dueDay ?? null);
                    const createdExpenses = await database_1.prisma.$transaction(async (tx) => {
                        const results = [];
                        for (let k = 1; k <= totalInstallments; k++) {
                            const installmentDate = k === 1
                                ? firstInvoiceDate
                                : addMonthsKeepingDay(firstInvoiceDate, k - 1);
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
                                    youPay: youPayPerInstallment,
                                    partnerPays: partnerPaysPerInstallment,
                                    paymentMethod: dbPaymentMethod,
                                    cardId,
                                    installments: totalInstallments,
                                    currentInstallment: k,
                                    installment: `${k}/${totalInstallments}`,
                                    installmentGroupId,
                                },
                                include: { card: true },
                            });
                            results.push(exp);
                        }
                        return results;
                    });
                    return res.status(201).json({
                        message: "Despesa parcelada criada com sucesso.",
                        transactions: createdExpenses.map((e) => this.mapExpenseToDTO(e, userId)),
                    });
                }
                // -----------------------------
                // Caso: NÃO é cartão parcelado
                // - vista / débito / pix
                // - cartão 1x
                // -> cria UMA despesa
                // -----------------------------
                const expense = await database_1.prisma.expense.create({
                    data: {
                        accountId,
                        createdById: userId,
                        responsibleUserId,
                        description: safeDescription,
                        category,
                        value: perInstallmentValue,
                        // aqui mantemos date = data da compra (ou data escolhida para cobrança única)
                        date: purchaseDate,
                        paidBy: paidByCode,
                        youPay: youPayPerInstallment,
                        partnerPays: partnerPaysPerInstallment,
                        paymentMethod: dbPaymentMethod,
                        cardId,
                        installments: totalInstallments, // normalmente 1
                        currentInstallment: 1,
                        installment: totalInstallments > 1 ? `1/${totalInstallments}` : null,
                        installmentGroupId: null,
                    },
                    include: { card: true },
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
        // =========================================================
        // PUT /transactions/expenses/:id
        // Mantém a mesma filosofia:
        // - date recebida é a data da parcela editada, MAS
        //   para simplificar, mantemos a mesma data para
        //   todas as parcelas (compra).
        // =========================================================
        this.updateExpense = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
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
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const partner = user.account.users.find((u) => u.id !== userId) || null;
                const partnerId = partner?.id || null;
                const existing = await database_1.prisma.expense.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                    include: { card: true },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Despesa não encontrada." });
                }
                const parsed = TransactionsSchema_1.UpdateExpenseSchema.parse(req.body);
                const { value, category, description, date, paidBy, splitType, customSplit, paymentMethod, creditCardId, installments, } = parsed;
                const scope = parsed.scope === "all" ? "all" : "single";
                const safeDescription = description?.trim() ?? "";
                const newDateStr = date; // string YYYY-MM-DD que veio no body
                const newDate = parseDateStringToUTC(newDateStr);
                const existingDateStr = existing.date.toISOString().split("T")[0];
                const paidByCode = paidBy === "parceiro" ? "partner" : "you";
                let responsibleUserId = null;
                if (paidByCode === "you") {
                    responsibleUserId = userId;
                }
                else if (paidByCode === "partner" && partnerId) {
                    responsibleUserId = partnerId;
                }
                else {
                    responsibleUserId = userId;
                }
                const dbPaymentMethod = paymentMethod === "cartao" ? "card" : "cash";
                let cardId = null;
                let card = null;
                if (dbPaymentMethod === "card") {
                    if (!creditCardId) {
                        throw new HttpError_1.HttpError(400, "Selecione um cartão para pagamento no crédito.");
                    }
                    card = await database_1.prisma.creditCard.findFirst({
                        where: {
                            id: creditCardId,
                            accountId,
                        },
                    });
                    if (!card) {
                        throw new HttpError_1.HttpError(400, "Cartão inválido para esta conta.");
                    }
                    cardId = card.id;
                }
                const originalInstallments = existing.installments ?? 1;
                const wasCardParcelled = existing.paymentMethod === "card" && originalInstallments > 1;
                const totalInstallments = typeof installments === "number" && installments > 0
                    ? installments
                    : originalInstallments;
                const willBeCardParcelled = dbPaymentMethod === "card" && totalInstallments > 1;
                const paymentMethodChanged = existing.paymentMethod !== dbPaymentMethod;
                const cardChanged = (existing.cardId ?? null) !== (cardId ?? null);
                const dateChangedAll = scope === "all" && existingDateStr !== newDateStr;
                // --------------------------------------------------
                // Split por PARCELA (value é valor da parcela)
                // --------------------------------------------------
                const baseForSplit = value;
                let youPayPerInstallment = null;
                let partnerPaysPerInstallment = null;
                if (splitType === "50-50") {
                    const half = Number((baseForSplit / 2).toFixed(2));
                    youPayPerInstallment = half;
                    partnerPaysPerInstallment = Number((baseForSplit - half).toFixed(2));
                }
                else if (splitType === "proporcional") {
                    const proportional = await this.calculateProportionalSplit(accountId, newDate, baseForSplit);
                    youPayPerInstallment = proportional.youPay;
                    partnerPaysPerInstallment = proportional.partnerPays;
                }
                else if (splitType === "customizada") {
                    const userPercent = customSplit?.you ?? 50;
                    const youVal = Number(((baseForSplit * userPercent) / 100).toFixed(2));
                    youPayPerInstallment = youVal;
                    partnerPaysPerInstallment = Number((baseForSplit - youVal).toFixed(2));
                }
                // =========================================================
                // CASO: scope = "all" E será cartão parcelado
                // =========================================================
                if (scope === "all" && willBeCardParcelled) {
                    // Descobre o grupo de parcelas
                    const siblingsWhere = existing.installmentGroupId
                        ? {
                            accountId,
                            installmentGroupId: existing.installmentGroupId,
                        }
                        : {
                            accountId,
                            paymentMethod: "card",
                            cardId: existing.cardId,
                            description: existing.description,
                            category: existing.category,
                        };
                    let siblings = await database_1.prisma.expense.findMany({
                        where: siblingsWhere,
                        orderBy: { date: "asc" }, // ordenar por data (1ª fatura -> última fatura)
                    });
                    if (siblings.length === 0) {
                        siblings = [existing];
                    }
                    const originalTotal = siblings.length;
                    const groupId = existing.installmentGroupId && existing.installmentGroupId.length > 0
                        ? existing.installmentGroupId
                        : (0, crypto_1.randomUUID)();
                    // --------------------------------------------------
                    // REBUILD TOTAL:
                    // - data mudou (na parcela editada)
                    // - ou não era parcelado e virou parcelado
                    // - ou pm/cartão mudaram
                    // --------------------------------------------------
                    if (dateChangedAll ||
                        !wasCardParcelled ||
                        paymentMethodChanged ||
                        cardChanged) {
                        const updatedCurrent = await database_1.prisma.$transaction(async (tx) => {
                            // apaga todas as parcelas do grupo antigo
                            await tx.expense.deleteMany({
                                where: siblingsWhere,
                            });
                            // nova primeira fatura baseada na NOVA data
                            const firstInvoiceDate = getFirstInvoiceDate(newDate, card?.closingDay ?? null, card?.dueDay ?? null);
                            for (let k = 1; k <= totalInstallments; k++) {
                                const installmentDate = k === 1
                                    ? firstInvoiceDate
                                    : addMonthsKeepingDay(firstInvoiceDate, k - 1);
                                await tx.expense.create({
                                    data: {
                                        accountId,
                                        createdById: existing.createdById,
                                        responsibleUserId,
                                        description: safeDescription,
                                        category,
                                        value: baseForSplit,
                                        date: installmentDate,
                                        paidBy: paidByCode,
                                        youPay: youPayPerInstallment,
                                        partnerPays: partnerPaysPerInstallment,
                                        paymentMethod: dbPaymentMethod,
                                        cardId,
                                        installments: totalInstallments,
                                        currentInstallment: k,
                                        installment: `${k}/${totalInstallments}`,
                                        installmentGroupId: groupId,
                                    },
                                });
                            }
                            const current = await tx.expense.findFirst({
                                where: {
                                    accountId,
                                    installmentGroupId: groupId,
                                    currentInstallment: existing.currentInstallment ?? 1,
                                },
                                include: { card: true },
                            });
                            return current;
                        });
                        return res.json({
                            message: "Todas as parcelas foram recriadas com a nova configuração.",
                            transaction: updatedCurrent
                                ? this.mapExpenseToDTO(updatedCurrent, userId)
                                : undefined,
                        });
                    }
                    // --------------------------------------------------
                    // AJUSTE SEM REBUILD:
                    // - continua cartão parcelado
                    // - mesma data-base (da parcela editada)
                    // - mesmo cartão / paymentMethod
                    //
                    // Regras:
                    //   * Atualiza valor/split de todas
                    //   * Se novo total < antigo -> remove cauda
                    //   * Se novo total > antigo -> cria cauda baseada na
                    //     data da ÚLTIMA fatura atual
                    //   * Sempre renumera installments/currentInstallment/instalment
                    // --------------------------------------------------
                    const updatedCurrent = await database_1.prisma.$transaction(async (tx) => {
                        // re-carrega com lock lógico
                        const siblingsSorted = await tx.expense.findMany({
                            where: siblingsWhere,
                            orderBy: { date: "asc" },
                        });
                        const existingCount = siblingsSorted.length;
                        // Atualiza as parcelas existentes até o novo total
                        const limit = Math.min(existingCount, totalInstallments);
                        for (let i = 0; i < limit; i++) {
                            const s = siblingsSorted[i];
                            const k = i + 1; // 1..limit
                            await tx.expense.update({
                                where: { id: s.id },
                                data: {
                                    description: safeDescription,
                                    category,
                                    value: baseForSplit,
                                    date: s.date, // mantém data original dessa fatura
                                    accountId,
                                    createdById: s.createdById,
                                    responsibleUserId,
                                    paidBy: paidByCode,
                                    youPay: youPayPerInstallment,
                                    partnerPays: partnerPaysPerInstallment,
                                    paymentMethod: dbPaymentMethod,
                                    cardId,
                                    installments: totalInstallments,
                                    currentInstallment: k,
                                    installment: `${k}/${totalInstallments}`,
                                    installmentGroupId: groupId,
                                },
                            });
                        }
                        // Se novo total < existente -> deleta últimas parcelas
                        if (totalInstallments < existingCount) {
                            const toDeleteIds = siblingsSorted
                                .slice(totalInstallments)
                                .map((s) => s.id);
                            if (toDeleteIds.length > 0) {
                                await tx.expense.deleteMany({
                                    where: {
                                        id: { in: toDeleteIds },
                                    },
                                });
                            }
                        }
                        // Se novo total > existente -> cria cauda baseada na ÚLTIMA data
                        if (totalInstallments > existingCount) {
                            const last = siblingsSorted[existingCount - 1];
                            const lastDate = last.date;
                            for (let k = existingCount + 1; k <= totalInstallments; k++) {
                                const monthsToAdd = k - existingCount;
                                const installmentDate = addMonthsKeepingDay(lastDate, monthsToAdd);
                                await tx.expense.create({
                                    data: {
                                        accountId,
                                        createdById: existing.createdById,
                                        responsibleUserId,
                                        description: safeDescription,
                                        category,
                                        value: baseForSplit,
                                        date: installmentDate,
                                        paidBy: paidByCode,
                                        youPay: youPayPerInstallment,
                                        partnerPays: partnerPaysPerInstallment,
                                        paymentMethod: dbPaymentMethod,
                                        cardId,
                                        installments: totalInstallments,
                                        currentInstallment: k,
                                        installment: `${k}/${totalInstallments}`,
                                        installmentGroupId: groupId,
                                    },
                                });
                            }
                        }
                        const current = await tx.expense.findUnique({
                            where: { id: existing.id },
                            include: { card: true },
                        });
                        return current;
                    });
                    return res.json({
                        message: totalInstallments > originalTotal
                            ? "Todas as parcelas foram atualizadas e novas parcelas foram adicionadas com base na última fatura."
                            : totalInstallments < originalTotal
                                ? "Todas as parcelas foram atualizadas e parcelas extras foram removidas."
                                : "Todas as parcelas foram atualizadas.",
                        transaction: updatedCurrent
                            ? this.mapExpenseToDTO(updatedCurrent, userId)
                            : undefined,
                    });
                }
                // =========================================================
                // CASO: scope = "all" mas deixou de ser cartão parcelado
                // → apaga as outras parcelas do grupo e mantém só esta
                // =========================================================
                if (scope === "all" && wasCardParcelled && !willBeCardParcelled) {
                    const siblingsWhere = existing.installmentGroupId
                        ? {
                            accountId,
                            installmentGroupId: existing.installmentGroupId,
                            id: { not: existing.id },
                        }
                        : {
                            accountId,
                            paymentMethod: "card",
                            cardId: existing.cardId,
                            description: existing.description,
                            category: existing.category,
                            id: { not: existing.id },
                        };
                    await database_1.prisma.expense.deleteMany({
                        where: siblingsWhere,
                    });
                }
                // =========================================================
                // CASO GERAL:
                //  - scope = "single"
                //  - ou não é cartão parcelado
                // =========================================================
                const updated = await database_1.prisma.expense.update({
                    where: { id: existing.id },
                    data: {
                        description: safeDescription,
                        category,
                        value: baseForSplit,
                        date: newDate,
                        accountId,
                        createdById: existing.createdById,
                        responsibleUserId,
                        paidBy: paidByCode,
                        youPay: youPayPerInstallment,
                        partnerPays: partnerPaysPerInstallment,
                        paymentMethod: dbPaymentMethod,
                        cardId,
                        installments: willBeCardParcelled ? totalInstallments : 1,
                        currentInstallment: willBeCardParcelled
                            ? existing.currentInstallment ?? 1
                            : 1,
                        installment: willBeCardParcelled
                            ? `${existing.currentInstallment ?? 1}/${totalInstallments}`
                            : null,
                        installmentGroupId: willBeCardParcelled
                            ? existing.installmentGroupId ?? (0, crypto_1.randomUUID)()
                            : null,
                    },
                    include: { card: true },
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
        // =========================================================
        // DELETE /transactions/expenses/:id
        // =========================================================
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
                const accountId = user.accountId;
                const existing = await database_1.prisma.expense.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Despesa não encontrada." });
                }
                const isParcelledExisting = existing.paymentMethod === "card" && (existing.installments ?? 1) > 1;
                if (isParcelledExisting && existing.installmentGroupId) {
                    await database_1.prisma.expense.deleteMany({
                        where: {
                            accountId,
                            installmentGroupId: existing.installmentGroupId,
                        },
                    });
                    return res.status(204).send();
                }
                if (isParcelledExisting) {
                    await database_1.prisma.expense.deleteMany({
                        where: {
                            accountId,
                            paymentMethod: "card",
                            cardId: existing.cardId,
                            installments: existing.installments,
                            description: existing.description,
                            category: existing.category,
                        },
                    });
                    return res.status(204).send();
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
        // =========================================================
        // INCOME (create / update / delete) – mantido com ajustes mínimos
        // =========================================================
        this.createIncome = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
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
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const partner = user.account.users.find((u) => u.id !== userId) || null;
                const partnerId = partner?.id || null;
                const parsed = TransactionsSchema_1.CreateIncomeSchema.parse(req.body);
                const { value, category, description, date, receivedBy } = parsed;
                const safeDescription = description?.trim() ?? "";
                const parsedDate = parseDateStringToUTC(date);
                let receivedByCode = "you";
                if (receivedBy === "parceiro")
                    receivedByCode = "partner";
                if (receivedBy === "compartilhado")
                    receivedByCode = "shared";
                let responsibleUserId = null;
                if (receivedByCode === "you") {
                    responsibleUserId = userId;
                }
                else if (receivedByCode === "partner" && partnerId) {
                    responsibleUserId = partnerId;
                }
                else {
                    responsibleUserId = null;
                }
                let youReceive = null;
                let partnerReceive = null;
                if (receivedByCode === "you") {
                    youReceive = value;
                    partnerReceive = 0;
                }
                else if (receivedByCode === "partner") {
                    youReceive = 0;
                    partnerReceive = value;
                }
                else {
                    const half = Number((value / 2).toFixed(2));
                    youReceive = half;
                    partnerReceive = Number((value - half).toFixed(2));
                }
                const income = await database_1.prisma.income.create({
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
            }
            catch (err) {
                next(err);
            }
        };
        this.updateIncome = async (req, res, next) => {
            try {
                const userId = req.userId;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const { id } = req.params;
                const user = await database_1.prisma.user.findUnique({
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
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const accountId = user.accountId;
                const partner = user.account.users.find((u) => u.id !== userId) || null;
                const partnerId = partner?.id || null;
                const existing = await database_1.prisma.income.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Receita não encontrada." });
                }
                const parsed = TransactionsSchema_1.UpdateIncomeSchema.parse(req.body);
                const { value, category, description, date, receivedBy } = parsed;
                const safeDescription = description?.trim() ?? "";
                const parsedDate = parseDateStringToUTC(date);
                let receivedByCode = "you";
                if (receivedBy === "parceiro")
                    receivedByCode = "partner";
                if (receivedBy === "compartilhado")
                    receivedByCode = "shared";
                let responsibleUserId = null;
                if (receivedByCode === "you") {
                    responsibleUserId = userId;
                }
                else if (receivedByCode === "partner" && partnerId) {
                    responsibleUserId = partnerId;
                }
                else {
                    responsibleUserId = null;
                }
                let youReceive = null;
                let partnerReceive = null;
                if (receivedByCode === "you") {
                    youReceive = value;
                    partnerReceive = 0;
                }
                else if (receivedByCode === "partner") {
                    youReceive = 0;
                    partnerReceive = value;
                }
                else {
                    const half = Number((value / 2).toFixed(2));
                    youReceive = half;
                    partnerReceive = Number((value - half).toFixed(2));
                }
                const updated = await database_1.prisma.income.update({
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
            }
            catch (err) {
                next(err);
            }
        };
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
    // =========================================================
    // MAPPERS
    // =========================================================
    mapExpenseToDTO(expense, currentUserId) {
        const dateStr = expense.date.toISOString().split("T")[0];
        let responsibleLabel = "Você";
        if (expense.responsibleUserId &&
            expense.responsibleUserId !== currentUserId) {
            responsibleLabel = "Parceiro";
        }
        let paidByLabel = "Você";
        if (expense.paidBy === "partner")
            paidByLabel = "Parceiro";
        let youPay = typeof expense.youPay === "number" ? expense.youPay : undefined;
        let partnerPays = typeof expense.partnerPays === "number" ? expense.partnerPays : undefined;
        if (youPay === undefined || partnerPays === undefined) {
            const half = Number((expense.value / 2).toFixed(2));
            youPay = half;
            partnerPays = Number((expense.value - half).toFixed(2));
        }
        const paymentMethod = expense.paymentMethod === "card" ? "card" : "cash";
        const installments = typeof expense.installments === "number" ? expense.installments : null;
        const currentInstallment = typeof expense.currentInstallment === "number"
            ? expense.currentInstallment
            : null;
        const installmentStr = expense.installment ??
            (installments && currentInstallment
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
    mapIncomeToDTO(income, currentUserId) {
        const dateStr = income.date.toISOString().split("T")[0];
        let receivedBy = "Você";
        if (income.receivedBy === "partner")
            receivedBy = "Parceiro";
        if (income.receivedBy === "shared")
            receivedBy = "Compartilhado";
        let responsible = "Você";
        if (income.responsibleUserId &&
            income.responsibleUserId !== currentUserId) {
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
    // =========================================================
    // SPLIT PROPORCIONAL
    // =========================================================
    async calculateProportionalSplit(accountId, expenseDate, amount) {
        const year = expenseDate.getUTCFullYear();
        const month = expenseDate.getUTCMonth();
        const monthStart = new Date(Date.UTC(year, month, 1));
        const monthEnd = new Date(Date.UTC(year, month + 1, 1));
        const incomes = await database_1.prisma.income.findMany({
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
            }
            else if (inc.receivedBy === "partner") {
                partnerIncome += inc.value;
            }
            else if (inc.receivedBy === "shared") {
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
exports.TransactionsController = TransactionsController;
