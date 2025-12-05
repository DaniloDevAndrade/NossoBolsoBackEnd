import { NextFunction, Response } from "express";
import { AuthedRequest } from "../types/AuthedRequest";
import { prisma } from "../database";

export const me = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ message: "Não autenticado" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        verified: true,
        accountId: true,
      },
    });

    if (!user) {
      return res.status(401).json({ message: "Usuário não encontrado" });
    }

    return res.json({ user });
  } catch (err) {
    next(err);
  }
};