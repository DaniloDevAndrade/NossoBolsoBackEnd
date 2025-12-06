import express from "express";
import cors, { CorsOptions } from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

import { authRouter } from "./routes/authRouter";
import { errorHandlerMiddleware } from "./middlewares/error-handler";
import { globalRateLimiter } from "./middlewares/express-rate-limit";
import { partherRouter } from "./routes/partherRouter";
import { transactionsRouter } from "./routes/transactionsRouter";
import { creditCardsRouter } from "./routes/creditsCardsRouter";
import { goalsRouter } from "./routes/goalsRouter";
import { accountRouter } from "./routes/accountRouter";

dotenv.config();

const app = express();
app.set("trust proxy", true);

const allowedOrigins = (
  process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:3000"]
).map(origin => origin.trim());

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());
app.use(globalRateLimiter);

app.use("/auth", authRouter);
app.use("/parther", partherRouter);
app.use("/transactions", transactionsRouter);
app.use("/credit-cards", creditCardsRouter);
app.use("/goals", goalsRouter);
app.use("/account", accountRouter);

app.use(errorHandlerMiddleware);

const PORT = Number(process.env.PORT) || 3333;

console.log("Allowed CORS Origins:", allowedOrigins);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
