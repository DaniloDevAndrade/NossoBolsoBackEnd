import rateLimit from "express-rate-limit";

export const authTightLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Muitas tentativas de autenticação. Tente novamente em alguns minutos.",
  },
});
