"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserSession = createUserSession;
exports.clearUserSession = clearUserSession;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const isProd = process.env.NODE_ENV === "production";
const baseCookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain: isProd ? ".nossobolso.app" : undefined,
};
function createUserSession(res, userId) {
    const token = jsonwebtoken_1.default.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: "60m" });
    res.cookie("access_token", token, {
        ...baseCookieOptions,
        maxAge: 60 * 60 * 1000,
    });
    return token;
}
function clearUserSession(res) {
    res.clearCookie("access_token", {
        ...baseCookieOptions,
    });
}
