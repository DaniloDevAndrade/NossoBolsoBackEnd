import { z } from "zod";

export const CreateGoalSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nome da meta é obrigatório"),
  description: z
    .string()
    .trim()
    .optional(),
  target: z
    .number()
    .positive("Valor objetivo deve ser maior que zero"),
  monthlyContribution: z
    .number()
    .min(0, "Contribuição mensal não pode ser negativa")
    .default(0),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Prazo deve estar no formato YYYY-MM-DD"),
});

export const UpdateGoalSchema = CreateGoalSchema.partial();

export const CreateGoalContributionSchema = z.object({
  amount: z
    .number()
    .positive("Valor deve ser maior que zero"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve estar no formato YYYY-MM-DD"),
  source: z.enum(["voce", "parceiro", "compartilhado"]),
});

export const UpdateGoalContributionSchema =
  CreateGoalContributionSchema.partial();
