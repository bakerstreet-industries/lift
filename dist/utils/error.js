"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Represents a user error.
 *
 * This class mirrors the official ServerlessError class:
 * https://github.com/serverless/serverless/blob/f4c9b58b10a45ae342934e9a61dcdea0c2ef11e2/lib/serverless-error.js
 * The original class is available via `serverless.classes.Error` but that means
 * we must hold an instance of the `serverless` object to use it.
 * That isn't always the case, for example in constructs, which are decoupled from the `serverless` object.
 */
class ServerlessError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "ServerlessError";
        this.code = code;
    }
}
exports.default = ServerlessError;
//# sourceMappingURL=error.js.map