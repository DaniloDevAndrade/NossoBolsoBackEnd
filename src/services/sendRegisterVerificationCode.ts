import { prisma } from "../database";
import { HttpError } from "../errors/HttpError";
import { generateWhatsappCode } from "./generateAndSendWhatsappCode";
import { sendWhatsappCode } from "./whatsapp";

export async function sendRegisterVerificationCode(userPhone: string) {
  const user = await prisma.user.findUnique({
    where: { phone: userPhone },
  });

  if (!user) {
    throw new HttpError(404, "Usuário não encontrado");
  }

  if (user.verified) {
    throw new HttpError(400, "Conta já verificada anteriomente");
  }

  await prisma.whatsappCode.deleteMany({
    where: {
      userPhone,
      type: "register",
    },
  });

  const { code } = await generateWhatsappCode(user, "register", 3);

  try {
    await sendWhatsappCode(user.phone, code);
    return { deliveryStatus: "sent" as const };
  } catch (err) {
    console.error("Erro ao enviar código de registro (service):", err);
    return { deliveryStatus: "failed" as const };
  }
}
