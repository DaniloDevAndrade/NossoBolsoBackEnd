"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionsRouter = void 0;
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth-middleware");
const TransactionsControllers_1 = require("../controllers/TransactionsControllers");
const transactionsRouter = (0, express_1.Router)();
exports.transactionsRouter = transactionsRouter;
const controller = new TransactionsControllers_1.TransactionsController();
transactionsRouter.get("/", auth_middleware_1.authMiddleware, controller.getTransactions);
// Despesas
transactionsRouter.post("/expenses", auth_middleware_1.authMiddleware, controller.createExpense);
transactionsRouter.put("/expenses/:id", auth_middleware_1.authMiddleware, controller.updateExpense);
transactionsRouter.delete("/expenses/:id", auth_middleware_1.authMiddleware, controller.deleteExpense);
// Receitas
transactionsRouter.post("/incomes", auth_middleware_1.authMiddleware, controller.createIncome);
transactionsRouter.put("/incomes/:id", auth_middleware_1.authMiddleware, controller.updateIncome);
transactionsRouter.delete("/incomes/:id", auth_middleware_1.authMiddleware, controller.deleteIncome);
