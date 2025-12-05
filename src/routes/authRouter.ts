import { Router } from "express";
import { AuthControllers } from "../controllers/AuthControllers";
import { authTightLimiter } from "../middlewares/auth-rate-limit";
import { authMiddleware } from "../middlewares/auth-middleware";
import { me } from "../controllers/MeControllers";

const authRouter = Router()

const AuthController = new AuthControllers()

authRouter.post('/register', authTightLimiter, AuthController.register)
authRouter.post('/register/verify', authTightLimiter, AuthController.verifyRegister)
authRouter.post('/register/resend-code', authTightLimiter, AuthController.resendRegisterCode)
authRouter.post('/register/change-number', authTightLimiter, AuthController.changeNumberRegister)

authRouter.post('/login', authTightLimiter, AuthController.login)
authRouter.post('/login/verify', authTightLimiter, AuthController.verifyLogin)
authRouter.post('/login/resend-code', authTightLimiter, AuthController.resendLoginCode)

authRouter.post('/password/forgot', authTightLimiter, AuthController.forgotPassword)
authRouter.post('/password/reset/verify', authTightLimiter, AuthController.resetPasswordVerify)
authRouter.post('/password/reset/resend', authTightLimiter, AuthController.resendResetPasswordCode)
authRouter.post('/password/reset', authTightLimiter, AuthController.resetPassword)

authRouter.get('/logout', authTightLimiter, authMiddleware, AuthController.logout)

authRouter.get("/me", authMiddleware, me);

export { authRouter }
