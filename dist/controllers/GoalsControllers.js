"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalsController = void 0;
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const GoalsRequestsSchema_1 = require("./schemas/GoalsRequestsSchema");
// interpreta "2025-12-01" como meia-noite UTC + valida se é uma data real
const parseDateStringToUTC = (dateStr) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    // valida se a data é realmente válida (evita coisas como 2025-13-40)
    if (!y ||
        !m ||
        !d ||
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== y ||
        date.getUTCMonth() !== m - 1 ||
        date.getUTCDate() !== d) {
        throw new HttpError_1.HttpError(400, "Data inválida.");
    }
    return date;
};
class GoalsController {
    constructor() {
        // GET /goals
        this.getGoals = async (req, res, next) => {
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
                const goals = await database_1.prisma.goal.findMany({
                    where: { accountId: user.accountId },
                    include: {
                        contributions: true,
                    },
                    orderBy: { createdAt: "desc" },
                });
                const goalsDTO = goals.map((goal) => this.mapGoalToDTO(goal));
                return res.json({ goals: goalsDTO });
            }
            catch (err) {
                next(err);
            }
        };
        // GET /goals/:id
        this.getGoalById = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const goal = await database_1.prisma.goal.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                    include: {
                        contributions: {
                            orderBy: { date: "desc" },
                        },
                    },
                });
                if (!goal) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                const goalDTO = this.mapGoalToDTO(goal);
                const contributionsDTO = goal.contributions.map((c) => this.mapContributionToDTO(c));
                return res.json({
                    goal: goalDTO,
                    contributions: contributionsDTO,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /goals
        this.createGoal = async (req, res, next) => {
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
                const parsed = GoalsRequestsSchema_1.CreateGoalSchema.parse(req.body);
                const { name, description, target, monthlyContribution, deadline } = parsed;
                const deadlineDate = parseDateStringToUTC(deadline);
                const safeName = name.trim();
                const safeDescription = description && description.trim().length > 0
                    ? description.trim()
                    : null;
                const goal = await database_1.prisma.goal.create({
                    data: {
                        accountId: user.accountId,
                        name: safeName,
                        description: safeDescription,
                        target,
                        monthlyContribution,
                        deadline: deadlineDate,
                    },
                    include: {
                        contributions: true,
                    },
                });
                return res.status(201).json({
                    message: "Meta criada com sucesso.",
                    goal: this.mapGoalToDTO(goal),
                });
            }
            catch (err) {
                next(err);
            }
        };
        // PUT /goals/:id
        this.updateGoal = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.goal.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                    include: { contributions: true },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                const parsed = GoalsRequestsSchema_1.UpdateGoalSchema.parse(req.body);
                const dataToUpdate = {};
                if (parsed.name !== undefined) {
                    const name = parsed.name.trim();
                    if (!name) {
                        throw new HttpError_1.HttpError(400, "Nome da meta é obrigatório.");
                    }
                    dataToUpdate.name = name;
                }
                if (parsed.description !== undefined) {
                    const desc = parsed.description.trim();
                    dataToUpdate.description = desc === "" ? null : desc;
                }
                if (parsed.target !== undefined) {
                    dataToUpdate.target = parsed.target;
                }
                if (parsed.monthlyContribution !== undefined) {
                    dataToUpdate.monthlyContribution = parsed.monthlyContribution;
                }
                if (parsed.deadline !== undefined) {
                    dataToUpdate.deadline = parseDateStringToUTC(parsed.deadline);
                }
                const updated = await database_1.prisma.goal.update({
                    where: { id: existing.id },
                    data: dataToUpdate,
                    include: {
                        contributions: true,
                    },
                });
                return res.json({
                    message: "Meta atualizada com sucesso.",
                    goal: this.mapGoalToDTO(updated),
                });
            }
            catch (err) {
                next(err);
            }
        };
        // DELETE /goals/:id
        this.deleteGoal = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const existing = await database_1.prisma.goal.findFirst({
                    where: {
                        id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                await database_1.prisma.goal.delete({
                    where: { id: existing.id },
                });
                return res.status(204).send();
            }
            catch (err) {
                next(err);
            }
        };
        // POST /goals/:id/contributions
        this.createContribution = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id: goalId } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const goal = await database_1.prisma.goal.findFirst({
                    where: {
                        id: goalId,
                        accountId: user.accountId,
                    },
                });
                if (!goal) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                const parsed = GoalsRequestsSchema_1.CreateGoalContributionSchema.parse(req.body);
                const { amount, date, source } = parsed;
                const contributionDate = parseDateStringToUTC(date);
                let dbSource = "user";
                if (source === "parceiro")
                    dbSource = "partner";
                if (source === "compartilhado")
                    dbSource = "shared";
                const contribution = await database_1.prisma.goalContribution.create({
                    data: {
                        goalId: goal.id,
                        accountId: user.accountId,
                        createdById: user.id,
                        amount,
                        date: contributionDate,
                        source: dbSource,
                    },
                });
                return res.status(201).json({
                    message: "Contribuição adicionada com sucesso.",
                    contribution: this.mapContributionToDTO(contribution),
                });
            }
            catch (err) {
                next(err);
            }
        };
        // PUT /goals/:id/contributions/:contributionId
        this.updateContribution = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id: goalId, contributionId } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const goal = await database_1.prisma.goal.findFirst({
                    where: {
                        id: goalId,
                        accountId: user.accountId,
                    },
                });
                if (!goal) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                const existing = await database_1.prisma.goalContribution.findFirst({
                    where: {
                        id: contributionId,
                        goalId: goal.id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res
                        .status(404)
                        .json({ message: "Contribuição não encontrada." });
                }
                const parsed = GoalsRequestsSchema_1.UpdateGoalContributionSchema.parse(req.body);
                const dataToUpdate = {};
                if (parsed.amount !== undefined) {
                    dataToUpdate.amount = parsed.amount;
                }
                if (parsed.date !== undefined) {
                    dataToUpdate.date = parseDateStringToUTC(parsed.date);
                }
                if (parsed.source !== undefined) {
                    if (parsed.source === "voce")
                        dataToUpdate.source = "user";
                    if (parsed.source === "parceiro")
                        dataToUpdate.source = "partner";
                    if (parsed.source === "compartilhado")
                        dataToUpdate.source = "shared";
                }
                const updated = await database_1.prisma.goalContribution.update({
                    where: { id: existing.id },
                    data: dataToUpdate,
                });
                return res.json({
                    message: "Contribuição atualizada com sucesso.",
                    contribution: this.mapContributionToDTO(updated),
                });
            }
            catch (err) {
                next(err);
            }
        };
        // DELETE /goals/:id/contributions/:contributionId
        this.deleteContribution = async (req, res, next) => {
            try {
                const userId = req.userId;
                const { id: goalId, contributionId } = req.params;
                if (!userId)
                    throw new HttpError_1.HttpError(401, "Usuário não autenticado");
                const user = await database_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user || !user.accountId) {
                    throw new HttpError_1.HttpError(400, "Usuário não possui conta financeira configurada.");
                }
                const goal = await database_1.prisma.goal.findFirst({
                    where: {
                        id: goalId,
                        accountId: user.accountId,
                    },
                });
                if (!goal) {
                    return res.status(404).json({ message: "Meta não encontrada." });
                }
                const existing = await database_1.prisma.goalContribution.findFirst({
                    where: {
                        id: contributionId,
                        goalId: goal.id,
                        accountId: user.accountId,
                    },
                });
                if (!existing) {
                    return res
                        .status(404)
                        .json({ message: "Contribuição não encontrada." });
                }
                await database_1.prisma.goalContribution.delete({
                    where: { id: existing.id },
                });
                return res.status(204).send();
            }
            catch (err) {
                next(err);
            }
        };
    }
    // ------------- HELPERS -------------
    mapGoalToDTO(goal) {
        const current = goal.contributions?.reduce((sum, c) => sum + c.amount, 0) ?? 0;
        const progressRaw = goal.target > 0 ? (current / goal.target) * 100 : 0;
        const progress = Math.min(Math.max(progressRaw, 0), 100);
        const isCompleted = progress >= 100;
        const deadlineStr = goal.deadline.toISOString().split("T")[0];
        return {
            id: goal.id,
            name: goal.name,
            description: goal.description,
            target: goal.target,
            current,
            deadline: deadlineStr,
            monthlyContribution: goal.monthlyContribution,
            progress: Number(progress.toFixed(2)),
            isCompleted,
        };
    }
    mapContributionToDTO(contribution) {
        const dateStr = contribution.date.toISOString().split("T")[0];
        let source = "Você";
        if (contribution.source === "partner")
            source = "Parceiro";
        if (contribution.source === "shared")
            source = "Compartilhado";
        return {
            id: contribution.id,
            date: dateStr,
            amount: contribution.amount,
            source,
        };
    }
}
exports.GoalsController = GoalsController;
