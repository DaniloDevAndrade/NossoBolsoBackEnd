"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditCardsController = void 0;
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const CreditCardsSchema_1 = require("./schemas/CreditCardsSchema");
class CreditCardsController {
    constructor() {
        // GET /credit-cards
        // Lista cartões da conta do usuário + total usado no mês/ano (fatura do mês).
        this.getCreditCards = async (req, res, next) => {
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
                const accountId = user.accountId;
                const { month: monthParam, year: yearParam } = CreditCardsSchema_1.GetCreditCardsQuerySchema.parse(req.query);
                const now = new Date();
                const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
                const year = yearParam ? Number(yearParam) : now.getFullYear();
                // Datas em UTC pra não dar drift
                const startDate = new Date(Date.UTC(year, month - 1, 1));
                const endDate = new Date(Date.UTC(year, month, 1));
                const cards = await database_1.prisma.creditCard.findMany({
                    where: {
                        accountId,
                    },
                    include: {
                        expenses: {
                            where: {
                                paymentMethod: "credit_card",
                                date: {
                                    gte: startDate,
                                    lt: endDate,
                                },
                            },
                        },
                    },
                });
                const cardsDTO = cards.map((card) => this.mapCardToDTO(card, user.id));
                return res.json({ cards: cardsDTO });
            }
            catch (err) {
                next(err);
            }
        };
        // GET /credit-cards/:id
        // Detalhe do cartão + despesas desse cartão no mês/ano.
        this.getCreditCardDetails = async (req, res, next) => {
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
                const accountId = user.accountId;
                const { id } = req.params;
                const { month: monthParam, year: yearParam } = CreditCardsSchema_1.GetCreditCardsQuerySchema.parse(req.query);
                const now = new Date();
                const month = monthParam ? Number(monthParam) : now.getMonth() + 1;
                const year = yearParam ? Number(yearParam) : now.getFullYear();
                const startDate = new Date(Date.UTC(year, month - 1, 1));
                const endDate = new Date(Date.UTC(year, month, 1));
                // 1) Pega as despesas DESSE MÊS para mostrar na tabela + used
                const card = await database_1.prisma.creditCard.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                    include: {
                        expenses: {
                            where: {
                                paymentMethod: "credit_card",
                                date: {
                                    gte: startDate,
                                    lt: endDate,
                                },
                            },
                        },
                    },
                });
                if (!card) {
                    throw new HttpError_1.HttpError(404, "Cartão não encontrado.");
                }
                // 2) Descobre os grupos de parcelas presentes neste mês
                const groupIds = Array.from(new Set(card.expenses
                    .map((e) => e.installmentGroupId)
                    .filter((v) => !!v)));
                // 3) Se houver grupos, busca TODAS as parcelas desses grupos (todos os meses)
                const totalsByGroup = new Map();
                if (groupIds.length > 0) {
                    const groupExpenses = await database_1.prisma.expense.findMany({
                        where: {
                            accountId,
                            creditCardId: card.id,
                            installmentGroupId: { in: groupIds },
                        },
                    });
                    for (const e of groupExpenses) {
                        if (!e.installmentGroupId)
                            continue;
                        const prev = totalsByGroup.get(e.installmentGroupId) ?? 0;
                        totalsByGroup.set(e.installmentGroupId, prev + (e.amount ?? 0));
                    }
                }
                // 4) DTO do cartão (used = só mês filtrado)
                const cardDTO = this.mapCardToDTO(card, user.id);
                // 5) Mapeia as despesas do mês com total REAL da compra
                const expensesDTO = card.expenses
                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                    .map((expense) => {
                    const dateStr = expense.date.toISOString().split("T")[0];
                    let installment = null;
                    if (expense.installments && expense.installments > 1) {
                        const current = typeof expense.currentInstallment === "number"
                            ? expense.currentInstallment
                            : 1;
                        installment = `${current}/${expense.installments}`;
                    }
                    let totalValue;
                    if (expense.installmentGroupId) {
                        const totalFromMap = totalsByGroup.get(expense.installmentGroupId);
                        if (typeof totalFromMap === "number") {
                            totalValue = Number(totalFromMap.toFixed(2));
                        }
                        else {
                            // fallback: valor parcela * número de parcelas
                            const totalInstallments = expense.installments && expense.installments > 0
                                ? expense.installments
                                : 1;
                            totalValue = Number((expense.amount * totalInstallments).toFixed(2));
                        }
                    }
                    else {
                        // compra à vista ou sem grupo
                        const totalInstallments = expense.installments && expense.installments > 0
                            ? expense.installments
                            : 1;
                        totalValue = Number((expense.amount * totalInstallments).toFixed(2));
                    }
                    return {
                        id: expense.id,
                        description: expense.description,
                        category: expense.category,
                        value: expense.amount, // valor da PARCELA
                        date: dateStr,
                        installment,
                        installmentGroupId: expense.installmentGroupId ?? null,
                        totalValue,
                    };
                });
                return res.json({
                    card: cardDTO,
                    expenses: expensesDTO,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /credit-cards
        this.createCreditCard = async (req, res, next) => {
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
                const accountId = user.accountId;
                const parsed = CreditCardsSchema_1.CreateCreditCardSchema.parse(req.body);
                const { ownerDb, userIdForCard } = await this.resolveCardOwner(accountId, user.id, parsed.owner);
                const card = await database_1.prisma.creditCard.create({
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
                                paymentMethod: "credit_card",
                            },
                        },
                    },
                });
                const dto = this.mapCardToDTO({
                    ...card,
                    expenses: card.expenses ?? [],
                }, user.id);
                return res.status(201).json({
                    message: "Cartão criado com sucesso.",
                    card: dto,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // PUT /credit-cards/:id
        this.updateCreditCard = async (req, res, next) => {
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
                const accountId = user.accountId;
                const { id } = req.params;
                const existing = await database_1.prisma.creditCard.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                });
                if (!existing) {
                    throw new HttpError_1.HttpError(404, "Cartão não encontrado.");
                }
                const parsed = CreditCardsSchema_1.UpdateCreditCardSchema.parse(req.body);
                const dataToUpdate = {};
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
                    const { ownerDb, userIdForCard } = await this.resolveCardOwner(accountId, user.id, parsed.owner);
                    dataToUpdate.owner = ownerDb;
                    dataToUpdate.userId = userIdForCard;
                }
                const updated = await database_1.prisma.creditCard.update({
                    where: { id: existing.id },
                    data: dataToUpdate,
                    include: {
                        expenses: {
                            where: {
                                paymentMethod: "credit_card",
                            },
                        },
                    },
                });
                const dto = this.mapCardToDTO(updated, user.id);
                return res.json({
                    message: "Cartão atualizado com sucesso.",
                    card: dto,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // DELETE /credit-cards/:id
        this.deleteCreditCard = async (req, res, next) => {
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
                const accountId = user.accountId;
                const { id } = req.params;
                const existing = await database_1.prisma.creditCard.findFirst({
                    where: {
                        id,
                        accountId,
                    },
                });
                if (!existing) {
                    throw new HttpError_1.HttpError(404, "Cartão não encontrado.");
                }
                const hasExpenses = await database_1.prisma.expense.count({
                    where: { creditCardId: existing.id },
                });
                if (hasExpenses > 0) {
                    throw new HttpError_1.HttpError(400, "Não é possível excluir um cartão com despesas vinculadas.");
                }
                await database_1.prisma.creditCard.delete({
                    where: { id: existing.id },
                });
                return res.status(204).send();
            }
            catch (err) {
                next(err);
            }
        };
    }
    // ---------- HELPERS ----------
    async resolveCardOwner(accountId, currentUserId, ownerInput) {
        if (ownerInput === "voce") {
            return { ownerDb: "user", userIdForCard: currentUserId };
        }
        // "parceiro"
        const partner = await database_1.prisma.user.findFirst({
            where: {
                accountId,
                id: { not: currentUserId },
            },
            orderBy: { createdAt: "asc" },
        });
        if (!partner) {
            throw new HttpError_1.HttpError(400, "Conta ainda não possui parceiro vinculado para atribuir o cartão.");
        }
        return { ownerDb: "partner", userIdForCard: partner.id };
    }
    mapCardToDTO(card, currentUserId) {
        const used = Array.isArray(card.expenses)
            ? card.expenses.reduce((sum, exp) => sum + (exp.amount ?? 0), 0)
            : 0;
        const isCurrentUserOwner = card.userId === currentUserId;
        const ownerLabel = isCurrentUserOwner ? "Você" : "Parceiro";
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
}
exports.CreditCardsController = CreditCardsController;
