"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandlerMiddleware = void 0;
const zod_1 = require("zod");
const HttpError_1 = require("../errors/HttpError");
const errorHandlerMiddleware = (error, req, res, next) => {
    console.error("ERROR MIDDLEWARE:", error);
    if (error instanceof zod_1.ZodError) {
        const issues = error.issues || error.errors || [];
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
    if (error instanceof HttpError_1.HttpError) {
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
exports.errorHandlerMiddleware = errorHandlerMiddleware;
