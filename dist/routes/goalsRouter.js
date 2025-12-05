"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalsRouter = void 0;
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth-middleware");
const GoalsControllers_1 = require("../controllers/GoalsControllers");
const goalsRouter = (0, express_1.Router)();
exports.goalsRouter = goalsRouter;
const controller = new GoalsControllers_1.GoalsController();
// Metas
goalsRouter.get("/", auth_middleware_1.authMiddleware, controller.getGoals);
goalsRouter.get("/:id", auth_middleware_1.authMiddleware, controller.getGoalById);
goalsRouter.post("/", auth_middleware_1.authMiddleware, controller.createGoal);
goalsRouter.put("/:id", auth_middleware_1.authMiddleware, controller.updateGoal);
goalsRouter.delete("/:id", auth_middleware_1.authMiddleware, controller.deleteGoal);
// Contribuições de uma meta
goalsRouter.post("/:id/contributions", auth_middleware_1.authMiddleware, controller.createContribution);
goalsRouter.put("/:id/contributions/:contributionId", auth_middleware_1.authMiddleware, controller.updateContribution);
goalsRouter.delete("/:id/contributions/:contributionId", auth_middleware_1.authMiddleware, controller.deleteContribution);
