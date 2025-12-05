import { Router } from "express";
import { authMiddleware } from "../middlewares/auth-middleware";
import { TransactionsController } from "../controllers/TransactionsControllers";

const transactionsRouter = Router();
const controller = new TransactionsController();

transactionsRouter.get("/", authMiddleware, controller.getTransactions);

// Despesas
transactionsRouter.post("/expenses", authMiddleware, controller.createExpense);
transactionsRouter.put("/expenses/:id", authMiddleware, controller.updateExpense);
transactionsRouter.delete("/expenses/:id",authMiddleware,controller.deleteExpense);

// Receitas
transactionsRouter.post("/incomes", authMiddleware, controller.createIncome);
transactionsRouter.put("/incomes/:id", authMiddleware, controller.updateIncome);
transactionsRouter.delete("/incomes/:id",authMiddleware,controller.deleteIncome
);

export { transactionsRouter };
