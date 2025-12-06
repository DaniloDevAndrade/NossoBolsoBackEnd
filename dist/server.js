"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const authRouter_1 = require("./routes/authRouter");
const error_handler_1 = require("./middlewares/error-handler");
const express_rate_limit_1 = require("./middlewares/express-rate-limit");
const partherRouter_1 = require("./routes/partherRouter");
const transactionsRouter_1 = require("./routes/transactionsRouter");
const creditsCardsRouter_1 = require("./routes/creditsCardsRouter");
const goalsRouter_1 = require("./routes/goalsRouter");
const accountRouter_1 = require("./routes/accountRouter");
dotenv_1.default.config();
const app = (0, express_1.default)();
const allowedOrigins = (process.env.CORS_ORIGINS?.split(",") ?? ["http://localhost:3000"]).map(origin => origin.trim());
const corsOptions = {
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json());
app.use(express_rate_limit_1.globalRateLimiter);
app.use("/auth", authRouter_1.authRouter);
app.use("/parther", partherRouter_1.partherRouter);
app.use("/transactions", transactionsRouter_1.transactionsRouter);
app.use("/credit-cards", creditsCardsRouter_1.creditCardsRouter);
app.use("/goals", goalsRouter_1.goalsRouter);
app.use("/account", accountRouter_1.accountRouter);
app.use(error_handler_1.errorHandlerMiddleware);
const PORT = Number(process.env.PORT) || 3333;
console.log("Allowed CORS Origins:", allowedOrigins);
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
