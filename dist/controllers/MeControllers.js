"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.me = void 0;
const database_1 = require("../database");
const me = async (req, res, next) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: "Não autenticado" });
        }
        const user = await database_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                verified: true,
                accountId: true,
            },
        });
        if (!user) {
            return res.status(401).json({ message: "Usuário não encontrado" });
        }
        return res.json({ user });
    }
    catch (err) {
        next(err);
    }
};
exports.me = me;
