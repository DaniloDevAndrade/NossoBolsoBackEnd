"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcceptInviteAuthedSchema = exports.AcceptInvitePublicSchema = exports.InvitePartnerSchema = void 0;
const zod_1 = require("zod");
exports.InvitePartnerSchema = zod_1.z.object({
    receiverPhone: zod_1.z
        .string()
        .regex(/^55\d{11}$/, "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"),
});
exports.AcceptInvitePublicSchema = zod_1.z.object({
    inviteCode: zod_1.z.string().min(6),
    name: zod_1.z.string().min(3),
    email: zod_1.z.string().email(),
    password: zod_1.z
        .string()
        .min(8)
        .regex(/[a-z]/, "Deve conter letra minúscula")
        .regex(/[A-Z]/, "Deve conter letra maiúscula")
        .regex(/\d/, "Deve conter número")
        .regex(/[@$!%*?&.#_-]/, "Deve conter símbolo"),
});
exports.AcceptInviteAuthedSchema = zod_1.z.object({
    inviteCode: zod_1.z.string().min(6),
});
