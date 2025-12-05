"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateCreditCardSchema = exports.CreateCreditCardSchema = exports.ListCardsQuerySchema = exports.GetCreditCardsQuerySchema = exports.CreditCardInstitutionEnum = void 0;
// src/validators/credit-card-schemas.ts
const zod_1 = require("zod");
exports.CreditCardInstitutionEnum = zod_1.z.enum([
    "NUBANK",
    "INTER",
    "ITAU",
    "BANCO_DO_BRASIL",
    "BRADESCO",
    "SANTANDER",
    "CAIXA",
    "BTG_PACTUAL",
    "C6_BANK",
    "PAGBANK",
    "OUTROS",
]);
const LimitNumberSchema = zod_1.z.preprocess((v) => {
    if (typeof v === "string") {
        const normalized = v.replace(/\./g, "").replace(",", ".");
        const num = Number(normalized);
        return Number.isNaN(num) ? v : num;
    }
    return v;
}, zod_1.z.number().positive("Limite deve ser maior que zero"));
const DaySchema = zod_1.z.preprocess((v) => {
    if (typeof v === "string") {
        const num = Number(v);
        return Number.isNaN(num) ? v : num;
    }
    return v;
}, zod_1.z
    .number()
    .int("Dia deve ser inteiro")
    .min(1, "Dia deve ser entre 1 e 31")
    .max(31, "Dia deve ser entre 1 e 31"));
exports.GetCreditCardsQuerySchema = zod_1.z.object({
    month: zod_1.z
        .string()
        .regex(/^(0?[1-9]|1[0-2])$/, "Mês deve ser entre 1 e 12")
        .optional(),
    year: zod_1.z
        .string()
        .regex(/^\d{4}$/, "Ano deve conter 4 dígitos")
        .optional(),
});
exports.ListCardsQuerySchema = zod_1.z.object({
    owner: zod_1.z.enum(["todos", "voce", "parceiro"]).optional(),
});
exports.CreateCreditCardSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .trim()
        .min(1, "Nome do cartão é obrigatório")
        .max(100, "Nome do cartão pode ter no máximo 100 caracteres"),
    institution: exports.CreditCardInstitutionEnum,
    lastDigits: zod_1.z
        .string()
        .trim()
        .regex(/^\d{4}$/, "Informe os 4 últimos dígitos do cartão"),
    limit: LimitNumberSchema,
    dueDay: DaySchema,
    closingDay: DaySchema.optional(),
    owner: zod_1.z.enum(["voce", "parceiro"]),
});
exports.UpdateCreditCardSchema = exports.CreateCreditCardSchema.partial();
