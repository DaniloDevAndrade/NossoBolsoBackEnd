"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateGoalContributionSchema = exports.CreateGoalContributionSchema = exports.UpdateGoalSchema = exports.CreateGoalSchema = void 0;
const zod_1 = require("zod");
exports.CreateGoalSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .trim()
        .min(1, "Nome da meta é obrigatório"),
    description: zod_1.z
        .string()
        .trim()
        .optional(),
    target: zod_1.z
        .number()
        .positive("Valor objetivo deve ser maior que zero"),
    monthlyContribution: zod_1.z
        .number()
        .min(0, "Contribuição mensal não pode ser negativa")
        .default(0),
    deadline: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Prazo deve estar no formato YYYY-MM-DD"),
});
exports.UpdateGoalSchema = exports.CreateGoalSchema.partial();
exports.CreateGoalContributionSchema = zod_1.z.object({
    amount: zod_1.z
        .number()
        .positive("Valor deve ser maior que zero"),
    date: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
    source: zod_1.z.enum(["voce", "parceiro", "compartilhado"]),
});
exports.UpdateGoalContributionSchema = exports.CreateGoalContributionSchema.partial();
