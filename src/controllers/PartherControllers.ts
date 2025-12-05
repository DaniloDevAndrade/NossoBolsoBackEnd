import { NextFunction, Response } from "express";
import { AuthedRequest } from "../types/AuthedRequest";
import {
  AcceptInviteAuthedSchema,
  AcceptInvitePublicSchema,
  InvitePartnerSchema,
} from "./schemas/PartherRequestSchema";
import { prisma } from "../database";
import { HttpError } from "../errors/HttpError";
import { hashSync } from "bcrypt-ts";
import { generateWhatsappCode } from "../services/generateAndSendWhatsappCode";
import { sendWhatsappCode, sendWhatsappText } from "../services/whatsapp";
import { DeliveryStatusValue } from "./AuthControllers";

export class PartherControllers {
  //POST /parther/invite
  inviteParther = async (
    req: AuthedRequest, 
    res: Response,
    next: NextFunction
  ) => {
    try {
      const userId = req.userId;
      const { receiverPhone } = InvitePartnerSchema.parse(req.body);

      const sender = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          account: {
            include: { users: true },
          },
        },
      });

      if (!sender) {
        throw new HttpError(401, "Usuário não autenticado");
      }

      if (!sender.accountId || !sender.account) {
        return res
          .status(400)
          .json({ message: "Você ainda não possui uma conta configurada." });
      }

      const currentUsersCount = sender.account.users.length;
      if (currentUsersCount >= 2) {
        return res.status(400).json({
          message: "Sua conta já possui o número máximo de 2 pessoas.",
        });
      }

      if (receiverPhone === sender.phone) {
        return res.status(400).json({
          message: "Você não pode convidar seu próprio número.",
        });
      }

      const existingRequest = await prisma.partnerRequest.findFirst({
        where: {
          accountId: sender.accountId,
          receiverPhone,
          status: "pending",
        },
      });

      if (existingRequest) {
        return res.status(409).json({
          message: "Já existe um convite pendente para esse número.",
        });
      }

      const receiver = await prisma.user.findUnique({
        where: { phone: receiverPhone },
      });

      if (
        receiver &&
        receiver.accountId &&
        receiver.accountId !== sender.accountId
      ) {
        return res.status(400).json({
          message:
            "Esse usuário já está vinculado a outra conta. Peça para ele desconectar antes.",
        });
      }

      const inviteCode = crypto.randomUUID();

      const inviteUrl = `${process.env.APP_BASE_URL!}/parceiro/aceitar?codigo=${inviteCode}&nome=${encodeURIComponent(
        sender.name
      )}`;

      const text = `👋 Olá!

${sender.name} convidou você para organizar as finanças em casal no *NossoBolso*.

Clique para aceitar o convite e criar sua conta:

${inviteUrl}

Qualquer dúvida, fale com ${sender.name}.`;

      try {
        await sendWhatsappText(receiverPhone, text);
      } catch (err) {
        console.error("Erro ao enviar convite via WhatsApp:", err);

        if (err instanceof HttpError) {
          return next(err);
        }

        return next(
          new HttpError(
            502,
            "Não foi possível enviar o convite via WhatsApp. Tente novamente ou confira o número."
          )
        );
      }
      
      const invite = await prisma.partnerRequest.create({
        data: {
          senderId: sender.id,
          accountId: sender.accountId,
          receiverPhone,
          receiverId: receiver?.id ?? null,
          status: "pending",
          inviteCode,
        },
      });

      return res.status(201).json({
        message: "Convite enviado com sucesso.",
        inviteId: invite.id,
        inviteCode: invite.inviteCode,
      });
    } catch (err) {
      next(err);
    }
  };

  //POST /parther/acceptp
  acceptInvitePublic = async (req: any, res: Response, next: NextFunction) => {
    try {
      const { inviteCode, name, email, password } =
        AcceptInvitePublicSchema.parse(req.body);

      const invite = await prisma.partnerRequest.findUnique({
        where: { inviteCode },
        include: {
          account: {
            include: { users: true },
          },
        },
      });

      if (!invite) {
        return res.status(404).json({ message: "Convite não encontrado." });
      }

      if (invite.status !== "pending") {
        return res.status(400).json({
          message: "Este convite já foi utilizado ou cancelado.",
        });
      }

      if (!invite.account) {
        throw new HttpError(
          400,
          "Convite inválido: conta associada não encontrada."
        );
      }

      if (invite.account.users.length >= 2) {
        return res.status(400).json({
          message: "Esta conta já possui o número máximo de 2 pessoas.",
        });
      }

      const receiverPhone = invite.receiverPhone;

      const existingUser = await prisma.user.findUnique({
        where: { phone: receiverPhone },
      });

      if (existingUser) {
        return res.status(409).json({
          message:
            "Já existe uma conta com esse número. Faça login para aceitar o convite.",
          requiresLogin: true,
        });
      }

      const passwordHash = hashSync(password, 10);

      const createdUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            email,
            phone: receiverPhone,
            password: passwordHash,
            verified: false,
            accountId: invite.accountId!,
          },
        });

        await tx.partnerRequest.delete({
          where: { id: invite.id },
        });

        return user;
      });

      let deliveryStatus: DeliveryStatusValue = "sent";

      try {
        const { code } = await generateWhatsappCode(createdUser, "register", 3);
        await sendWhatsappCode(createdUser.phone, code);
      } catch (err) {
        console.error("Erro ao enviar código de verificação (novo):", err);
        deliveryStatus = "failed";
      }

      return res.status(201).json({
        message:
          "Conta criada e convite aceito. Enviamos um código de verificação via WhatsApp.",
        userPhone: createdUser.phone,
        status: "created_and_linked",
        deliveryStatus,
      });
    } catch (err) {
      next(err);
    }
  };

  // acceptInviteAuthed = async (
  //   req: AuthedRequest,
  //   res: Response,
  //   next: NextFunction
  // ) => {
  //   try {
  //     const userId = req.userId;

  //     if (!userId) {
  //       throw new HttpError(401, "Usuário não autenticado");
  //     }

  //     const { inviteCode } = AcceptInviteAuthedSchema.parse(req.body);

  //     const user = await prisma.user.findUnique({
  //       where: { id: userId },
  //     });

  //     if (!user) {
  //       throw new HttpError(401, "Usuário não autenticado");
  //     }

  //     const invite = await prisma.partnerRequest.findUnique({
  //       where: { inviteCode },
  //       include: {
  //         account: {
  //           include: { users: true },
  //         },
  //       },
  //     });

  //     if (!invite) {
  //       return res.status(404).json({ message: "Convite não encontrado." });
  //     }

  //     if (invite.status !== "pending") {
  //       return res.status(400).json({
  //         message: "Este convite já foi utilizado ou cancelado.",
  //       });
  //     }

  //     if (!invite.account) {
  //       throw new HttpError(
  //         400,
  //         "Convite inválido: conta associada não encontrada."
  //       );
  //     }

  //     if (invite.receiverPhone !== user.phone) {
  //       return res.status(403).json({
  //         message:
  //           "Este convite não foi enviado para o seu número. Verifique se está usando a conta correta.",
  //       });
  //     }

  //     if (invite.account.users.length >= 2) {
  //       return res.status(400).json({
  //         message: "Esta conta já possui o número máximo de 2 pessoas.",
  //       });
  //     }

  //     if (user.accountId && user.accountId !== invite.accountId) {
  //       return res.status(400).json({
  //         message:
  //           "Você já está vinculado a outra conta. Desconecte-se dela antes de aceitar este convite.",
  //       });
  //     }

  //     await prisma.$transaction(async (tx) => {
  //       await tx.user.update({
  //         where: { id: user.id },
  //         data: {
  //           accountId: invite.accountId,
  //         },
  //       });

  //       await tx.partnerRequest.update({
  //         where: { id: invite.id },
  //         data: {
  //           status: "accepted",
  //           receiverId: user.id,
  //         },
  //       });
  //     });

  //     return res.status(200).json({
  //       message:
  //         "Convite aceito com sucesso. Sua conta foi vinculada ao parceiro.",
  //     });
  //   } catch (err) {
  //     next(err);
  //   }
  // };
}
