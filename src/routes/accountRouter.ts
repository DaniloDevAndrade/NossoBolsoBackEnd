import { Router } from "express";
import { authTightLimiter } from "../middlewares/auth-rate-limit";
import { authMiddleware } from "../middlewares/auth-middleware";
import { AccountControllers } from "../controllers/AccountControllers";

const accountRouter = Router();

const Controller = new AccountControllers();

accountRouter.get("/me", authMiddleware, Controller.me);

accountRouter.patch("/profile", authMiddleware, Controller.updateProfile);

accountRouter.post("/password/change",authMiddleware,authTightLimiter,Controller.changePassword);

accountRouter.delete("/destroy", authMiddleware, Controller.destroyAccount);

export { accountRouter };
