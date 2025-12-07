import { z } from "zod";

const MonthSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  },
  z
    .number()
    .int()
    .min(1, "Mês deve ser entre 1 e 12")
    .max(12, "Mês deve ser entre 1 e 12")
);

const YearSchema = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isNaN(n) ? v : n;
    }
    return v;
  },
  z
    .number()
    .int()
    .min(1900, "Ano inválido")
    .max(2100, "Ano inválido")
);

export const GetTransactionsQuerySchema = z.object({
  month: MonthSchema.optional(), // number | undefined
  year: YearSchema.optional(),   // number | undefined
  type: z.enum(["todas", "income", "expense"]).optional(),
  category: z.string().optional(),
  responsible: z.enum(["todos", "voce", "parceiro"]).optional(),
});

export const CreateExpenseSchema = z.object({
  value: z.number().positive("Valor deve ser maior que zero"),
  category: z.string().min(1, "Categoria é obrigatória"),
  description: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
  paidBy: z.enum(["voce", "parceiro"]),
  splitType: z.enum(["50-50", "proporcional", "customizada"]),
  customSplit: z
    .object({
      you: z.number(),
      partner: z.number(),
    })
    .optional(),
  paymentMethod: z.enum(["dinheiro", "cartao"]),
  creditCardId: z.string().optional(),
  installments: z.number().int().min(1).optional(),
  currentInstallment: z.number().int().min(1).optional(),
});

export const UpdateExpenseSchema = CreateExpenseSchema.extend({
  scope: z.enum(["single", "all"]).optional(),
});

export const CreateIncomeSchema = z.object({
  value: z.number().positive("Valor deve ser maior que zero"),
  category: z.string().min(1, "Categoria é obrigatória"),
  description: z.string().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
  receivedBy: z.enum(["voce", "parceiro", "compartilhado"]),
});

export const UpdateIncomeSchema = CreateIncomeSchema;
