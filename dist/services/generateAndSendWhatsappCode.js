"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWhatsappCode = generateWhatsappCode;
const crypto_1 = require("crypto");
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const whatsappCode_1 = require("../utils/whatsappCode");
async function generateWhatsappCode(user, type, ttlMinutes = 3) {
    try {
        const code = (0, whatsappCode_1.generateCode)();
        const codeHash = (0, whatsappCode_1.hashCode)(code);
        const challengeId = (0, crypto_1.randomUUID)();
        await database_1.prisma.whatsappCode.deleteMany({
            where: {
                userPhone: user.phone,
                type,
                OR: [{ used: true }, { expiresAt: { lt: new Date() } }],
            },
        });
        const record = await database_1.prisma.whatsappCode.create({
            data: {
                userPhone: user.phone,
                codeHash,
                type,
                expiresAt: (0, whatsappCode_1.minutesFromNow)(ttlMinutes),
                challengeId
            },
        });
        return { record, code, newChallengeId: challengeId };
    }
    catch (error) {
        throw new HttpError_1.HttpError(400, "Não foi possivel gerar o codigo no whatsapp.");
    }
}
