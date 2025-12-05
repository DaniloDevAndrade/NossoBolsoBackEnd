"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditCardsRouter = void 0;
// src/routes/creditCardsRouter.ts
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth-middleware");
const CreditsCardsControllers_1 = require("../controllers/CreditsCardsControllers");
const creditCardsRouter = (0, express_1.Router)();
exports.creditCardsRouter = creditCardsRouter;
const controller = new CreditsCardsControllers_1.CreditCardsController();
creditCardsRouter.get("/", auth_middleware_1.authMiddleware, controller.getCreditCards);
creditCardsRouter.get("/:id", auth_middleware_1.authMiddleware, controller.getCreditCardDetails);
creditCardsRouter.post("/", auth_middleware_1.authMiddleware, controller.createCreditCard);
creditCardsRouter.put("/:id", auth_middleware_1.authMiddleware, controller.updateCreditCard);
creditCardsRouter.delete("/:id", auth_middleware_1.authMiddleware, controller.deleteCreditCard);
