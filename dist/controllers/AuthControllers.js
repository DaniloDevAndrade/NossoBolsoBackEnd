"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthControllers = void 0;
const bcrypt_ts_1 = require("bcrypt-ts");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const AuthRequestsSchema_1 = require("./schemas/AuthRequestsSchema");
const database_1 = require("../database");
const whatsappCode_1 = require("../utils/whatsappCode");
const generateAndSendWhatsappCode_1 = require("../services/generateAndSendWhatsappCode");
const sendRegisterVerificationCode_1 = require("../services/sendRegisterVerificationCode");
const whatsapp_1 = require("../services/whatsapp");
const HttpError_1 = require("../errors/HttpError");
const authSession_1 = require("../services/authSession");
const JWT_RESET_SECRET = process.env.JWT_SECRET || "changeme-reset-secret";
// Schemas específicos do fluxo de LOGIN por challengeId
const LoginVerifySchema = zod_1.z.object({
    challengeId: zod_1.z.string().min(1, "challengeId é obrigatório"),
    code: zod_1.z.string().length(6, "Codigo deve conter 6 caracteres"),
});
const ResendLoginCodeSchema = zod_1.z.object({
    challengeId: zod_1.z.string().min(1, "challengeId é obrigatório"),
});
class AuthControllers {
    constructor() {
        // POST /auth/register
        this.register = async (req, res, next) => {
            try {
                const data = AuthRequestsSchema_1.RegisterUserRequestSchema.parse(req.body);
                const passwordHash = (0, bcrypt_ts_1.hashSync)(data.password, 10);
                const existing = await database_1.prisma.user.findFirst({
                    where: {
                        OR: [
                            { email: { equals: data.email, mode: "insensitive" } },
                            { phone: data.phone },
                        ],
                    },
                });
                if (existing) {
                    if (existing.verified) {
                        return res
                            .status(409)
                            .json({ message: "Email ou telefone já está cadastrado." });
                    }
                    let deliveryStatus = "sent";
                    try {
                        const { code } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(existing, "register", 3);
                        await (0, whatsapp_1.sendWhatsappCode)(existing.phone, code);
                    }
                    catch (err) {
                        console.error("Erro ao enviar código de verificação", err);
                        deliveryStatus = "failed";
                    }
                    return res.status(200).json({
                        message: deliveryStatus === "sent"
                            ? "Essa conta já foi criada, mas ainda não foi verificada. Enviamos um novo código via WhatsApp."
                            : "Essa conta já foi criada, mas não conseguimos enviar o código via WhatsApp. Você poderá conferir e alterar o número na próxima tela.",
                        userPhone: existing.phone,
                        status: "pending_verification",
                        deliveryStatus,
                    });
                }
                const user = await database_1.prisma.user.create({
                    data: {
                        name: data.name,
                        email: data.email,
                        phone: data.phone,
                        password: passwordHash,
                        verified: false,
                    },
                });
                let deliveryStatus = "sent";
                try {
                    const { code } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "register", 3);
                    await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
                }
                catch (err) {
                    console.error("Erro ao enviar código de verificação (novo):", err);
                    deliveryStatus = "failed";
                }
                return res.status(201).json({
                    message: deliveryStatus === "sent"
                        ? "Usuário criado. Código enviado via WhatsApp."
                        : "Usuário criado, mas não foi possível enviar o código via WhatsApp. Você poderá conferir e alterar o número na próxima tela.",
                    userPhone: user.phone,
                    status: "created",
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/register/verify
        this.verifyRegister = async (req, res, next) => {
            try {
                const { userPhone, code } = AuthRequestsSchema_1.VerifyUserRequestSchema.parse(req.body);
                const record = await database_1.prisma.whatsappCode.findFirst({
                    where: {
                        userPhone,
                        type: "register",
                    },
                    orderBy: { createdAt: "desc" },
                });
                if (!record) {
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                const now = new Date();
                if (record.expiresAt <= now) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                if (record.attempts >= 5) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(429).json({
                        message: "Muitas tentativas inválidas. Solicite um novo código.",
                    });
                }
                const isValid = (0, whatsappCode_1.verifyCode)(code, record.codeHash);
                if (!isValid) {
                    const nextAttempts = record.attempts + 1;
                    if (nextAttempts >= 5) {
                        await database_1.prisma.whatsappCode.delete({
                            where: { id: record.id },
                        });
                        return res.status(429).json({
                            message: "Muitas tentativas inválidas. Solicite um novo código.",
                        });
                    }
                    await database_1.prisma.whatsappCode.update({
                        where: { id: record.id },
                        data: {
                            attempts: { increment: 1 },
                        },
                    });
                    return res.status(400).json({ message: "Código inválido" });
                }
                const updatedUser = await database_1.prisma.$transaction(async (tx) => {
                    const user = await tx.user.findUnique({
                        where: { phone: userPhone },
                        include: { account: true },
                    });
                    if (!user) {
                        throw new HttpError_1.HttpError(404, "Usuário não encontrado");
                    }
                    let accountId = user.accountId;
                    if (!accountId) {
                        const account = await tx.account.create({
                            data: {
                                type: "couple",
                            },
                        });
                        accountId = account.id;
                    }
                    const u = await tx.user.update({
                        where: { id: user.id },
                        data: {
                            verified: true,
                            accountId,
                        },
                    });
                    await tx.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return u;
                });
                (0, authSession_1.createUserSession)(res, updatedUser.id);
                return res.status(200).json({
                    message: "Conta verificada com sucesso",
                    user: {
                        id: updatedUser.id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                    },
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/register/resend-code
        this.resendRegisterCode = async (req, res, next) => {
            try {
                const { userPhone } = AuthRequestsSchema_1.UserPhoneSchema.parse(req.body);
                const { deliveryStatus } = await (0, sendRegisterVerificationCode_1.sendRegisterVerificationCode)(userPhone);
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Novo código enviado via WhatsApp"
                        : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos ou confira seu número.",
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/register/change-number
        this.changeNumberRegister = async (req, res, next) => {
            try {
                const { userPhone, newUserPhone } = AuthRequestsSchema_1.ChangeNumberSchema.parse(req.body);
                if (userPhone === newUserPhone) {
                    return res
                        .status(409)
                        .json({ message: "Os números não podem ser iguais." });
                }
                const user = await database_1.prisma.user.findUnique({
                    where: { phone: userPhone },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado" });
                }
                if (user.verified) {
                    return res
                        .status(400)
                        .json({ message: "Conta já verificada anteriormente" });
                }
                const newNumberExits = await database_1.prisma.user.findUnique({
                    where: { phone: newUserPhone },
                });
                if (newNumberExits) {
                    return res
                        .status(409)
                        .json({ message: "Novo número já é utilizado por outro usuário." });
                }
                await database_1.prisma.user.update({
                    where: { id: user.id },
                    data: { phone: newUserPhone },
                });
                const { deliveryStatus } = await (0, sendRegisterVerificationCode_1.sendRegisterVerificationCode)(newUserPhone);
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Telefone atualizado e novo código enviado"
                        : "Telefone atualizado, mas não conseguimos enviar o código. Tente reenviar ou conferir o número.",
                    userPhone: newUserPhone,
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/login
        this.login = async (req, res, next) => {
            try {
                const { emailOrPhone, password } = req.body;
                if (!emailOrPhone || !password) {
                    return res
                        .status(400)
                        .json({ message: "Email/telefone e senha são obrigatórios." });
                }
                const user = await database_1.prisma.user.findFirst({
                    where: {
                        OR: [
                            { email: { equals: emailOrPhone, mode: "insensitive" } },
                            { phone: emailOrPhone },
                        ],
                    },
                });
                if (!user) {
                    // não revela se é email/telefone inválido
                    return res.status(401).json({ message: "Credenciais inválidas" });
                }
                const ok = (0, bcrypt_ts_1.compareSync)(password, user.password);
                if (!ok) {
                    return res.status(401).json({ message: "Credenciais inválidas" });
                }
                if (!user.verified) {
                    return res
                        .status(403)
                        .json({ message: "Conta não verificada via WhatsApp" });
                }
                let deliveryStatus = "sent";
                const { code, newChallengeId } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "login", 5);
                try {
                    await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
                }
                catch (err) {
                    console.error("Erro ao enviar código de login via WhatsApp:", err);
                    deliveryStatus = "failed";
                }
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Código de login enviado via WhatsApp."
                        : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
                    userPhone: user.phone,
                    newChallengeId,
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/login/verify
        this.verifyLogin = async (req, res, next) => {
            try {
                const { challengeId, code } = LoginVerifySchema.parse(req.body);
                const record = await database_1.prisma.whatsappCode.findFirst({
                    where: {
                        challengeId,
                        type: "login",
                    },
                    orderBy: { createdAt: "desc" },
                    include: { user: true },
                });
                if (!record || !record.user) {
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                const now = new Date();
                if (record.expiresAt <= now) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                if (record.attempts >= 5) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(429).json({
                        message: "Muitas tentativas inválidas. Solicite um novo código.",
                    });
                }
                const isValid = (0, whatsappCode_1.verifyCode)(code, record.codeHash);
                if (!isValid) {
                    const nextAttempts = record.attempts + 1;
                    if (nextAttempts >= 5) {
                        await database_1.prisma.whatsappCode.delete({
                            where: { id: record.id },
                        });
                        return res.status(429).json({
                            message: "Muitas tentativas inválidas. Solicite um novo código.",
                        });
                    }
                    await database_1.prisma.whatsappCode.update({
                        where: { id: record.id },
                        data: {
                            attempts: { increment: 1 },
                        },
                    });
                    return res.status(400).json({ message: "Código inválido" });
                }
                await database_1.prisma.whatsappCode.delete({
                    where: { id: record.id },
                });
                (0, authSession_1.createUserSession)(res, record.user.id);
                return res.status(200).json({
                    message: "Login realizado com sucesso",
                    user: {
                        id: record.user.id,
                        name: record.user.name,
                        email: record.user.email,
                    },
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/login/resend-code
        this.resendLoginCode = async (req, res, next) => {
            try {
                const { challengeId } = AuthRequestsSchema_1.LoginResendCodeSchema.parse(req.body);
                const whatsCode = await database_1.prisma.whatsappCode.findUnique({
                    where: { challengeId },
                });
                if (!whatsCode || whatsCode.type !== "login") {
                    return res
                        .status(400)
                        .json({ message: "Não foi possível enviar um novo código." });
                }
                const user = await database_1.prisma.user.findUnique({
                    where: {
                        phone: whatsCode.userPhone,
                    },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado" });
                }
                if (!user.verified) {
                    return res.status(403).json({ message: "Conta não verificada" });
                }
                let deliveryStatus = "sent";
                const { code, newChallengeId } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "login", 5);
                try {
                    await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
                }
                catch (err) {
                    console.error("Erro ao reenviar código de login via WhatsApp:", err);
                    deliveryStatus = "failed";
                }
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Novo código de login enviado via WhatsApp."
                        : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
                    userPhone: user.phone,
                    challengeId: newChallengeId,
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/password/forgot
        this.forgotPassword = async (req, res, next) => {
            try {
                const { email } = req.body;
                if (!email) {
                    return res.status(400).json({ message: "Email é obrigatório." });
                }
                const user = await database_1.prisma.user.findFirst({
                    where: {
                        email: {
                            equals: email,
                            mode: "insensitive",
                        },
                    },
                });
                // Segurança: não revela se o email existe ou não
                if (!user || !user.verified) {
                    return res.status(200).json({
                        message: "Se o email estiver cadastrado, você receberá um código via WhatsApp.",
                        deliveryStatus: "sent",
                    });
                }
                let deliveryStatus = "sent";
                const { code } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "reset_password", 5);
                try {
                    await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
                }
                catch (err) {
                    console.error("Erro ao enviar código de reset de senha via WhatsApp:", err);
                    deliveryStatus = "failed";
                }
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Enviamos um código de recuperação de senha via WhatsApp."
                        : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
                    userPhone: user.phone,
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/password/reset/verify
        this.resetPasswordVerify = async (req, res, next) => {
            try {
                const { userPhone, code } = AuthRequestsSchema_1.VerifyUserRequestSchema.parse(req.body);
                const record = await database_1.prisma.whatsappCode.findFirst({
                    where: {
                        userPhone,
                        type: "reset_password",
                    },
                    orderBy: { createdAt: "desc" },
                    include: { user: true },
                });
                if (!record || !record.user) {
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                const now = new Date();
                if (record.expiresAt <= now) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(400).json({ message: "Código inválido ou expirado" });
                }
                if (record.attempts >= 5) {
                    await database_1.prisma.whatsappCode.delete({
                        where: { id: record.id },
                    });
                    return res.status(429).json({
                        message: "Muitas tentativas inválidas. Solicite um novo código.",
                    });
                }
                const isValid = (0, whatsappCode_1.verifyCode)(code, record.codeHash);
                if (!isValid) {
                    const nextAttempts = record.attempts + 1;
                    if (nextAttempts >= 5) {
                        await database_1.prisma.whatsappCode.delete({
                            where: { id: record.id },
                        });
                        return res.status(429).json({
                            message: "Muitas tentativas inválidas. Solicite um novo código.",
                        });
                    }
                    await database_1.prisma.whatsappCode.update({
                        where: { id: record.id },
                        data: {
                            attempts: { increment: 1 },
                        },
                    });
                    return res.status(400).json({ message: "Código inválido" });
                }
                await database_1.prisma.whatsappCode.delete({
                    where: { id: record.id },
                });
                const resetToken = jsonwebtoken_1.default.sign({
                    sub: record.user.id,
                    type: "reset_password",
                }, JWT_RESET_SECRET, {
                    expiresIn: "15m",
                });
                return res.status(200).json({
                    message: "Código de recuperação verificado com sucesso.",
                    resetToken,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/password/reset
        this.resetPassword = async (req, res, next) => {
            try {
                const { resetToken, newPassword } = req.body;
                if (!resetToken) {
                    return res
                        .status(400)
                        .json({ message: "Token de recuperação é obrigatório." });
                }
                if (!newPassword) {
                    return res
                        .status(400)
                        .json({ message: "Nova senha é obrigatória." });
                }
                if (newPassword.length < 8) {
                    return res.status(400).json({
                        message: "A nova senha deve ter pelo menos 8 caracteres.",
                    });
                }
                let payload;
                try {
                    payload = jsonwebtoken_1.default.verify(resetToken, JWT_RESET_SECRET);
                }
                catch (err) {
                    return res
                        .status(400)
                        .json({ message: "Token de recuperação inválido ou expirado." });
                }
                if (!payload || payload.type !== "reset_password" || !payload.sub) {
                    return res
                        .status(400)
                        .json({ message: "Token de recuperação inválido." });
                }
                const userId = payload.sub;
                const newPasswordHash = (0, bcrypt_ts_1.hashSync)(newPassword, 10);
                const updatedUser = await database_1.prisma.user.update({
                    where: { id: userId },
                    data: { password: newPasswordHash },
                });
                (0, authSession_1.createUserSession)(res, updatedUser.id);
                return res.status(200).json({
                    message: "Senha redefinida com sucesso.",
                    user: {
                        id: updatedUser.id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                    },
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /auth/password/reset/resend
        this.resendResetPasswordCode = async (req, res, next) => {
            try {
                const { userPhone } = AuthRequestsSchema_1.UserPhoneSchema.parse(req.body);
                const user = await database_1.prisma.user.findUnique({
                    where: { phone: userPhone },
                });
                if (!user || !user.verified) {
                    return res.status(200).json({
                        message: "Se o telefone estiver cadastrado, você receberá um novo código.",
                        deliveryStatus: "sent",
                    });
                }
                let deliveryStatus = "sent";
                const { code } = await (0, generateAndSendWhatsappCode_1.generateWhatsappCode)(user, "reset_password", 5);
                try {
                    await (0, whatsapp_1.sendWhatsappCode)(user.phone, code);
                }
                catch (err) {
                    console.error("Erro ao reenviar código de reset de senha via WhatsApp:", err);
                    deliveryStatus = "failed";
                }
                return res.status(200).json({
                    message: deliveryStatus === "sent"
                        ? "Novo código de recuperação de senha enviado via WhatsApp."
                        : "Não conseguimos enviar o código agora. Tente novamente em alguns minutos.",
                    userPhone: user.phone,
                    deliveryStatus,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // GET /auth/logout
        this.logout = async (req, res, next) => {
            try {
                const token = req.cookies?.access_token;
                if (!token) {
                    return res.status(401).json({
                        message: "Você não está logado.",
                    });
                }
                try {
                    jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                }
                catch {
                    // mesmo inválido, força limpeza do cookie
                    (0, authSession_1.clearUserSession)(res);
                    return res.status(401).json({
                        message: "Sessão expirada. Logout forçado.",
                    });
                }
                (0, authSession_1.clearUserSession)(res);
                return res.status(200).json({
                    message: "Logout realizado com sucesso.",
                });
            }
            catch (err) {
                next(err);
            }
        };
    }
}
exports.AuthControllers = AuthControllers;
