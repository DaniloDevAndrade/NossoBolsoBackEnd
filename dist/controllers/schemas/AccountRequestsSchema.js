"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateProfileSchema = exports.ChangePasswordSchema = void 0;
const zod_1 = require("zod");
exports.ChangePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z
        .string()
        .min(1, "Senha atual é obrigatória."),
    newPassword: zod_1.z
        .string()
        .min(8, "A nova senha deve ter pelo menos 8 caracteres."),
});
exports.UpdateProfileSchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .trim()
        .min(1, "Nome é obrigatório.")
        .max(120, "Nome pode ter no máximo 120 caracteres."),
    email: zod_1.z
        .string()
        .trim()
        .toLowerCase()
        .email("Email inválido.")
        .max(160, "Email pode ter no máximo 160 caracteres."),
    phone: zod_1.z
        .string()
        .trim()
        .min(8, "Telefone é obrigatório.")
        .max(20, "Telefone pode ter no máximo 20 caracteres."),
});
