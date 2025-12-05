"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function authMiddleware(req, res, next) {
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
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, secret);
        }
        catch (err) {
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
        req.userId = payload.sub;
        return next();
    }
    catch (err) {
        console.error("[authMiddleware] Erro inesperado:", err);
        return res.status(500).json({
            message: "Erro interno de autenticação.",
        });
    }
}
