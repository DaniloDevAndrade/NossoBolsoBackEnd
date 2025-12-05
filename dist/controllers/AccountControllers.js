"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountControllers = void 0;
const database_1 = require("../database");
const bcrypt_ts_1 = require("bcrypt-ts");
const authSession_1 = require("../services/authSession");
const AccountRequestsSchema_1 = require("./schemas/AccountRequestsSchema");
class AccountControllers {
    constructor() {
        // GET /account/me
        this.me = async (req, res, next) => {
            try {
                const authUserId = req.userId;
                if (!authUserId) {
                    return res.status(401).json({ message: "Não autenticado." });
                }
                const user = await database_1.prisma.user.findUnique({
                    where: { id: authUserId },
                    include: {
                        account: {
                            include: {
                                users: true,
                            },
                        },
                        // convites enviados aguardando resposta
                        sentRequests: {
                            where: { status: "PENDING" },
                            include: {
                                receiver: true,
                                account: true,
                            },
                        },
                        // convites recebidos aguardando resposta
                        receivedRequests: {
                            where: { status: "PENDING" },
                            include: {
                                sender: true,
                                account: true,
                            },
                        },
                    },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado." });
                }
                let partnerStatus = "none";
                let partner = null;
                // 1) PRIORIDADE: conta compartilhada (parceiro conectado)
                if (user.account && user.account.users.length > 1) {
                    partnerStatus = "connected";
                    const otherUser = user.account.users.find((u) => u.id !== authUserId) || null;
                    if (otherUser) {
                        partner = {
                            id: otherUser.id,
                            name: otherUser.name,
                            email: otherUser.email,
                            phone: otherUser.phone,
                        };
                    }
                }
                else {
                    // 2) Se não tiver conta compartilhada, verifica se existe convite pendente
                    const pendingSent = user.sentRequests[0];
                    const pendingReceived = user.receivedRequests[0];
                    const pending = pendingSent || pendingReceived;
                    if (pending) {
                        partnerStatus = "pending";
                        const otherUser = pendingSent ? pendingSent.receiver : pendingReceived.sender;
                        if (otherUser) {
                            partner = {
                                id: otherUser.id,
                                name: otherUser.name,
                                email: otherUser.email,
                                phone: otherUser.phone,
                            };
                        }
                    }
                }
                const trialEndsAt = user.account?.trialEndsAt ?? null;
                return res.status(200).json({
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        phone: user.phone,
                    },
                    partner,
                    partnerStatus,
                    trialEndsAt,
                });
            }
            catch (err) {
                next(err);
            }
        };
        // PATCH /account/profile
        this.updateProfile = async (req, res, next) => {
            try {
                const authUserId = req.userId;
                if (!authUserId) {
                    return res.status(401).json({ message: "Não autenticado." });
                }
                const { name, email } = AccountRequestsSchema_1.UpdateProfileSchema.parse(req.body);
                const user = await database_1.prisma.user.findUnique({
                    where: { id: authUserId },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado." });
                }
                const conflictUser = await database_1.prisma.user.findFirst({
                    where: {
                        OR: [{ email: { equals: email, mode: "insensitive" } }],
                        NOT: { id: authUserId },
                    },
                });
                if (conflictUser) {
                    return res.status(409).json({
                        message: "Email já está sendo utilizado por outro usuário.",
                    });
                }
                const updatedUser = await database_1.prisma.user.update({
                    where: { id: authUserId },
                    data: {
                        name,
                        email,
                    },
                });
                (0, authSession_1.createUserSession)(res, updatedUser.id);
                return res.status(200).json({
                    message: "Perfil atualizado com sucesso.",
                    user: {
                        id: updatedUser.id,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        phone: updatedUser.phone,
                    },
                });
            }
            catch (err) {
                next(err);
            }
        };
        // POST /account/change-password
        this.changePassword = async (req, res, next) => {
            try {
                const authUserId = req.userId;
                if (!authUserId) {
                    return res.status(401).json({ message: "Não autenticado." });
                }
                const { currentPassword, newPassword } = AccountRequestsSchema_1.ChangePasswordSchema.parse(req.body);
                const user = await database_1.prisma.user.findUnique({
                    where: { id: authUserId },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado." });
                }
                const ok = (0, bcrypt_ts_1.compareSync)(currentPassword, user.password);
                if (!ok) {
                    return res.status(401).json({ message: "Senha atual inválida." });
                }
                const samePassword = (0, bcrypt_ts_1.compareSync)(newPassword, user.password);
                if (samePassword) {
                    return res
                        .status(400)
                        .json({ message: "A nova senha não pode ser igual à senha atual." });
                }
                const newPasswordHash = (0, bcrypt_ts_1.hashSync)(newPassword, 10);
                const updatedUser = await database_1.prisma.user.update({
                    where: { id: authUserId },
                    data: { password: newPasswordHash },
                });
                (0, authSession_1.createUserSession)(res, updatedUser.id);
                return res.status(200).json({
                    message: "Senha alterada com sucesso.",
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
        // DELETE /account/destroy
        this.destroyAccount = async (req, res, next) => {
            try {
                const authUserId = req.userId;
                if (!authUserId) {
                    return res.status(401).json({ message: "Não autenticado." });
                }
                const user = await database_1.prisma.user.findUnique({
                    where: { id: authUserId },
                    include: {
                        account: {
                            include: {
                                users: true,
                            },
                        },
                    },
                });
                if (!user) {
                    return res.status(404).json({ message: "Usuário não encontrado." });
                }
                const account = user.account;
                const accountId = account?.id ?? null;
                const accountUsersCount = account?.users?.length ?? 0;
                await database_1.prisma.$transaction(async (tx) => {
                    await tx.expense.deleteMany({
                        where: { createdById: authUserId },
                    });
                    await tx.income.deleteMany({
                        where: { createdById: authUserId },
                    });
                    await tx.creditCard.deleteMany({
                        where: { userId: authUserId },
                    });
                    await tx.partnerRequest.deleteMany({
                        where: {
                            OR: [{ senderId: authUserId }, { receiverId: authUserId }],
                        },
                    });
                    if (accountId && accountUsersCount <= 1) {
                        await tx.expense.deleteMany({
                            where: { accountId },
                        });
                        await tx.income.deleteMany({
                            where: { accountId },
                        });
                        await tx.creditCard.deleteMany({
                            where: { accountId },
                        });
                        await tx.user.delete({
                            where: { id: authUserId },
                        });
                        await tx.account.delete({
                            where: { id: accountId },
                        });
                    }
                    else {
                        await tx.user.delete({
                            where: { id: authUserId },
                        });
                    }
                });
                res.clearCookie("access_token", {
                    httpOnly: true,
                    sameSite: "lax",
                    secure: true,
                });
                return res.status(200).json({
                    message: accountId && accountUsersCount <= 1
                        ? "Sua conta e todos os dados relacionados foram destruídos com sucesso."
                        : "Seu usuário e seus dados foram destruídos com sucesso. A conta do outro usuário foi preservada.",
                });
            }
            catch (err) {
                next(err);
            }
        };
    }
}
exports.AccountControllers = AccountControllers;
