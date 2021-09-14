"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyStatement = exports.getStackOutput = void 0;
const core_1 = require("@aws-cdk/core");
const logger_1 = require("./utils/logger");
async function getStackOutput(aws, output) {
    const outputId = core_1.Stack.of(output.stack).resolve(output.logicalId);
    const stackName = aws.stackName;
    (0, logger_1.debug)(`Fetching output "${outputId}" in stack "${stackName}"`);
    let data;
    try {
        data = await aws.request("CloudFormation", "describeStacks", {
            StackName: stackName,
        });
    }
    catch (e) {
        if (e instanceof Error && e.message === `Stack with id ${stackName} does not exist`) {
            (0, logger_1.debug)(e.message);
            return undefined;
        }
        throw e;
    }
    if (!data.Stacks || !data.Stacks[0].Outputs) {
        return undefined;
    }
    for (const item of data.Stacks[0].Outputs) {
        if (item.OutputKey === outputId) {
            return item.OutputValue;
        }
    }
    return undefined;
}
exports.getStackOutput = getStackOutput;
class PolicyStatement {
    constructor(Action, Resource) {
        this.Effect = "Allow";
        this.Action = Action;
        this.Resource = Resource;
    }
}
exports.PolicyStatement = PolicyStatement;
//# sourceMappingURL=CloudFormation.js.map