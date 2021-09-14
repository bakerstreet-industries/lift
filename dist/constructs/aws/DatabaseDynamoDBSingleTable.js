"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseDynamoDBSingleTable = void 0;
const core_1 = require("@aws-cdk/core");
const aws_dynamodb_1 = require("@aws-cdk/aws-dynamodb");
const abstracts_1 = require("@lift/constructs/abstracts");
const CloudFormation_1 = require("../../CloudFormation");
const DATABASE_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "database/dynamodb-single-table" },
        localSecondaryIndexes: { type: "boolean" },
        gsiCount: { type: "integer", minimum: 1, maximum: 20 },
    },
    additionalProperties: false,
};
const DATABASE_DEFAULTS = {
    type: "database/dynamodb-single-table",
    localSecondaryIndexes: false,
    gsiCount: 0,
};
class DatabaseDynamoDBSingleTable extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        super(scope, id);
        this.provider = provider;
        const resolvedConfiguration = Object.assign({}, DATABASE_DEFAULTS, configuration);
        this.table = new aws_dynamodb_1.Table(this, "Table", {
            partitionKey: { name: "PK", type: aws_dynamodb_1.AttributeType.STRING },
            sortKey: { name: "SK", type: aws_dynamodb_1.AttributeType.STRING },
            billingMode: aws_dynamodb_1.BillingMode.PAY_PER_REQUEST,
            pointInTimeRecovery: true,
            timeToLiveAttribute: "TimeToLive",
            stream: aws_dynamodb_1.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        if (resolvedConfiguration.localSecondaryIndexes) {
            for (let localSecondaryIndex = 1; localSecondaryIndex <= 5; localSecondaryIndex++) {
                this.table.addLocalSecondaryIndex({
                    indexName: `LSI-${localSecondaryIndex}`,
                    sortKey: { name: `LSI-${localSecondaryIndex}-SK`, type: aws_dynamodb_1.AttributeType.STRING },
                });
            }
        }
        if (resolvedConfiguration.gsiCount > 0) {
            for (let globalSecondaryIndex = 1; globalSecondaryIndex <= resolvedConfiguration.gsiCount; globalSecondaryIndex++) {
                this.table.addGlobalSecondaryIndex({
                    indexName: `GSI-${globalSecondaryIndex}`,
                    partitionKey: { name: `GSI-${globalSecondaryIndex}-PK`, type: aws_dynamodb_1.AttributeType.STRING },
                    sortKey: { name: `GSI-${globalSecondaryIndex}-SK`, type: aws_dynamodb_1.AttributeType.STRING },
                });
            }
        }
        this.tableNameOutput = new core_1.CfnOutput(this, "TableName", {
            value: this.table.tableName,
        });
    }
    permissions() {
        return [
            new CloudFormation_1.PolicyStatement([
                "dynamodb:GetItem",
                "dynamodb:BatchGetItem",
                "dynamodb:Query",
                "dynamodb:Scan",
                "dynamodb:PutItem",
                "dynamodb:DeleteItem",
                "dynamodb:BatchWriteItem",
                "dynamodb:UpdateItem",
            ], [this.table.tableArn, core_1.Stack.of(this).resolve(core_1.Fn.join("/", [this.table.tableArn, "index", "*"]))]),
        ];
    }
    outputs() {
        return {
            tableName: () => this.getTableName(),
        };
    }
    variables() {
        return {
            tableName: this.table.tableName,
            tableStreamArn: this.table.tableStreamArn,
        };
    }
    async getTableName() {
        return this.provider.getStackOutput(this.tableNameOutput);
    }
}
exports.DatabaseDynamoDBSingleTable = DatabaseDynamoDBSingleTable;
DatabaseDynamoDBSingleTable.type = "database/dynamodb-single-table";
DatabaseDynamoDBSingleTable.schema = DATABASE_DEFINITION;
//# sourceMappingURL=DatabaseDynamoDBSingleTable.js.map