import { Request } from "express";
export interface AuthedRequest extends Request {
  userId: string;
  cookies: Record<string, any>;
}
