// src/validators/credit-card-schemas.ts
import { z } from "zod";

export const CreditCardInstitutionEnum = z.enum([
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

export type CreditCardInstitution = z.infer<typeof CreditCardInstitutionEnum>;

const LimitNumberSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const normalized = v.replace(/\./g, "").replace(",", ".");
      const num = Number(normalized);
      return Number.isNaN(num) ? v : num;
    }
    return v;
  },
  z.number().positive("Limite deve ser maior que zero")
);

const DaySchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const num = Number(v);
      return Number.isNaN(num) ? v : num;
    }
    return v;
  },
  z
    .number()
    .int("Dia deve ser inteiro")
    .min(1, "Dia deve ser entre 1 e 31")
    .max(31, "Dia deve ser entre 1 e 31")
);

export const GetCreditCardsQuerySchema = z.object({
  month: z
    .string()
    .regex(/^(0?[1-9]|1[0-2])$/, "Mês deve ser entre 1 e 12")
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/, "Ano deve conter 4 dígitos")
    .optional(),
});

export const ListCardsQuerySchema = z.object({
  owner: z.enum(["todos", "voce", "parceiro"]).optional(),
});

export const CreateCreditCardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nome do cartão é obrigatório")
    .max(100, "Nome do cartão pode ter no máximo 100 caracteres"),

  institution: CreditCardInstitutionEnum,

  lastDigits: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Informe os 4 últimos dígitos do cartão"),

  limit: LimitNumberSchema,

  dueDay: DaySchema,

  closingDay: DaySchema.optional(),

  owner: z.enum(["voce", "parceiro"]),
});

export const UpdateCreditCardSchema = CreateCreditCardSchema.partial();
