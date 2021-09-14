"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsProvider = void 0;
const tslib_1 = require("tslib");
const core_1 = require("@aws-cdk/core");
const aws_1 = require("../constructs/aws");
const lodash_1 = require("lodash");
const aws_2 = require("../classes/aws");
const CloudFormation_1 = require("../CloudFormation");
const error_1 = (0, tslib_1.__importDefault)(require("../utils/error"));
const AWS_DEFINITION = {
    type: "object",
    properties: {},
    additionalProperties: false,
};
class AwsProvider {
    constructor(serverless) {
        this.serverless = serverless;
        this.stackName = serverless.getProvider("aws").naming.getStackName();
        this.app = new core_1.App();
        this.stack = new core_1.Stack(this.app);
        this.legacyProvider = serverless.getProvider("aws");
        this.naming = this.legacyProvider.naming;
        this.region = serverless.getProvider("aws").getRegion();
        this.maybeAddStackTags(this.serverless, this.stack);
        serverless.stack = this.stack;
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
    static create(serverless) {
        return new this(serverless);
    }
    createConstruct(type, id) {
        const Construct = AwsProvider.getConstructClass(type);
        if (Construct === undefined) {
            throw new error_1.default(`The construct '${id}' has an unknown type '${type}'\n` +
                "Find all construct types available here: https://github.com/getlift/lift#constructs", "LIFT_UNKNOWN_CONSTRUCT_TYPE");
        }
        const configuration = (0, lodash_1.get)(this.serverless.configurationInput.constructs, id, {});
        return Construct.create(this, id, configuration);
    }
    addFunction(functionName, functionConfig) {
        if (!this.serverless.configurationInput.functions) {
            // If serverless.yml does not contain any functions, bootstrapping a new empty functions config
            this.serverless.configurationInput.functions = {};
        }
        Object.assign(this.serverless.service.functions, {
            [functionName]: functionConfig,
        });
        /**
         * We must manually call `setFunctionNames()`: this is a function that normalizes functions.
         * This function is called by the Framework, but we have to call it again because we add new
         * functions after this function has already run. So our new function (that we add here)
         * will not have been normalized.
         */
        this.serverless.service.setFunctionNames(this.serverless.processedInput.options);
    }
    /**
     * @internal
     */
    setVpcConfig(securityGroups, subnets) {
        if (this.getVpcConfig() !== null) {
            throw new error_1.default("Can't register more than one VPC.\n" +
                'Either you have several "vpc" constructs \n' +
                'or you already defined "provider.vpc" in serverless.yml', "LIFT_ONLY_ONE_VPC");
        }
        this.serverless.service.provider.vpc = {
            securityGroupIds: securityGroups,
            subnetIds: subnets,
        };
    }
    /**
     * This function can be used by other constructs to reference
     * global subnets or security groups in their resources
     *
     * @internal
     */
    getVpcConfig() {
        var _a;
        return (_a = this.serverless.service.provider.vpc) !== null && _a !== void 0 ? _a : null;
    }
    /**
     * Resolves the value of a CloudFormation stack output.
     */
    async getStackOutput(output) {
        return (0, CloudFormation_1.getStackOutput)(this, output);
    }
    /**
     * Send a request to the AWS API.
     */
    request(service, method, params) {
        return (0, aws_2.awsRequest)(params, service, method, this.legacyProvider);
    }
    appendCloudformationResources() {
        (0, lodash_1.merge)(this.serverless.service, {
            resources: this.app.synth().getStackByName(this.stack.stackName).template,
        });
    }
    maybeAddStackTags(serverless, stack) {
        const tags = serverless.configurationInput.provider.stackTags;
        console.log('stackTags', tags);
        if (tags) {
            Object.keys(tags).forEach((key) => {
                console.log('adding tag', key, '=', tags[key]);
                core_1.Tags.of(stack).add(key, tags[key]);
            });
        }
    }
}
exports.AwsProvider = AwsProvider;
AwsProvider.type = "aws";
AwsProvider.schema = AWS_DEFINITION;
AwsProvider.constructClasses = {};
/**
 * This is representative of a possible public API to register constructs. How it would work:
 * - 3rd party developers create a custom construct
 * - they also create a plugin that calls:
 *       AwsProvider.registerConstructs(Foo, Bar);
 *  If they use TypeScript, `registerConstructs()` will validate that the construct class
 *  implements both static fields (type, schema, create(), …) and non-static fields (outputs(), references(), …).
 */
AwsProvider.registerConstructs(aws_1.Storage, aws_1.Queue, aws_1.Webhook, aws_1.StaticWebsite, aws_1.Vpc, aws_1.DatabaseDynamoDBSingleTable, aws_1.ServerSideWebsite);
//# sourceMappingURL=AwsProvider.js.map