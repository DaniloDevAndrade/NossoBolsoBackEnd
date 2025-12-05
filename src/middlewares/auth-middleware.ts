import type { NextFunction, Response } from "express";
import type { JwtPayload } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import { AuthedRequest } from "../types/AuthedRequest";

export function authMiddleware(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.cookies?.access_token;

    if (!token) {
      return res.status(401).json({
        message: "Você não está autenticado.",
      });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[authMiddleware] JWT_SECRET não configurado");
      return res.status(500).json({
        message: "Erro de configuração de autenticação.",
      });
    }

    let payload: string | JwtPayload;

    try {
      payload = jwt.verify(token, secret);
    } catch (err: any) {
      if (err?.name === "TokenExpiredError") {
        return res.status(401).json({
          message: "Sua sessão expirou. Faça login novamente.",
        });
      }

      return res.status(401).json({
        message: "Sessão inválida. Faça login novamente.",
      });
    }

    if (!payload || typeof payload !== "object" || !("sub" in payload)) {
      return res.status(401).json({
        message: "Sessão inválida.",
      });
    }

    req.userId = payload.sub as string;

    return next();
  } catch (err) {
    console.error("[authMiddleware] Erro inesperado:", err);
    return res.status(500).json({
      message: "Erro interno de autenticação.",
    });
  }
}
