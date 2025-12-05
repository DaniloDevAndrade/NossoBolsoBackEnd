import { hashSync, compareSync } from "bcrypt-ts";

export function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function hashCode(code: string): string {
  return hashSync(code, 10);
}

export function verifyCode(code: string, hash: string): boolean {
  return compareSync(code, hash);
}

export function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}
