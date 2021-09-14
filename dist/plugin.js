"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const lodash_1 = require("lodash");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
const path = (0, tslib_1.__importStar)(require("path"));
const fs_1 = require("fs");
const js_yaml_1 = require("js-yaml");
const core_1 = require("@aws-cdk/core");
const providers_1 = require("./providers");
const logger_1 = require("./utils/logger");
const error_1 = (0, tslib_1.__importDefault)(require("./utils/error"));
const PROVIDER_ID_PATTERN = "^[a-zA-Z0-9-_]+$";
// This enables all existing constructs defined prior intoduction of "providers" property to work
const DEFAULT_PROVIDER = "defaultAwsProvider";
const PROVIDERS_DEFINITION = {
    type: "object",
    patternProperties: {
        [PROVIDER_ID_PATTERN]: {
            allOf: [
                {
                    type: "object",
                    properties: {
                        type: { type: "string" },
                    },
                    required: ["type"],
                },
            ],
        },
    },
    additionalProperties: false,
};
const CONSTRUCT_ID_PATTERN = "^[a-zA-Z0-9-_]+$";
const CONSTRUCTS_DEFINITION = {
    type: "object",
    patternProperties: {
        [CONSTRUCT_ID_PATTERN]: {
            allOf: [
                {
                    type: "object",
                    properties: {
                        type: { type: "string" },
                        provider: { type: "string" },
                    },
                    required: ["type"],
                },
            ],
        },
    },
    additionalProperties: false,
};
const LIFT_CONFIG_SCHEMA = {
    type: "object",
    properties: {
        automaticPermissions: { type: "boolean" },
    },
    additionalProperties: false,
};
/**
 * Serverless plugin
 */
class LiftPlugin {
    constructor(serverless, cliOptions) {
        this.providersSchema = PROVIDERS_DEFINITION;
        this.constructsSchema = CONSTRUCTS_DEFINITION;
        this.commands = {};
        this.serverless = serverless;
        // This method is exposed for Lift tests only, it is not a public API
        Object.assign(this.serverless, { getLiftProviderById: this.getLiftProviderById.bind(this) });
        this.cliOptions = cliOptions;
        this.commands.lift = {
            commands: {
                eject: {
                    usage: "Eject Lift constructs to raw CloudFormation",
                    lifecycleEvents: ["eject"],
                },
            },
        };
        this.hooks = {
            initialize: () => {
                this.loadConstructs();
                this.appendPermissions();
                this.resolveLazyVariables();
            },
            "before:aws:info:displayStackOutputs": this.info.bind(this),
            "after:package:compileEvents": this.appendCloudformationResources.bind(this),
            "after:deploy:deploy": this.postDeploy.bind(this),
            "before:remove:remove": this.preRemove.bind(this),
            "lift:eject:eject": this.eject.bind(this),
        };
        this.configurationVariablesSources = {
            construct: {
                resolve: this.resolveReference.bind(this),
            },
        };
        this.variableResolvers = {
            construct: (fullVariable) => {
                const address = fullVariable.split(":")[1];
                return Promise.resolve(this.resolveReference({ address }).value);
            },
        };
        this.providers = { [DEFAULT_PROVIDER]: new providers_1.AwsProvider(this.serverless) };
        this.loadProviders();
        this.registerConstructsSchema();
        this.registerProvidersSchema();
        this.registerConfigSchema();
        this.registerCommands();
    }
    registerConstructsSchema() {
        this.constructsSchema.patternProperties[CONSTRUCT_ID_PATTERN].allOf.push({
            oneOf: this.getAllConstructClasses().map((Construct) => {
                return this.defineSchemaWithType(Construct.type, Construct.schema);
            }),
        });
    }
    registerProvidersSchema() {
        this.providersSchema.patternProperties[PROVIDER_ID_PATTERN].allOf.push({
            oneOf: LiftPlugin.getAllProviderClasses().map((Provider) => {
                return this.defineSchemaWithType(Provider.type, Provider.schema);
            }),
        });
    }
    defineSchemaWithType(type, configSchema) {
        return (0, lodash_1.merge)(configSchema, { properties: { type: { const: type } } });
    }
    registerConfigSchema() {
        this.serverless.configSchemaHandler.defineTopLevelProperty("lift", LIFT_CONFIG_SCHEMA);
        this.serverless.configSchemaHandler.defineTopLevelProperty("constructs", this.constructsSchema);
        this.serverless.configSchemaHandler.defineTopLevelProperty("providers", this.providersSchema);
    }
    static registerProviders(...providerClasses) {
        for (const providerClass of providerClasses) {
            if (providerClass.type in this.providerClasses) {
                throw new error_1.default(`The provider type '${providerClass.type}' was registered twice`, "LIFT_PROVIDER_TYPE_CONFLICT");
            }
            this.providerClasses[providerClass.type] = providerClass;
        }
    }
    static getProviderClass(type) {
        return this.providerClasses[type];
    }
    static getAllProviderClasses() {
        return Object.values(this.providerClasses);
    }
    loadProviders() {
        const providersInputConfiguration = (0, lodash_1.get)(this.serverless.configurationInput, "providers", {});
        for (const [id, { type }] of Object.entries(providersInputConfiguration)) {
            this.providers[id] = this.createProvider(type, id);
        }
    }
    createProvider(type, id) {
        if (type === providers_1.AwsProvider.type) {
            throw new error_1.default("AwsProvider is not configurable via providers", "LIFT_AWS_PROVIDER_CONFIGURATION");
        }
        const Provider = LiftPlugin.getProviderClass(type);
        if (Provider === undefined) {
            throw new error_1.default(`The provider '${id}' has an unknown type '${type}'`, "LIFT_UNKNOWN_PROVIDER_TYPE");
        }
        const configuration = (0, lodash_1.get)(this.serverless.configurationInput.providers, id, {});
        return Provider.create(this.serverless, id, configuration);
    }
    loadConstructs() {
        if (this.constructs !== undefined) {
            // Safeguard
            throw new Error("Constructs are already initialized: this should not happen");
        }
        this.constructs = {};
        const constructsInputConfiguration = (0, lodash_1.get)(this.serverless.configurationInput, "constructs", {});
        for (const [id, { type, provider: providerId }] of Object.entries(constructsInputConfiguration)) {
            // Legacy behavior -> defaults to Serverless framework AWS provider
            if (providerId === undefined) {
                this.constructs[id] = this.providers[DEFAULT_PROVIDER].createConstruct(type, id);
                continue;
            }
            const provider = this.getLiftProviderById(providerId);
            if (!provider) {
                throw new error_1.default(`No provider ${providerId} was found for construct ${id}. Available providers are ${Object.keys(this.providers).join(", ")}`, "LIFT_UNKNOWN_PROVIDER_ID");
            }
            this.constructs[id] = provider.createConstruct(type, id);
        }
    }
    getConstructs() {
        if (this.constructs === undefined) {
            // Safeguard
            throw new Error("Constructs are not initialized: this should not happen");
        }
        return this.constructs;
    }
    getLiftProviderById(id) {
        return this.providers[id];
    }
    resolveReference({ address }) {
        return {
            /**
             * Construct variables are resolved lazily using the CDK's "Token" system.
             * CDK Lazy values generate a unique `${Token[TOKEN.63]}` string. These strings
             * can later be resolved to the real value (which we do in `initialize()`).
             * Problem:
             * - Lift variables need constructs to be resolved
             * - Constructs can be created when Serverless variables are resolved
             * - Serverless variables must resolve Lift variables
             * This is a chicken and egg problem.
             * Solution:
             * - Serverless boots, plugins are created
             * - variables are resolved
             *   - Lift variables are resolved to CDK tokens (`${Token[TOKEN.63]}`) via `Lazy.any(...)`
             *     (we can't resolve the actual values since we don't have the constructs yet)
             * - `initialize` hook
             *   - Lift builds the constructs
             *   - CDK tokens are resolved into real value: we can now do that using the CDK "token resolver"
             */
            value: core_1.Lazy.any({
                produce: () => {
                    const constructs = this.getConstructs();
                    const [id, property] = address.split(".", 2);
                    if (!(0, lodash_1.has)(this.constructs, id)) {
                        throw new error_1.default(`No construct named '${id}' was found, the \${construct:${id}.${property}} variable is invalid.`, "LIFT_VARIABLE_UNKNOWN_CONSTRUCT");
                    }
                    const construct = constructs[id];
                    const properties = construct.variables ? construct.variables() : {};
                    if (!(0, lodash_1.has)(properties, property)) {
                        if (Object.keys(properties).length === 0) {
                            throw new error_1.default(`\${construct:${id}.${property}} does not exist. The construct '${id}' does not expose any property`, "LIFT_VARIABLE_UNKNOWN_PROPERTY");
                        }
                        throw new error_1.default(`\${construct:${id}.${property}} does not exist. Properties available on \${construct:${id}} are: ${Object.keys(properties).join(", ")}`, "LIFT_VARIABLE_UNKNOWN_PROPERTY");
                    }
                    return properties[property];
                },
            }).toString(),
        };
    }
    async info() {
        const constructs = this.getConstructs();
        for (const [id, construct] of Object.entries(constructs)) {
            if (typeof construct.outputs !== "function") {
                continue;
            }
            const outputs = construct.outputs();
            if (Object.keys(outputs).length > 0) {
                console.log(chalk_1.default.yellow(`${id}:`));
                for (const [name, resolver] of Object.entries(outputs)) {
                    const output = await resolver();
                    if (output !== undefined) {
                        console.log(`  ${name}: ${output}`);
                    }
                }
            }
        }
    }
    registerCommands() {
        const constructsConfiguration = (0, lodash_1.get)(this.serverless.configurationInput, "constructs", {});
        // For each construct
        for (const [id, constructConfig] of Object.entries(constructsConfiguration)) {
            if (constructConfig.type === undefined) {
                throw new error_1.default(`The construct '${id}' has no 'type' defined.\n` +
                    "Find all construct types available here: https://github.com/getlift/lift#constructs", "LIFT_MISSING_CONSTRUCT_TYPE");
            }
            const constructClass = this.getConstructClass(constructConfig.type);
            if (constructClass === undefined) {
                throw new error_1.default(`The construct '${id}' has an unknown type '${constructConfig.type}'\n` +
                    "Find all construct types available here: https://github.com/getlift/lift#constructs", "LIFT_UNKNOWN_CONSTRUCT_TYPE");
            }
            if (constructClass.commands === undefined) {
                continue;
            }
            // For each command of the construct
            for (const [command, commandDefinition] of Object.entries(constructClass.commands)) {
                this.commands[`${id}:${command}`] = {
                    lifecycleEvents: [command],
                    usage: commandDefinition.usage,
                    options: commandDefinition.options,
                };
                // Register the command handler
                this.hooks[`${id}:${command}:${command}`] = () => {
                    // We resolve the construct instance on the fly
                    const construct = this.getConstructs()[id];
                    return commandDefinition.handler.call(construct, this.cliOptions);
                };
            }
        }
    }
    async postDeploy() {
        const constructs = this.getConstructs();
        for (const [, construct] of Object.entries(constructs)) {
            if (construct.postDeploy !== undefined) {
                await construct.postDeploy();
            }
        }
    }
    async preRemove() {
        const constructs = this.getConstructs();
        for (const [, construct] of Object.entries(constructs)) {
            if (construct.preRemove !== undefined) {
                await construct.preRemove();
            }
        }
    }
    resolveLazyVariables() {
        // Use the CDK token resolver to resolve all lazy variables in the template
        const tokenResolver = new core_1.DefaultTokenResolver(new core_1.StringConcat());
        const resolveTokens = (input) => {
            if (input === undefined) {
                return input;
            }
            return core_1.Tokenization.resolve(input, {
                resolver: tokenResolver,
                scope: this.providers[DEFAULT_PROVIDER].stack,
            });
        };
        this.serverless.service.provider = resolveTokens(this.serverless.service.provider);
        this.serverless.service.package = resolveTokens(this.serverless.service.package);
        this.serverless.service.custom = resolveTokens(this.serverless.service.custom);
        this.serverless.service.resources = resolveTokens(this.serverless.service.resources);
        this.serverless.service.functions = resolveTokens(this.serverless.service.functions);
        this.serverless.service.layers = resolveTokens(this.serverless.service.layers);
        this.serverless.service.outputs = resolveTokens(this.serverless.service.outputs);
        // Also resolve tokens in `configurationInput` because they also appear in there
        this.serverless.configurationInput = resolveTokens(this.serverless.configurationInput);
    }
    // This is only required for AwsProvider in order to bundle resources together with existing SLS framework resources
    appendCloudformationResources() {
        this.providers[DEFAULT_PROVIDER].appendCloudformationResources();
    }
    appendPermissions() {
        var _a, _b, _c;
        // Automatic permissions can be disabled via a `lift.automaticPermissions` flag in serverless.yml
        const liftConfiguration = (0, lodash_1.get)(this.serverless.configurationInput, "lift", {});
        if (liftConfiguration.automaticPermissions === false) {
            return;
        }
        const constructs = this.getConstructs();
        const statements = (0, lodash_1.flatten)(Object.entries(constructs).map(([, construct]) => {
            return (construct.permissions ? construct.permissions() : []);
        }));
        if (statements.length === 0) {
            return;
        }
        const role = (_a = this.serverless.service.provider.iam) === null || _a === void 0 ? void 0 : _a.role;
        if (typeof role === "object" && "statements" in role) {
            (_b = role.statements) === null || _b === void 0 ? void 0 : _b.push(...statements);
            return;
        }
        this.serverless.service.provider.iamRoleStatements = (_c = this.serverless.service.provider.iamRoleStatements) !== null && _c !== void 0 ? _c : [];
        this.serverless.service.provider.iamRoleStatements.push(...statements);
    }
    async eject() {
        (0, logger_1.log)("Ejecting from Lift to CloudFormation");
        await this.serverless.pluginManager.spawn("package");
        const legacyProvider = this.serverless.getProvider("aws");
        const compiledTemplateFileName = legacyProvider.naming.getCompiledTemplateFileName();
        const compiledTemplateFilePath = path.join(this.serverless.serviceDir, ".serverless", compiledTemplateFileName);
        const cfTemplate = (0, fs_1.readFileSync)(compiledTemplateFilePath);
        const formattedYaml = (0, js_yaml_1.dump)(JSON.parse(cfTemplate.toString()));
        console.log(formattedYaml);
        (0, logger_1.log)("You can also find that CloudFormation template in the following file:");
        (0, logger_1.log)(compiledTemplateFilePath);
    }
    getAllConstructClasses() {
        const result = (0, lodash_1.flatten)(LiftPlugin.getAllProviderClasses().map((providerClass) => providerClass.getAllConstructClasses()));
        return result;
    }
    getConstructClass(constructType) {
        for (const providerClass of LiftPlugin.getAllProviderClasses()) {
            const constructClass = providerClass.getConstructClass(constructType);
            if (constructClass !== undefined) {
                return constructClass;
            }
        }
        return undefined;
    }
}
LiftPlugin.providerClasses = {};
LiftPlugin.registerProviders(providers_1.AwsProvider, providers_1.StripeProvider);
module.exports = LiftPlugin;
//# sourceMappingURL=plugin.js.map