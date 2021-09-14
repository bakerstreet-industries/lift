"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Storage = void 0;
const aws_s3_1 = require("@aws-cdk/aws-s3");
const core_1 = require("@aws-cdk/core");
const abstracts_1 = require("@lift/constructs/abstracts");
const CloudFormation_1 = require("../../CloudFormation");
const STORAGE_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "storage" },
        archive: { type: "number", minimum: 30 },
        encryption: {
            anyOf: [{ const: "s3" }, { const: "kms" }],
        },
    },
    additionalProperties: false,
};
const STORAGE_DEFAULTS = {
    type: "storage",
    archive: 45,
    encryption: "s3",
};
class Storage extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        super(scope, id);
        this.provider = provider;
        const resolvedConfiguration = Object.assign({}, STORAGE_DEFAULTS, configuration);
        const encryptionOptions = {
            s3: aws_s3_1.BucketEncryption.S3_MANAGED,
            kms: aws_s3_1.BucketEncryption.KMS_MANAGED,
        };
        this.bucket = new aws_s3_1.Bucket(this, "Bucket", {
            encryption: encryptionOptions[resolvedConfiguration.encryption],
            versioned: true,
            blockPublicAccess: aws_s3_1.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            lifecycleRules: [
                {
                    transitions: [
                        {
                            storageClass: aws_s3_1.StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: core_1.Duration.days(0),
                        },
                    ],
                },
                {
                    noncurrentVersionExpiration: core_1.Duration.days(30),
                },
            ],
        });
        this.bucketNameOutput = new core_1.CfnOutput(this, "BucketName", {
            value: this.bucket.bucketName,
        });
    }
    variables() {
        return {
            bucketArn: this.bucket.bucketArn,
            bucketName: this.bucket.bucketName,
        };
    }
    permissions() {
        return [
            new CloudFormation_1.PolicyStatement(["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"], [this.bucket.bucketArn, core_1.Stack.of(this).resolve(core_1.Fn.join("/", [this.bucket.bucketArn, "*"]))]),
        ];
    }
    outputs() {
        return {
            bucketName: () => this.getBucketName(),
        };
    }
    async getBucketName() {
        return this.provider.getStackOutput(this.bucketNameOutput);
    }
}
exports.Storage = Storage;
Storage.type = "storage";
Storage.schema = STORAGE_DEFINITION;
//# sourceMappingURL=Storage.js.map