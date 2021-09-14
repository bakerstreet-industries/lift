"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticWebsite = void 0;
const tslib_1 = require("tslib");
const aws_s3_1 = require("@aws-cdk/aws-s3");
const aws_cloudfront_1 = require("@aws-cdk/aws-cloudfront");
const cloudfront = (0, tslib_1.__importStar)(require("@aws-cdk/aws-cloudfront"));
const core_1 = require("@aws-cdk/core");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
const aws_cloudfront_origins_1 = require("@aws-cdk/aws-cloudfront-origins");
const acm = (0, tslib_1.__importStar)(require("@aws-cdk/aws-certificatemanager"));
const lodash_1 = require("lodash");
const abstracts_1 = require("@lift/constructs/abstracts");
const logger_1 = require("../../utils/logger");
const s3_sync_1 = require("../../utils/s3-sync");
const error_1 = (0, tslib_1.__importDefault)(require("../../utils/error"));
const aws_1 = require("../../classes/aws");
const STATIC_WEBSITE_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "static-website" },
        path: { type: "string" },
        domain: {
            anyOf: [
                { type: "string" },
                {
                    type: "array",
                    items: { type: "string" },
                },
            ],
        },
        certificate: { type: "string" },
        security: {
            type: "object",
            properties: {
                allowIframe: { type: "boolean" },
            },
            additionalProperties: false,
        },
        errorPage: { type: "string" },
    },
    additionalProperties: false,
    required: ["path"],
};
class StaticWebsite extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        super(scope, id);
        this.id = id;
        this.configuration = configuration;
        this.provider = provider;
        if (configuration.domain !== undefined && configuration.certificate === undefined) {
            throw new error_1.default(`Invalid configuration for the static website '${id}': if a domain is configured, then a certificate ARN must be configured in the 'certificate' option.\n` +
                "See https://github.com/getlift/lift/blob/master/docs/static-website.md#custom-domain", "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
        }
        const bucket = new aws_s3_1.Bucket(this, "Bucket", {
            // For a static website, the content is code that should be versioned elsewhere
            removalPolicy: core_1.RemovalPolicy.DESTROY,
        });
        const cloudFrontOAI = new aws_cloudfront_1.OriginAccessIdentity(this, "OriginAccessIdentity", {
            comment: `Identity that represents CloudFront for the ${id} static website.`,
        });
        bucket.grantRead(cloudFrontOAI);
        // Cast the domains to an array
        const domains = configuration.domain !== undefined ? (0, lodash_1.flatten)([configuration.domain]) : undefined;
        const certificate = configuration.certificate !== undefined
            ? acm.Certificate.fromCertificateArn(this, "Certificate", configuration.certificate)
            : undefined;
        this.distribution = new aws_cloudfront_1.Distribution(this, "CDN", {
            comment: `${provider.stackName} ${id} website CDN`,
            // Send all page requests to index.html
            defaultRootObject: "index.html",
            defaultBehavior: {
                // Origins are where CloudFront fetches content
                origin: new aws_cloudfront_origins_1.S3Origin(bucket, {
                    originAccessIdentity: cloudFrontOAI,
                }),
                allowedMethods: aws_cloudfront_1.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                // Use the "Managed-CachingOptimized" policy
                // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html#managed-cache-policies-list
                cachePolicy: aws_cloudfront_1.CachePolicy.CACHING_OPTIMIZED,
                viewerProtocolPolicy: aws_cloudfront_1.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                functionAssociations: [
                    {
                        function: this.createResponseFunction(),
                        eventType: aws_cloudfront_1.FunctionEventType.VIEWER_RESPONSE,
                    },
                ],
            },
            errorResponses: [this.errorResponse()],
            // Enable http2 transfer for better performances
            httpVersion: aws_cloudfront_1.HttpVersion.HTTP2,
            certificate: certificate,
            domainNames: domains,
        });
        // CloudFormation outputs
        this.bucketNameOutput = new core_1.CfnOutput(this, "BucketName", {
            description: "Name of the bucket that stores the static website.",
            value: bucket.bucketName,
        });
        let websiteDomain = this.distribution.distributionDomainName;
        if (configuration.domain !== undefined) {
            // In case of multiple domains, we take the first one
            websiteDomain = typeof configuration.domain === "string" ? configuration.domain : configuration.domain[0];
        }
        this.domainOutput = new core_1.CfnOutput(this, "Domain", {
            description: "Website domain name.",
            value: websiteDomain,
        });
        this.cnameOutput = new core_1.CfnOutput(this, "CloudFrontCName", {
            description: "CloudFront CNAME.",
            value: this.distribution.distributionDomainName,
        });
        this.distributionIdOutput = new core_1.CfnOutput(this, "DistributionId", {
            description: "ID of the CloudFront distribution.",
            value: this.distribution.distributionId,
        });
    }
    variables() {
        return {
            cname: this.distribution.distributionDomainName,
        };
    }
    outputs() {
        return {
            url: () => this.getUrl(),
            cname: () => this.getCName(),
        };
    }
    async postDeploy() {
        await this.uploadWebsite();
    }
    async uploadWebsite() {
        (0, logger_1.log)(`Deploying the static website '${this.id}'`);
        const bucketName = await this.getBucketName();
        if (bucketName === undefined) {
            throw new error_1.default(`Could not find the bucket in which to deploy the '${this.id}' website: did you forget to run 'serverless deploy' first?`, "LIFT_MISSING_STACK_OUTPUT");
        }
        (0, logger_1.log)(`Uploading directory '${this.configuration.path}' to bucket '${bucketName}'`);
        const { hasChanges } = await (0, s3_sync_1.s3Sync)({
            aws: this.provider,
            localPath: this.configuration.path,
            bucketName,
        });
        if (hasChanges) {
            await this.clearCDNCache();
        }
        const domain = await this.getDomain();
        if (domain !== undefined) {
            (0, logger_1.log)(`Deployed ${chalk_1.default.green(`https://${domain}`)}`);
        }
    }
    async clearCDNCache() {
        const distributionId = await this.getDistributionId();
        if (distributionId === undefined) {
            return;
        }
        await (0, aws_1.invalidateCloudFrontCache)(this.provider, distributionId);
    }
    async preRemove() {
        const bucketName = await this.getBucketName();
        if (bucketName === undefined) {
            // No bucket found => nothing to delete!
            return;
        }
        (0, logger_1.log)(`Emptying S3 bucket '${bucketName}' for the '${this.id}' static website, else CloudFormation will fail (it cannot delete a non-empty bucket)`);
        await (0, aws_1.emptyBucket)(this.provider, bucketName);
    }
    async getUrl() {
        const domain = await this.getDomain();
        if (domain === undefined) {
            return undefined;
        }
        return `https://${domain}`;
    }
    async getBucketName() {
        return this.provider.getStackOutput(this.bucketNameOutput);
    }
    async getDomain() {
        return this.provider.getStackOutput(this.domainOutput);
    }
    async getCName() {
        return this.provider.getStackOutput(this.cnameOutput);
    }
    async getDistributionId() {
        return this.provider.getStackOutput(this.distributionIdOutput);
    }
    errorResponse() {
        // Custom error page
        if (this.configuration.errorPage !== undefined) {
            let errorPath = this.configuration.errorPage;
            if (errorPath.startsWith("./") || errorPath.startsWith("../")) {
                throw new error_1.default(`The 'errorPage' option of the '${this.id}' static website cannot start with './' or '../'. ` +
                    `(it cannot be a relative path).`, "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
            }
            if (!errorPath.startsWith("/")) {
                errorPath = `/${errorPath}`;
            }
            return {
                httpStatus: 404,
                ttl: core_1.Duration.seconds(0),
                responseHttpStatus: 404,
                responsePagePath: errorPath,
            };
        }
        /**
         * The default behavior is optimized for SPA: all unknown URLs are served
         * by index.html so that routing can be done client-side.
         */
        return {
            httpStatus: 404,
            ttl: core_1.Duration.seconds(0),
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
        };
    }
    createResponseFunction() {
        var _a;
        const securityHeaders = {
            "x-frame-options": { value: "SAMEORIGIN" },
            "x-content-type-options": { value: "nosniff" },
            "x-xss-protection": { value: "1; mode=block" },
            "strict-transport-security": { value: "max-age=63072000" },
        };
        if (((_a = this.configuration.security) === null || _a === void 0 ? void 0 : _a.allowIframe) === true) {
            delete securityHeaders["x-frame-options"];
        }
        const jsonHeaders = JSON.stringify(securityHeaders, undefined, 4);
        /**
         * CloudFront function that manipulates the HTTP responses to add security headers.
         */
        const code = `function handler(event) {
    var response = event.response;
    response.headers = Object.assign({}, ${jsonHeaders}, response.headers);
    return response;
}`;
        return new cloudfront.Function(this, "ResponseFunction", {
            functionName: `${this.provider.stackName}-${this.provider.region}-${this.id}-response`,
            code: cloudfront.FunctionCode.fromInline(code),
        });
    }
}
exports.StaticWebsite = StaticWebsite;
StaticWebsite.type = "static-website";
StaticWebsite.schema = STATIC_WEBSITE_DEFINITION;
StaticWebsite.commands = {
    upload: {
        usage: "Upload files directly to S3 without going through a CloudFormation deployment.",
        handler: StaticWebsite.prototype.uploadWebsite,
    },
};
//# sourceMappingURL=StaticWebsite.js.map