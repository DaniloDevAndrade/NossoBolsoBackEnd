import { Router } from "express";
import { authMiddleware } from "../middlewares/auth-middleware";
import { GoalsController } from "../controllers/GoalsControllers";

const goalsRouter = Router();
const controller = new GoalsController();

// Metas
goalsRouter.get("/", authMiddleware, controller.getGoals);
goalsRouter.get("/:id", authMiddleware, controller.getGoalById);
goalsRouter.post("/", authMiddleware, controller.createGoal);
goalsRouter.put("/:id", authMiddleware, controller.updateGoal);
goalsRouter.delete("/:id", authMiddleware, controller.deleteGoal);

// Contribuições de uma meta
goalsRouter.post(
  "/:id/contributions",
  authMiddleware,
  controller.createContribution
);

goalsRouter.put(
  "/:id/contributions/:contributionId",
  authMiddleware,
  controller.updateContribution
);

goalsRouter.delete(
  "/:id/contributions/:contributionId",
  authMiddleware,
  controller.deleteContribution
);

export { goalsRouter };
