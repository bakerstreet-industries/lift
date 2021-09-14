"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerSideWebsite = void 0;
const tslib_1 = require("tslib");
const aws_s3_1 = require("@aws-cdk/aws-s3");
const aws_cloudfront_1 = require("@aws-cdk/aws-cloudfront");
const core_1 = require("@aws-cdk/core");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
const aws_cloudfront_origins_1 = require("@aws-cdk/aws-cloudfront-origins");
const acm = (0, tslib_1.__importStar)(require("@aws-cdk/aws-certificatemanager"));
const path = (0, tslib_1.__importStar)(require("path"));
const fs = (0, tslib_1.__importStar)(require("fs"));
const lodash_1 = require("lodash");
const cloudfront = (0, tslib_1.__importStar)(require("@aws-cdk/aws-cloudfront"));
const abstracts_1 = require("@lift/constructs/abstracts");
const logger_1 = require("../../utils/logger");
const s3_sync_1 = require("../../utils/s3-sync");
const aws_1 = require("../../classes/aws");
const error_1 = (0, tslib_1.__importDefault)(require("../../utils/error"));
const SCHEMA = {
    type: "object",
    properties: {
        type: { const: "server-side-website" },
        apiGateway: { enum: ["http", "rest"] },
        assets: {
            type: "object",
            additionalProperties: { type: "string" },
            propertyNames: {
                pattern: "^/.*$",
            },
            minProperties: 1,
        },
        errorPage: { type: "string" },
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
        forwardedHeaders: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
};
class ServerSideWebsite extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        super(scope, id);
        this.id = id;
        this.configuration = configuration;
        this.provider = provider;
        if (configuration.domain !== undefined && configuration.certificate === undefined) {
            throw new Error(`Invalid configuration in 'constructs.${id}.certificate': if a domain is configured, then a certificate ARN must be configured as well.`);
        }
        if (configuration.errorPage !== undefined && !configuration.errorPage.endsWith(".html")) {
            throw new Error(`Invalid configuration in 'constructs.${id}.errorPage': the custom error page must be a static HTML file. '${configuration.errorPage}' does not end with '.html'.`);
        }
        const bucket = new aws_s3_1.Bucket(this, "Assets", {
            // Assets are compiled artifacts, we can clear them on serverless remove
            removalPolicy: core_1.RemovalPolicy.DESTROY,
        });
        const cloudFrontOAI = new aws_cloudfront_1.OriginAccessIdentity(this, "OriginAccessIdentity", {
            comment: `Identity that represents CloudFront for the ${id} website.`,
        });
        bucket.grantRead(cloudFrontOAI);
        /**
         * We create custom "Origin Policy" and "Cache Policy" for the backend.
         * "All URL query strings, HTTP headers, and cookies that you include in the cache key (using a cache policy) are automatically included in origin requests. Use the origin request policy to specify the information that you want to include in origin requests, but not include in the cache key."
         * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-origin-requests.html
         */
        const backendOriginPolicy = new aws_cloudfront_1.OriginRequestPolicy(this, "BackendOriginPolicy", {
            originRequestPolicyName: `${this.provider.stackName}-${id}`,
            comment: `Origin request policy for the ${id} website.`,
            cookieBehavior: aws_cloudfront_1.OriginRequestCookieBehavior.all(),
            queryStringBehavior: aws_cloudfront_1.OriginRequestQueryStringBehavior.all(),
            headerBehavior: this.headersToForward(),
        });
        const backendCachePolicy = new aws_cloudfront_1.CachePolicy(this, "BackendCachePolicy", {
            cachePolicyName: `${this.provider.stackName}-${id}`,
            comment: `Cache policy for the ${id} website.`,
            // For the backend we disable all caching by default
            defaultTtl: core_1.Duration.seconds(0),
            // Authorization is an exception and must be whitelisted in the Cache Policy
            // This is the reason why we don't use the managed `CachePolicy.CACHING_DISABLED`
            headerBehavior: aws_cloudfront_1.CacheHeaderBehavior.allowList("Authorization"),
        });
        const s3Origin = new aws_cloudfront_origins_1.S3Origin(bucket, {
            originAccessIdentity: cloudFrontOAI,
        });
        const apiId = configuration.apiGateway === "rest"
            ? this.provider.naming.getRestApiLogicalId()
            : this.provider.naming.getHttpApiLogicalId();
        const apiGatewayDomain = core_1.Fn.join(".", [core_1.Fn.ref(apiId), `execute-api.${this.provider.region}.amazonaws.com`]);
        // Cast the domains to an array
        const domains = configuration.domain !== undefined ? (0, lodash_1.flatten)([configuration.domain]) : undefined;
        const certificate = configuration.certificate !== undefined
            ? acm.Certificate.fromCertificateArn(this, "Certificate", configuration.certificate)
            : undefined;
        this.distribution = new aws_cloudfront_1.Distribution(this, "CDN", {
            comment: `${provider.stackName} ${id} website CDN`,
            defaultBehavior: {
                // Origins are where CloudFront fetches content
                origin: new aws_cloudfront_origins_1.HttpOrigin(apiGatewayDomain, {
                    // API Gateway only supports HTTPS
                    protocolPolicy: aws_cloudfront_1.OriginProtocolPolicy.HTTPS_ONLY,
                }),
                // For a backend app we all all methods
                allowedMethods: aws_cloudfront_1.AllowedMethods.ALLOW_ALL,
                cachePolicy: backendCachePolicy,
                viewerProtocolPolicy: aws_cloudfront_1.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                // Forward all values (query strings, headers, and cookies) to the backend app
                // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html#managed-origin-request-policies-list
                originRequestPolicy: backendOriginPolicy,
                functionAssociations: [
                    {
                        function: this.createRequestFunction(),
                        eventType: aws_cloudfront_1.FunctionEventType.VIEWER_REQUEST,
                    },
                ],
            },
            // All the assets paths are created in there
            additionalBehaviors: this.createCacheBehaviors(s3Origin),
            errorResponses: this.createErrorResponses(),
            // Enable http2 transfer for better performances
            httpVersion: aws_cloudfront_1.HttpVersion.HTTP2,
            certificate: certificate,
            domainNames: domains,
        });
        // CloudFormation outputs
        this.bucketNameOutput = new core_1.CfnOutput(this, "AssetsBucketName", {
            description: "Name of the bucket that stores the website assets.",
            value: bucket.bucketName,
        });
        let websiteDomain = this.getMainCustomDomain();
        if (websiteDomain === undefined) {
            // Fallback on the CloudFront domain
            websiteDomain = this.distribution.distributionDomainName;
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
    outputs() {
        return {
            url: () => this.getUrl(),
            cname: () => this.getCName(),
        };
    }
    variables() {
        var _a;
        const domain = (_a = this.getMainCustomDomain()) !== null && _a !== void 0 ? _a : this.distribution.distributionDomainName;
        return {
            url: core_1.Fn.join("", ["https://", domain]),
            cname: this.distribution.distributionDomainName,
        };
    }
    async postDeploy() {
        await this.uploadAssets();
    }
    async uploadAssets() {
        (0, logger_1.log)(`Deploying the assets for the '${this.id}' website`);
        const bucketName = await this.getBucketName();
        if (bucketName === undefined) {
            throw new Error(`Could not find the bucket in which to deploy the '${this.id}' website: did you forget to run 'serverless deploy' first?`);
        }
        let invalidate = false;
        for (const [pattern, filePath] of Object.entries(this.getAssetPatterns())) {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Error in 'constructs.${this.id}': the file or directory '${filePath}' does not exist`);
            }
            let s3PathPrefix = path.dirname(pattern);
            if (s3PathPrefix.startsWith("/")) {
                s3PathPrefix = s3PathPrefix.slice(1);
            }
            if (fs.lstatSync(filePath).isDirectory()) {
                // Directory
                (0, logger_1.log)(`Uploading '${filePath}' to 's3://${bucketName}/${s3PathPrefix}'`);
                const { hasChanges } = await (0, s3_sync_1.s3Sync)({
                    aws: this.provider,
                    localPath: filePath,
                    targetPathPrefix: s3PathPrefix,
                    bucketName,
                });
                invalidate = invalidate || hasChanges;
            }
            else {
                // File
                const targetKey = path.join(s3PathPrefix, path.basename(filePath));
                (0, logger_1.log)(`Uploading '${filePath}' to 's3://${bucketName}/${targetKey}'`);
                await (0, s3_sync_1.s3Put)(this.provider, bucketName, targetKey, fs.readFileSync(filePath));
                invalidate = true;
            }
        }
        if (invalidate) {
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
        (0, logger_1.log)(`Emptying S3 bucket '${bucketName}' for the '${this.id}' website, else CloudFormation will fail (it cannot delete a non-empty bucket)`);
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
    getMainCustomDomain() {
        if (this.configuration.domain === undefined) {
            return undefined;
        }
        // In case of multiple domains, we take the first one
        return typeof this.configuration.domain === "string" ? this.configuration.domain : this.configuration.domain[0];
    }
    headersToForward() {
        var _a;
        let additionalHeadersToForward = (_a = this.configuration.forwardedHeaders) !== null && _a !== void 0 ? _a : [];
        if (additionalHeadersToForward.includes("Host")) {
            throw new error_1.default(`Invalid value in 'constructs.${this.id}.forwardedHeaders': the 'Host' header cannot be forwarded (this is an API Gateway limitation). Use the 'X-Forwarded-Host' header in your code instead (it contains the value of the original 'Host' header).`, "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
        }
        // `Authorization` cannot be forwarded via this setting (we automatically forward it anyway so we remove it from the list)
        additionalHeadersToForward = additionalHeadersToForward.filter((header) => header !== "Authorization");
        if (additionalHeadersToForward.length > 0) {
            if (additionalHeadersToForward.length > 10) {
                throw new error_1.default(`Invalid value in 'constructs.${this.id}.forwardedHeaders': ${additionalHeadersToForward.length} headers are configured but only 10 headers can be forwarded (this is an CloudFront limitation).`, "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
            }
            // Custom list
            return aws_cloudfront_1.OriginRequestHeaderBehavior.allowList(...additionalHeadersToForward);
        }
        /**
         * We forward everything except:
         * - `Host` because it messes up API Gateway (that uses the Host to identify which API Gateway to invoke)
         * - `Authorization` because it must be configured on the cache policy
         *   (see https://aws.amazon.com/premiumsupport/knowledge-center/cloudfront-authorization-header/?nc1=h_ls)
         */
        return aws_cloudfront_1.OriginRequestHeaderBehavior.allowList("Accept", "Accept-Language", "Content-Type", "Origin", "Referer", "User-Agent", "X-Requested-With", 
        // This header is set by our CloudFront Function
        "X-Forwarded-Host");
    }
    createCacheBehaviors(s3Origin) {
        const behaviors = {};
        for (const pattern of Object.keys(this.getAssetPatterns())) {
            behaviors[pattern] = {
                // Origins are where CloudFront fetches content
                origin: s3Origin,
                allowedMethods: aws_cloudfront_1.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                // Use the "Managed-CachingOptimized" policy
                // See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html#managed-cache-policies-list
                cachePolicy: aws_cloudfront_1.CachePolicy.CACHING_OPTIMIZED,
                viewerProtocolPolicy: aws_cloudfront_1.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            };
        }
        return behaviors;
    }
    createRequestFunction() {
        /**
         * CloudFront function that forwards the real `Host` header into `X-Forwarded-Host`
         *
         * CloudFront does not forward the original `Host` header. We use this
         * to forward the website domain name to the backend app via the `X-Forwarded-Host` header.
         * Learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-Host
         */
        const code = `function handler(event) {
    var request = event.request;
    request.headers["x-forwarded-host"] = request.headers["host"];
    return request;
}`;
        return new cloudfront.Function(this, "RequestFunction", {
            functionName: `${this.provider.stackName}-${this.provider.region}-${this.id}-request`,
            code: cloudfront.FunctionCode.fromInline(code),
        });
    }
    createErrorResponses() {
        let responsePagePath = undefined;
        if (this.configuration.errorPage !== undefined) {
            responsePagePath = `/${this.getErrorPageFileName()}`;
        }
        return [
            {
                httpStatus: 500,
                // Disable caching of error responses
                ttl: core_1.Duration.seconds(0),
                responsePagePath,
            },
            {
                httpStatus: 504,
                // Disable caching of error responses
                ttl: core_1.Duration.seconds(0),
                responsePagePath,
            },
        ];
    }
    getAssetPatterns() {
        var _a;
        const assetPatterns = (_a = this.configuration.assets) !== null && _a !== void 0 ? _a : {};
        // If a custom error page is provided, we upload it to S3
        if (this.configuration.errorPage !== undefined) {
            assetPatterns[`/${this.getErrorPageFileName()}`] = this.configuration.errorPage;
        }
        return assetPatterns;
    }
    getErrorPageFileName() {
        return this.configuration.errorPage !== undefined ? path.basename(this.configuration.errorPage) : "";
    }
}
exports.ServerSideWebsite = ServerSideWebsite;
ServerSideWebsite.type = "server-side-website";
ServerSideWebsite.schema = SCHEMA;
ServerSideWebsite.commands = {
    "assets:upload": {
        usage: "Upload assets directly to S3 without going through a CloudFormation deployment.",
        handler: ServerSideWebsite.prototype.uploadAssets,
    },
};
//# sourceMappingURL=ServerSideWebsite.js.map