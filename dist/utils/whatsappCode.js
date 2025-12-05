"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = generateCode;
exports.hashCode = hashCode;
exports.verifyCode = verifyCode;
exports.minutesFromNow = minutesFromNow;
const bcrypt_ts_1 = require("bcrypt-ts");
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function hashCode(code) {
    return (0, bcrypt_ts_1.hashSync)(code, 10);
}
function verifyCode(code, hash) {
    return (0, bcrypt_ts_1.compareSync)(code, hash);
}
function minutesFromNow(minutes) {
    return new Date(Date.now() + minutes * 60 * 1000);
}
