import rateLimit from "express-rate-limit";

export const globalRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, 
  max: 500, 
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Muitas requisições deste IP. Tente novamente mais tarde.",
  },
  validate: {
    trustProxy: false,
  },
});
