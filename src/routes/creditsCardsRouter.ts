// src/routes/creditCardsRouter.ts
import { Router } from "express";
import { authMiddleware } from "../middlewares/auth-middleware";
import { CreditCardsController } from "../controllers/CreditsCardsControllers";

const creditCardsRouter = Router();
const controller = new CreditCardsController();

creditCardsRouter.get("/", authMiddleware, controller.getCreditCards);
creditCardsRouter.get("/:id", authMiddleware, controller.getCreditCardDetails);
creditCardsRouter.post("/", authMiddleware, controller.createCreditCard);
creditCardsRouter.put("/:id", authMiddleware, controller.updateCreditCard);
creditCardsRouter.delete("/:id", authMiddleware, controller.deleteCreditCard);

export { creditCardsRouter };
