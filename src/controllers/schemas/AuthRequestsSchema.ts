import { z } from "zod";

export const RegisterUserRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(
      /^[A-Za-zÀ-ÖØ-öø-ÿ]{2,}(?:\s[A-Za-zÀ-ÖØ-öø-ÿ]{2,})+$/,
      "Informe o nome completo (nome e sobrenome)"
    ),

  email: z.string().email("Email inválido"),

  phone: z
    .string()
    .regex(
      /^55\d{11}$/,
      "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"
    ),

  password: z
    .string()
    .min(8, "Senha deve ter no mínimo 8 caracteres")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-]).{8,}$/,
      "Senha deve conter letra maiúscula, minúscula, número e caractere especial"
    ),
});

export const UserPhoneSchema = z.object({
  userPhone: z
    .string()
    .regex(
      /^55\d{11}$/,
      "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"
    ),
});

export const VerifyUserRequestSchema = UserPhoneSchema.extend({
  code: z.string().length(6, "Código deve conter 6 dígitos"),
});

export const ResendCodeSchema = UserPhoneSchema;

export const ChangeNumberSchema = z.object({
  userPhone: UserPhoneSchema.shape.userPhone,
  newUserPhone: UserPhoneSchema.shape.userPhone,
});

export const LoginRequestSchema = z.object({
  emailOrPhone: z.string().min(1, "Informe email ou telefone"),
  password: z.string().min(1, "Informe a senha"),
});

export const LoginVerifySchema = z.object({
  challengeId: z.string().min(1, "Desafio inválido"),
  code: z.string().length(6, "Código deve conter 6 dígitos"),
});

export const LoginResendCodeSchema = z.object({
  challengeId: z.string().min(1, "Desafio inválido"),
});
