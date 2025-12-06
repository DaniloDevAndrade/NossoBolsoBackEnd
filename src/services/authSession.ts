import type { Response } from "express";
import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";

export function createUserSession(res: Response, userId: string) {
  const token = jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET!,
    { expiresIn: "60m" }
  );

  res.cookie("access_token", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 60 * 60 * 1000,
    path: "/",
  });

  return token;
}

export function clearUserSession(res: Response) {
  const isProd = process.env.NODE_ENV === "production";

  res.clearCookie("access_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "lax" : "lax",
    path: "/",
  });
}
