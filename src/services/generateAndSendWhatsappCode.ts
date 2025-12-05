// src/utils/codeGenerate.ts
import { randomUUID } from "crypto";
import { prisma } from "../database";
import { HttpError } from "../errors/HttpError";
import { User } from "../generated/prisma/client";
import { generateCode, hashCode, minutesFromNow } from "../utils/whatsappCode";

type CodeType = "register" | "login" | "reset_password";

export async function generateWhatsappCode(
  user: User,
  type: CodeType,
  ttlMinutes = 3
) {
  try {
    const code = generateCode();
    const codeHash = hashCode(code);
    const challengeId = randomUUID();

    await prisma.whatsappCode.deleteMany({
      where: {
        userPhone: user.phone,
        type,
        OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
      },
    });

    const record = await prisma.whatsappCode.create({
      data: {
        userPhone: user.phone,
        codeHash,
        type,
        expiresAt: minutesFromNow(ttlMinutes),
        challengeId
      },
    });

    return { record, code, newChallengeId: challengeId};
  } catch (error) {
    throw new HttpError(400, "Não foi possivel gerar o codigo no whatsapp.");
  }
}
