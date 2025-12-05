// src/database/index.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client"; // 👈 AGORA É DAQUI

const connectionString = process.env.DATABASE_URL!; // ou trata erro se quiser

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
