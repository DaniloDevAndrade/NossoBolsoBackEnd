import { z } from "zod"

export const ChangePasswordSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Senha atual é obrigatória."),
  newPassword: z
    .string()
    .min(8, "A nova senha deve ter pelo menos 8 caracteres."),
})

export const UpdateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nome é obrigatório.")
    .max(120, "Nome pode ter no máximo 120 caracteres."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email inválido.")
    .max(160, "Email pode ter no máximo 160 caracteres."),
  phone: z
    .string()
    .trim()
    .min(8, "Telefone é obrigatório.")
    .max(20, "Telefone pode ter no máximo 20 caracteres."),
})
