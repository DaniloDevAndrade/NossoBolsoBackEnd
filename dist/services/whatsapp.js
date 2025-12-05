"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsappCode = sendWhatsappCode;
exports.sendWhatsappText = sendWhatsappText;
const axios_1 = __importDefault(require("axios"));
const HttpError_1 = require("../errors/HttpError");
const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN;
async function sendWhatsappCode(phone, code) {
    const text = `👋 Olá!

Para proteger sua conta no *NossoBolso*, precisamos confirmar seu acesso.

🔑 Código de verificação: *${code}*

Esse código é válido por alguns minutos.
Nunca compartilhe este código com terceiros.`;
    try {
        await axios_1.default.post(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
            number: phone,
            text,
        }, {
            headers: {
                apikey: `${EVOLUTION_TOKEN}`,
            },
        });
        return;
    }
    catch (error) {
        throw new HttpError_1.HttpError(502, "Não foi possível enviar a mensagem via WhatsApp. Tente novamente ou confira o número.");
    }
}
async function sendWhatsappText(phone, text) {
    try {
        const res = await axios_1.default.post(`${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
            number: phone,
            text,
        }, {
            headers: {
                apikey: `${EVOLUTION_TOKEN}`,
            },
        });
        console.log(res);
        return;
    }
    catch (error) {
        throw new HttpError_1.HttpError(502, "Não foi possível enviar a mensagem via WhatsApp. Tente novamente ou confira o número.");
    }
}
