"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeProvider = void 0;
const tslib_1 = require("tslib");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const toml_1 = require("toml");
const lodash_1 = require("lodash");
const stripe_1 = require("stripe");
const error_1 = (0, tslib_1.__importDefault)(require("../utils/error"));
const STRIPE_DEFINITION = {
    type: "object",
    properties: {
        profile: { type: "string" },
    },
    additionalProperties: false,
};
class StripeProvider {
    constructor(serverless, id, profile) {
        this.serverless = serverless;
        this.id = id;
        this.config = this.resolveConfiguration(profile);
        this.sdk = new stripe_1.Stripe(this.config.apiKey, { apiVersion: "2020-08-27" });
    }
    static registerConstructs(...constructClasses) {
        for (const constructClass of constructClasses) {
            if (constructClass.type in this.constructClasses) {
                throw new error_1.default(`The construct type '${constructClass.type}' was registered twice`, "LIFT_CONSTRUCT_TYPE_CONFLICT");
            }
            this.constructClasses[constructClass.type] = constructClass;
        }
    }
    static getConstructClass(type) {
        return this.constructClasses[type];
    }
    static getAllConstructClasses() {
        return Object.values(this.constructClasses);
    }
    static create(serverless, id, { profile }) {
        return new this(serverless, id, profile);
    }
    createConstruct(type, id) {
        const Construct = StripeProvider.getConstructClass(type);
        if (Construct === undefined) {
            throw new error_1.default(`The construct '${id}' has an unknown type '${type}'\n` +
                "Find all construct types available here: https://github.com/getlift/lift#constructs", "LIFT_UNKNOWN_CONSTRUCT_TYPE");
        }
        const configuration = (0, lodash_1.get)(this.serverless.configurationInput.constructs, id, {});
        return Construct.create(this, id, configuration);
    }
    resolveConfiguration(profile) {
        var _a;
        // Sourcing from env
        if (profile === undefined && typeof process.env.STRIPE_API_KEY === "string") {
            return { apiKey: process.env.STRIPE_API_KEY };
        }
        // Sourcing from TOML configuration file
        const configsPath = (_a = process.env.XDG_CONFIG_HOME) !== null && _a !== void 0 ? _a : (0, path_1.resolve)((0, os_1.homedir)(), ".config");
        const stripeConfigFilePath = (0, path_1.resolve)(configsPath, "stripe/config.toml");
        if (!(0, fs_1.existsSync)(stripeConfigFilePath)) {
            throw new error_1.default("Could not source any Stripe configuration. Have you set your STRIPE_API_KEY environment?", "STRIPE_MISSING_CONFIGURATION");
        }
        const stripeConfigurationFileContent = (0, fs_1.readFileSync)(stripeConfigFilePath);
        const stripeConfigurations = (0, toml_1.parse)(stripeConfigurationFileContent.toString());
        if (profile !== undefined) {
            if (!(0, lodash_1.has)(stripeConfigurations, profile)) {
                throw new error_1.default(`There is no ${profile} profile in your stripe configuration. Found profiles are ${Object.keys(stripeConfigurations)
                    .filter((stripeConfiguration) => stripeConfiguration !== "color")
                    .join(", ")}`, "STRIPE_MISSING_PROFILE");
            }
            const stripeConfig = stripeConfigurations[profile];
            return {
                apiKey: stripeConfig.test_mode_api_key,
                accountId: stripeConfig.account_id,
            };
        }
        // Fallback to default profile
        if (!(0, lodash_1.has)(stripeConfigurations, "default")) {
            throw new error_1.default(`There is no default profile in your stripe configuration. Please provide one of the found profiles: ${Object.keys(stripeConfigurations)
                .filter((stripeConfiguration) => stripeConfiguration !== "color")
                .join(", ")}`, "STRIPE_MISSING_DEFAULT_PROFILE");
        }
        const defaultStripeConfig = stripeConfigurations.default;
        return {
            apiKey: defaultStripeConfig.test_mode_api_key,
            accountId: defaultStripeConfig.account_id,
        };
    }
}
exports.StripeProvider = StripeProvider;
StripeProvider.type = "stripe";
StripeProvider.schema = STRIPE_DEFINITION;
StripeProvider.constructClasses = {};
//# sourceMappingURL=StripeProvider.js.map