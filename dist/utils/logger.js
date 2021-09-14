"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debug = exports.log = void 0;
const tslib_1 = require("tslib");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
function log(message) {
    console.log("Lift: " + chalk_1.default.yellow(message));
}
exports.log = log;
function debug(message) {
    if (process.env.SLS_DEBUG !== undefined) {
        console.log(chalk_1.default.gray("Lift: " + message));
    }
}
exports.debug = debug;
//# sourceMappingURL=logger.js.map