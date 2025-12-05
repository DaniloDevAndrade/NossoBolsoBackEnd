import axios from "axios";
import { HttpError } from "../errors/HttpError";

const EVOLUTION_BASE_URL = process.env.EVOLUTION_BASE_URL!;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE!;
const EVOLUTION_TOKEN = process.env.EVOLUTION_TOKEN!;

export async function sendWhatsappCode(phone: string, code: string) {
  const text = `👋 Olá!

Para proteger sua conta no *NossoBolso*, precisamos confirmar seu acesso.

🔑 Código de verificação: *${code}*

Esse código é válido por alguns minutos.
Nunca compartilhe este código com terceiros.`;

  try {
    await axios.post(
      `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        number: phone,
        text,
      },
      {
        headers: {
          apikey: `${EVOLUTION_TOKEN}`,
        },
      }
    );

    return
  } catch (error) {
    throw new HttpError(
      502,
      "Não foi possível enviar a mensagem via WhatsApp. Tente novamente ou confira o número."
    );
  }
}

export async function sendWhatsappText(phone: string, text: string) {
  try {
    const res = await axios.post(
      `${EVOLUTION_BASE_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        number: phone,
        text,
      },
      {
        headers: {
          apikey: `${EVOLUTION_TOKEN}`,
        },
      }
    );

    console.log(res)
    return
  } catch (error) {
    throw new HttpError(
      502,
      "Não foi possível enviar a mensagem via WhatsApp. Tente novamente ou confira o número."
    );
  }
}
