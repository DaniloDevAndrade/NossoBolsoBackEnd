"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalRateLimiter = void 0;
// src/middlewares/rate-limit-global.ts
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
exports.globalRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 10 * 60 * 1000, // 10 minutos
    max: 500, // 100 requests por IP por janela
    standardHeaders: true, // retorna RateLimit-* headers
    legacyHeaders: false,
    message: {
        message: "Muitas requisições deste IP. Tente novamente mais tarde.",
    },
});
