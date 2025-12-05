import { z } from "zod";

export const InvitePartnerSchema = z.object({
  receiverPhone: z
    .string()
    .regex(
      /^55\d{11}$/,
      "Telefone deve estar no formato 5511999999999 (DDI + DDD + número)"
    ),
});

export const AcceptInvitePublicSchema = z.object({
  inviteCode: z.string().min(6),
  name: z.string().min(3),
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[a-z]/, "Deve conter letra minúscula")
    .regex(/[A-Z]/, "Deve conter letra maiúscula")
    .regex(/\d/, "Deve conter número")
    .regex(/[@$!%*?&.#_-]/, "Deve conter símbolo"),
});


export const AcceptInviteAuthedSchema = z.object({
  inviteCode: z.string().min(6),
});
