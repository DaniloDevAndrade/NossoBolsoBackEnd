import type { Response } from "express";
import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";

const baseCookieOptions = {
  httpOnly: true,
  secure: isProd,                   
  sameSite: "lax" as const,   
  path: "/",
  domain: isProd ? ".nossobolso.app" : undefined,
};

export function createUserSession(res: Response, userId: string) {
  const token = jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET!,
    { expiresIn: "60m" }
  );

  res.cookie("access_token", token, {
    ...baseCookieOptions,
    maxAge: 60 * 60 * 1000,
  });

  return token;
}

export function clearUserSession(res: Response) {
  res.clearCookie("access_token", {
    ...baseCookieOptions,
  });
}
