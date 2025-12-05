// src/middlewares/rate-limit-global.ts
import rateLimit from "express-rate-limit";

export const globalRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 500, // 100 requests por IP por janela
  standardHeaders: true, // retorna RateLimit-* headers
  legacyHeaders: false,
  message: {
    message: "Muitas requisições deste IP. Tente novamente mais tarde.",
  },
});
