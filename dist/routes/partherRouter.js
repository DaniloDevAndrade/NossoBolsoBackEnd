"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.partherRouter = void 0;
const express_1 = require("express");
const auth_rate_limit_1 = require("../middlewares/auth-rate-limit");
const auth_middleware_1 = require("../middlewares/auth-middleware");
const MeControllers_1 = require("../controllers/MeControllers");
const PartherControllers_1 = require("../controllers/PartherControllers");
const partherRouter = (0, express_1.Router)();
exports.partherRouter = partherRouter;
const PartherController = new PartherControllers_1.PartherControllers();
partherRouter.post('/invite', auth_rate_limit_1.authTightLimiter, auth_middleware_1.authMiddleware, PartherController.inviteParther);
partherRouter.post('/acceptp', auth_rate_limit_1.authTightLimiter, PartherController.acceptInvitePublic);
// partherRouter.post('/accepta', authTightLimiter, authMiddleware, PartherController.acceptInviteAuthed )
partherRouter.get("/me", auth_middleware_1.authMiddleware, MeControllers_1.me);
