"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoginResendCodeSchema = exports.LoginVerifySchema = exports.LoginRequestSchema = exports.ChangeNumberSchema = exports.ResendCodeSchema = exports.VerifyUserRequestSchema = exports.UserPhoneSchema = exports.RegisterUserRequestSchema = void 0;
const zod_1 = require("zod");
exports.RegisterUserRequestSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .trim()
        .regex(/^[A-Za-zÀ-ÖØ-öø-ÿ]{2,}(?:\s[A-Za-zÀ-ÖØ-öø-ÿ]{2,})+$/, "Informe o nome completo (nome e sobrenome)"),
    email: zod_1.z.string().email("Email inválido"),
    phone: zod_1.z
        .string()
        .regex(/^55\d{11}$/, "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"),
    password: zod_1.z
        .string()
        .min(8, "Senha deve ter no mínimo 8 caracteres")
        .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-]).{8,}$/, "Senha deve conter letra maiúscula, minúscula, número e caractere especial"),
});
exports.UserPhoneSchema = zod_1.z.object({
    userPhone: zod_1.z
        .string()
        .regex(/^55\d{11}$/, "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"),
});
exports.VerifyUserRequestSchema = exports.UserPhoneSchema.extend({
    code: zod_1.z.string().length(6, "Código deve conter 6 dígitos"),
});
exports.ResendCodeSchema = exports.UserPhoneSchema;
exports.ChangeNumberSchema = zod_1.z.object({
    userPhone: exports.UserPhoneSchema.shape.userPhone,
    newUserPhone: exports.UserPhoneSchema.shape.userPhone,
});
exports.LoginRequestSchema = zod_1.z.object({
    emailOrPhone: zod_1.z.string().min(1, "Informe email ou telefone"),
    password: zod_1.z.string().min(1, "Informe a senha"),
});
exports.LoginVerifySchema = zod_1.z.object({
    challengeId: zod_1.z.string().min(1, "Desafio inválido"),
    code: zod_1.z.string().length(6, "Código deve conter 6 dígitos"),
});
exports.LoginResendCodeSchema = zod_1.z.object({
    challengeId: zod_1.z.string().min(1, "Desafio inválido"),
});
