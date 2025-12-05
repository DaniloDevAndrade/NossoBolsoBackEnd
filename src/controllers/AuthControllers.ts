import { Handler } from "express";
import { hashSync, compareSync } from "bcrypt-ts";
import jwt from "jsonwebtoken";
import { z } from "zod";

import {
  ChangeNumberSchema,
  LoginResendCodeSchema,
  RegisterUserRequestSchema,
  UserPhoneSchema,
  VerifyUserRequestSchema,
} from "./schemas/AuthRequestsSchema";
import { prisma } from "../database";
import { verifyCode } from "../utils/whatsappCode";
import { generateWhatsappCode } from "../services/generateAndSendWhatsappCode";
import { sendRegisterVerificationCode } from "../services/sendRegisterVerificationCode";
import { sendWhatsappCode } from "../services/whatsapp";
import { HttpError } from "../errors/HttpError";
import { clearUserSession, createUserSession } from "../services/authSession";

export type DeliveryStatusValue = "sent" | "failed";

const JWT_RESET_SECRET = process.env.JWT_SECRET || "changeme-reset-secret";

// Schemas específicos do fluxo de LOGIN por challengeId
const LoginVerifySchema = z.object({
  challengeId: z.string().min(1, "challengeId é obrigatório"),
  code: z.string().length(6, "Codigo deve conter 6 caracteres"),
});

const ResendLoginCodeSchema = z.object({
  challengeId: z.string().min(1, "challengeId é obrigatório"),
});

export class AuthControllers {
  // POST /auth/register
  register: Handler = async (req, res, next) => {
    try {
      const data = RegisterUserRequestSchema.parse(req.body);
      const passwordHash = hashSync(data.password, 10);

      const existing = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: data.email, mode: "insensitive" } },
            { phone: data.phone },
          ],
        },
      });

      if (existing) {
        if (existing.verified) {
          return res
            .status(409)
            .json({ message: "Email ou telefone já está cadastrado." });
        }

        let deliveryStatus: DeliveryStatusValue = "sent";

        try {
          const { code } = await generateWhatsappCode(existing, "register", 3);
          await sendWhatsappCode(existing.phone, code);
        } catch (err) {
          console.error("Erro ao enviar código de verificação", err);
          deliveryStatus = "failed";
        }

        return res.status(200).json({
          message:
            deliveryStatus === "sent"
              ? "Essa conta já foi criada, mas ainda não foi verificada. Enviamos um novo código via WhatsApp."
              : "Essa conta já foi criada, mas não conseguimos enviar o código via WhatsApp. Você poderá conferir e alterar o número na próxima tela.",
          userPhone: existing.phone,
          status: "pending_verification",
          deliveryStatus,
        });
      }

      const user = await prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          phone: data.phone,
          password: passwordHash,
          verified: false,
        },
      });

      let deliveryStatus: DeliveryStatusValue = "sent";

      try {
        const { code } = await generateWhatsappCode(user, "register", 3);
        await sendWhatsappCode(user.phone, code);
      } catch (err) {
        console.error("Erro ao enviar código de verificação (novo):", err);
        deliveryStatus = "failed";
      }

      return res.status(201).json({
        message:
          deliveryStatus === "sent"
            ? "Usuário criado. Código enviado via WhatsApp."
            : "Usuário criado, mas não foi possível enviar o código via WhatsApp. Você poderá conferir e alterar o número na próxima tela.",
        userPhone: user.phone,
        status: "created",
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/register/verify
  verifyRegister: Handler = async (req, res, next) => {
    try {
      const { userPhone, code } = VerifyUserRequestSchema.parse(req.body);

      const record = await prisma.whatsappCode.findFirst({
        where: {
          userPhone,
          type: "register",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!record) {
        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      const now = new Date();

      if (record.expiresAt <= now) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      if (record.attempts >= 5) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(429).json({
          message: "Muitas tentativas inválidas. Solicite um novo código.",
        });
      }

      const isValid = verifyCode(code, record.codeHash);

      if (!isValid) {
        const nextAttempts = record.attempts + 1;

        if (nextAttempts >= 5) {
          await prisma.whatsappCode.delete({
            where: { id: record.id },
          });

          return res.status(429).json({
            message: "Muitas tentativas inválidas. Solicite um novo código.",
          });
        }

        await prisma.whatsappCode.update({
          where: { id: record.id },
          data: {
            attempts: { increment: 1 },
          },
        });

        return res.status(400).json({ message: "Código inválido" });
      }

      const updatedUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { phone: userPhone },
          include: { account: true },
        });

        if (!user) {
          throw new HttpError(404, "Usuário não encontrado");
        }

        let accountId = user.accountId;

        if (!accountId) {
          const account = await tx.account.create({
            data: {
              type: "couple",
            },
          });

          accountId = account.id;
        }

        const u = await tx.user.update({
          where: { id: user.id },
          data: {
            verified: true,
            accountId,
          },
        });

        await tx.whatsappCode.delete({
          where: { id: record.id },
        });

        return u;
      });

      createUserSession(res, updatedUser.id);

      return res.status(200).json({
        message: "Conta verificada com sucesso",
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/register/resend-code
  resendRegisterCode: Handler = async (req, res, next) => {
    try {
      const { userPhone } = UserPhoneSchema.parse(req.body);

      const { deliveryStatus } = await sendRegisterVerificationCode(userPhone);

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Novo código enviado via WhatsApp"
            : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos ou confira seu número.",
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/register/change-number
  changeNumberRegister: Handler = async (req, res, next) => {
    try {
      const { userPhone, newUserPhone } = ChangeNumberSchema.parse(req.body);

      if (userPhone === newUserPhone) {
        return res
          .status(409)
          .json({ message: "Os números não podem ser iguais." });
      }

      const user = await prisma.user.findUnique({
        where: { phone: userPhone },
      });

      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      if (user.verified) {
        return res
          .status(400)
          .json({ message: "Conta já verificada anteriormente" });
      }

      const newNumberExits = await prisma.user.findUnique({
        where: { phone: newUserPhone },
      });

      if (newNumberExits) {
        return res
          .status(409)
          .json({ message: "Novo número já é utilizado por outro usuário." });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { phone: newUserPhone },
      });

      const { deliveryStatus } = await sendRegisterVerificationCode(
        newUserPhone
      );

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Telefone atualizado e novo código enviado"
            : "Telefone atualizado, mas não conseguimos enviar o código. Tente reenviar ou conferir o número.",
        userPhone: newUserPhone,
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/login
  login: Handler = async (req, res, next) => {
    try {
      const { emailOrPhone, password } = req.body as {
        emailOrPhone: string;
        password: string;
      };

      if (!emailOrPhone || !password) {
        return res
          .status(400)
          .json({ message: "Email/telefone e senha são obrigatórios." });
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: emailOrPhone, mode: "insensitive" } },
            { phone: emailOrPhone },
          ],
        },
      });

      if (!user) {
        // não revela se é email/telefone inválido
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      const ok = compareSync(password, user.password);
      if (!ok) {
        return res.status(401).json({ message: "Credenciais inválidas" });
      }

      if (!user.verified) {
        return res
          .status(403)
          .json({ message: "Conta não verificada via WhatsApp" });
      }

      let deliveryStatus: DeliveryStatusValue = "sent";

      const { code, newChallengeId } = await generateWhatsappCode(
        user,
        "login",
        5
      );

      try {
        await sendWhatsappCode(user.phone, code);
      } catch (err) {
        console.error("Erro ao enviar código de login via WhatsApp:", err);
        deliveryStatus = "failed";
      }

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Código de login enviado via WhatsApp."
            : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
        userPhone: user.phone,
        newChallengeId,
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/login/verify
  verifyLogin: Handler = async (req, res, next) => {
    try {
      const { challengeId, code } = LoginVerifySchema.parse(req.body);

      const record = await prisma.whatsappCode.findFirst({
        where: {
          challengeId,
          type: "login",
        },
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });

      if (!record || !record.user) {
        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      const now = new Date();

      if (record.expiresAt <= now) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      if (record.attempts >= 5) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(429).json({
          message: "Muitas tentativas inválidas. Solicite um novo código.",
        });
      }

      const isValid = verifyCode(code, record.codeHash);

      if (!isValid) {
        const nextAttempts = record.attempts + 1;

        if (nextAttempts >= 5) {
          await prisma.whatsappCode.delete({
            where: { id: record.id },
          });

          return res.status(429).json({
            message: "Muitas tentativas inválidas. Solicite um novo código.",
          });
        }

        await prisma.whatsappCode.update({
          where: { id: record.id },
          data: {
            attempts: { increment: 1 },
          },
        });

        return res.status(400).json({ message: "Código inválido" });
      }

      await prisma.whatsappCode.delete({
        where: { id: record.id },
      });

      createUserSession(res, record.user.id);

      return res.status(200).json({
        message: "Login realizado com sucesso",
        user: {
          id: record.user.id,
          name: record.user.name,
          email: record.user.email,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/login/resend-code
  resendLoginCode: Handler = async (req, res, next) => {
    try {
      const { challengeId } = LoginResendCodeSchema.parse(req.body);

      const whatsCode = await prisma.whatsappCode.findUnique({
        where: { challengeId },
      });

      if (!whatsCode || whatsCode.type !== "login") {
        return res
          .status(400)
          .json({ message: "Não foi possível enviar um novo código." });
      }

      const user = await prisma.user.findUnique({
        where: {
          phone: whatsCode.userPhone,
        },
      });

      if (!user) {
        return res.status(404).json({ message: "Usuário não encontrado" });
      }

      if (!user.verified) {
        return res.status(403).json({ message: "Conta não verificada" });
      }

      let deliveryStatus: DeliveryStatusValue = "sent";

      const { code, newChallengeId } = await generateWhatsappCode(
        user,
        "login",
        5
      );

      try {
        await sendWhatsappCode(user.phone, code);
      } catch (err) {
        console.error("Erro ao reenviar código de login via WhatsApp:", err);
        deliveryStatus = "failed";
      }

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Novo código de login enviado via WhatsApp."
            : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
        userPhone: user.phone,
        challengeId: newChallengeId,
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/password/forgot
  forgotPassword: Handler = async (req, res, next) => {
    try {
      const { email } = req.body as { email: string };

      if (!email) {
        return res.status(400).json({ message: "Email é obrigatório." });
      }

      const user = await prisma.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
      });

      // Segurança: não revela se o email existe ou não
      if (!user || !user.verified) {
        return res.status(200).json({
          message:
            "Se o email estiver cadastrado, você receberá um código via WhatsApp.",
          deliveryStatus: "sent" as DeliveryStatusValue,
        });
      }

      let deliveryStatus: DeliveryStatusValue = "sent";

      const { code } = await generateWhatsappCode(user, "reset_password", 5);

      try {
        await sendWhatsappCode(user.phone, code);
      } catch (err) {
        console.error(
          "Erro ao enviar código de reset de senha via WhatsApp:",
          err
        );
        deliveryStatus = "failed";
      }

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Enviamos um código de recuperação de senha via WhatsApp."
            : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
        userPhone: user.phone,
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/password/reset/verify
  resetPasswordVerify: Handler = async (req, res, next) => {
    try {
      const { userPhone, code } = VerifyUserRequestSchema.parse(req.body);

      const record = await prisma.whatsappCode.findFirst({
        where: {
          userPhone,
          type: "reset_password",
        },
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });

      if (!record || !record.user) {
        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      const now = new Date();

      if (record.expiresAt <= now) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(400).json({ message: "Código inválido ou expirado" });
      }

      if (record.attempts >= 5) {
        await prisma.whatsappCode.delete({
          where: { id: record.id },
        });

        return res.status(429).json({
          message: "Muitas tentativas inválidas. Solicite um novo código.",
        });
      }

      const isValid = verifyCode(code, record.codeHash);

      if (!isValid) {
        const nextAttempts = record.attempts + 1;

        if (nextAttempts >= 5) {
          await prisma.whatsappCode.delete({
            where: { id: record.id },
          });

          return res.status(429).json({
            message: "Muitas tentativas inválidas. Solicite um novo código.",
          });
        }

        await prisma.whatsappCode.update({
          where: { id: record.id },
          data: {
            attempts: { increment: 1 },
          },
        });

        return res.status(400).json({ message: "Código inválido" });
      }

      await prisma.whatsappCode.delete({
        where: { id: record.id },
      });

      const resetToken = jwt.sign(
        {
          sub: record.user.id,
          type: "reset_password",
        },
        JWT_RESET_SECRET,
        {
          expiresIn: "15m",
        }
      );

      return res.status(200).json({
        message: "Código de recuperação verificado com sucesso.",
        resetToken,
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/password/reset
  resetPassword: Handler = async (req, res, next) => {
    try {
      const { resetToken, newPassword } = req.body as {
        resetToken: string;
        newPassword: string;
      };

      if (!resetToken) {
        return res
          .status(400)
          .json({ message: "Token de recuperação é obrigatório." });
      }

      if (!newPassword) {
        return res
          .status(400)
          .json({ message: "Nova senha é obrigatória." });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({
          message: "A nova senha deve ter pelo menos 8 caracteres.",
        });
      }

      let payload: any;
      try {
        payload = jwt.verify(resetToken, JWT_RESET_SECRET);
      } catch (err) {
        return res
          .status(400)
          .json({ message: "Token de recuperação inválido ou expirado." });
      }

      if (!payload || payload.type !== "reset_password" || !payload.sub) {
        return res
          .status(400)
          .json({ message: "Token de recuperação inválido." });
      }

      const userId = payload.sub as string;

      const newPasswordHash = hashSync(newPassword, 10);

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { password: newPasswordHash },
      });

      createUserSession(res, updatedUser.id);

      return res.status(200).json({
        message: "Senha redefinida com sucesso.",
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
        },
      });
    } catch (err) {
      next(err);
    }
  };

  // POST /auth/password/reset/resend
  resendResetPasswordCode: Handler = async (req, res, next) => {
    try {
      const { userPhone } = UserPhoneSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { phone: userPhone },
      });

      if (!user || !user.verified) {
        return res.status(200).json({
          message:
            "Se o telefone estiver cadastrado, você receberá um novo código.",
          deliveryStatus: "sent" as DeliveryStatusValue,
        });
      }

      let deliveryStatus: DeliveryStatusValue = "sent";

      const { code } = await generateWhatsappCode(
        user,
        "reset_password",
        5
      );

      try {
        await sendWhatsappCode(user.phone, code);
      } catch (err) {
        console.error(
          "Erro ao reenviar código de reset de senha via WhatsApp:",
          err
        );
        deliveryStatus = "failed";
      }

      return res.status(200).json({
        message:
          deliveryStatus === "sent"
            ? "Novo código de recuperação de senha enviado via WhatsApp."
            : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
        userPhone: user.phone,
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // GET /auth/logout
  logout: Handler = async (req, res, next) => {
    try {
      const token = req.cookies?.access_token;

      if (!token) {
        return res.status(401).json({
          message: "Você não está logado.",
        });
      }

      try {
        jwt.verify(token, process.env.JWT_SECRET!);
      } catch {
        // mesmo inválido, força limpeza do cookie
        clearUserSession(res);

        return res.status(401).json({
          message: "Sessão expirada. Logout forçado.",
        });
      }

      clearUserSession(res);

      return res.status(200).json({
        message: "Logout realizado com sucesso.",
      });
    } catch (err) {
      next(err);
    }
  };
}
