"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRegisterVerificationCode = sendRegisterVerificationCode;
const database_1 = require("../database");
const HttpError_1 = require("../errors/HttpError");
const generateAndSendWhatsappCode_1 = require("./generateAndSendWhatsappCode");
const whatsapp_1 = require("./whatsapp");
async function sendRegisterVerificationCode(userPhone) {
    const user = await database_1.prisma.user.findUnique({
        where: { phone: userPhone },
    });
    if (!user) {
        throw new HttpError_1.HttpError(404, "Usuário não encontrado");
    }
    if (user.verified) {
        throw new HttpError_1.HttpError(400, "Conta já verificada anteriomente");
    }
    await database_1.prisma.whatsappCode.deleteMany({
        where: {
            userPhone,
            type: "register",
        },
    });
    const { code } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "register", 3);
    try {
        await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
        return { deliveryStatus: "sent" };
    }
    catch (err) {
        console.error("Erro ao enviar código de registro (service):", err);
        return { deliveryStatus: "failed" };
    }
}
