"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateIncomeSchema = exports.CreateIncomeSchema = exports.UpdateExpenseSchema = exports.CreateExpenseSchema = exports.GetTransactionsQuerySchema = void 0;
const zod_1 = require("zod");
exports.GetTransactionsQuerySchema = zod_1.z.object({
    month: zod_1.z.string().optional(),
    year: zod_1.z.string().optional(),
    type: zod_1.z.enum(["todas", "income", "expense"]).optional(),
    category: zod_1.z.string().optional(),
    responsible: zod_1.z.enum(["todos", "voce", "parceiro"]).optional(),
});
exports.CreateExpenseSchema = zod_1.z.object({
    value: zod_1.z
        .number()
        .positive("Valor deve ser maior que zero"),
    category: zod_1.z
        .string()
        .min(1, "Categoria é obrigatória"),
    description: zod_1.z
        .string()
        .optional(),
    date: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
    paidBy: zod_1.z.enum(["voce", "parceiro"]),
    splitType: zod_1.z.enum(["50-50", "proporcional", "customizada"]),
    customSplit: zod_1.z
        .object({
        you: zod_1.z.number(),
        partner: zod_1.z.number(),
    })
        .optional(),
    paymentMethod: zod_1.z.enum(["dinheiro", "cartao"]),
    creditCardId: zod_1.z.string().optional(),
    installments: zod_1.z.number().int().min(1).optional(),
    currentInstallment: zod_1.z.number().int().min(1).optional(),
});
exports.UpdateExpenseSchema = exports.CreateExpenseSchema.extend({
    scope: zod_1.z.enum(["single", "all"]).optional(),
});
exports.CreateIncomeSchema = zod_1.z.object({
    value: zod_1.z
        .number()
        .positive("Valor deve ser maior que zero"),
    category: zod_1.z
        .string()
        .min(1, "Categoria é obrigatória"),
    description: zod_1.z
        .string()
        .optional(),
    date: zod_1.z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
    receivedBy: zod_1.z.enum(["voce", "parceiro", "compartilhado"]),
});
exports.UpdateIncomeSchema = exports.CreateIncomeSchema;
