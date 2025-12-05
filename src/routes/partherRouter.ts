import { Router } from "express";
import { authTightLimiter } from "../middlewares/auth-rate-limit";
import { authMiddleware } from "../middlewares/auth-middleware";
import { me } from "../controllers/MeControllers";
import { PartherControllers } from "../controllers/PartherControllers";

const partherRouter = Router()

const PartherController = new PartherControllers()

partherRouter.post('/invite', authTightLimiter, authMiddleware, PartherController.inviteParther)
partherRouter.post('/acceptp', authTightLimiter, PartherController.acceptInvitePublic)
// partherRouter.post('/accepta', authTightLimiter, authMiddleware, PartherController.acceptInviteAuthed )


partherRouter.get("/me", authMiddleware, me);

export { partherRouter }