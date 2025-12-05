import { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../errors/HttpError";

export const errorHandlerMiddleware: ErrorRequestHandler = (
  error,
  req,
  res,
  next
) => {
    
  console.error("ERROR MIDDLEWARE:", error);

  if (error instanceof ZodError) {
    const issues = (error as any).issues || (error as any).errors || [];

    if (!Array.isArray(issues) || issues.length === 0) {
      return res.status(400).json({
        message: "Dados inválidos",
      });
    }

    const first = issues[0];

    return res.status(400).json({
      message: first?.message ?? "Dados inválidos",
      field: Array.isArray(first?.path) ? first.path.join(".") : undefined,
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }

  if (error instanceof Error) {
    console.error(error);
    return res.status(500).json({ message: error.message });
  }

  return res
    .status(500)
    .json({ message: "Erro interno no servidor desconhecido" });
};
