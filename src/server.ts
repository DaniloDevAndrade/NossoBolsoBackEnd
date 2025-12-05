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

const allowedOrigins = [
  "http://localhost:3000",
  
];

const corsOptions: CorsOptions = {
  origin: allowedOrigins,
  credentials: true,
};

app.use(cors(corsOptions));

app.use(cookieParser());
app.use(express.json());

app.use(globalRateLimiter)

app.use("/auth", authRouter);
app.use("/parther", partherRouter)
app.use("/transactions", transactionsRouter)
app.use("/credit-cards", creditCardsRouter);
app.use("/goals", goalsRouter);
app.use("/account", accountRouter);

app.use(errorHandlerMiddleware);


const PORT = Number(process.env.PORT) || 3333;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
