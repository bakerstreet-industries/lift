"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Webhook = void 0;
const tslib_1 = require("tslib");
const core_1 = require("@aws-cdk/core");
const aws_apigatewayv2_1 = require("@aws-cdk/aws-apigatewayv2");
const aws_lambda_1 = require("@aws-cdk/aws-lambda");
const aws_events_1 = require("@aws-cdk/aws-events");
const aws_iam_1 = require("@aws-cdk/aws-iam");
const abstracts_1 = require("../abstracts");
const error_1 = (0, tslib_1.__importDefault)(require("../../utils/error"));
const WEBHOOK_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "webhook" },
        authorizer: {
            type: "object",
            properties: {
                handler: { type: "string" },
            },
            required: ["handler"],
            additionalProperties: true,
        },
        insecure: { type: "boolean" },
        path: { type: "string" },
        eventType: { type: "string" },
    },
    required: ["path"],
    additionalProperties: false,
};
const WEBHOOK_DEFAULTS = {
    insecure: false,
};
class Webhook extends abstracts_1.AwsConstruct {
    constructor(scope, id, configuration, provider) {
        var _a;
        super(scope, id);
        this.id = id;
        this.configuration = configuration;
        this.provider = provider;
        const api = new aws_apigatewayv2_1.HttpApi(this, "HttpApi");
        this.apiEndpointOutput = new core_1.CfnOutput(this, "HttpApiEndpoint", {
            value: api.apiEndpoint,
        });
        const bus = new aws_events_1.EventBus(this, "Bus");
        this.bus = bus;
        const apiGatewayRole = new aws_iam_1.Role(this, "ApiGatewayRole", {
            assumedBy: new aws_iam_1.ServicePrincipal("apigateway.amazonaws.com"),
            inlinePolicies: {
                EventBridge: new aws_iam_1.PolicyDocument({
                    statements: [
                        new aws_iam_1.PolicyStatement({
                            actions: ["events:PutEvents"],
                            resources: [bus.eventBusArn],
                        }),
                    ],
                }),
            },
        });
        const resolvedConfiguration = Object.assign({}, WEBHOOK_DEFAULTS, configuration);
        if (resolvedConfiguration.insecure && resolvedConfiguration.authorizer !== undefined) {
            throw new error_1.default(`Webhook ${id} is specified as insecure, however an authorizer is configured for this webhook. ` +
                "Either declare this webhook as secure by removing `insecure: true` property (recommended), " +
                "or specify the webhook as insecure and remove the authorizer property altogether.\n" +
                "See https://github.com/getlift/lift/blob/master/docs/webhook.md#authorizer", "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
        }
        if (!resolvedConfiguration.insecure && resolvedConfiguration.authorizer === undefined) {
            throw new error_1.default(`Webhook ${id} is specified as secure, however no authorizer is configured for this webhook. ` +
                "Please provide an authorizer property for this webhook (recommended), " +
                "or specify the webhook as insecure by adding `insecure: true` property.\n" +
                "See https://github.com/getlift/lift/blob/master/docs/webhook.md#authorizer", "LIFT_INVALID_CONSTRUCT_CONFIGURATION");
        }
        const eventBridgeIntegration = new aws_apigatewayv2_1.CfnIntegration(this, "Integration", {
            apiId: api.apiId,
            connectionType: "INTERNET",
            credentialsArn: apiGatewayRole.roleArn,
            integrationSubtype: "EventBridge-PutEvents",
            integrationType: "AWS_PROXY",
            payloadFormatVersion: "1.0",
            requestParameters: {
                DetailType: (_a = resolvedConfiguration.eventType) !== null && _a !== void 0 ? _a : "Webhook",
                Detail: "$request.body",
                Source: id,
                EventBusName: bus.eventBusName,
            },
        });
        const route = new aws_apigatewayv2_1.CfnRoute(this, "Route", {
            apiId: api.apiId,
            routeKey: `POST ${resolvedConfiguration.path}`,
            target: core_1.Fn.join("/", ["integrations", eventBridgeIntegration.ref]),
            authorizationType: "NONE",
        });
        if (!resolvedConfiguration.insecure) {
            const lambda = aws_lambda_1.Function.fromFunctionArn(this, "LambdaAuthorizer", core_1.Fn.getAtt(provider.naming.getLambdaLogicalId(`${id}Authorizer`), "Arn"));
            lambda.grantInvoke(apiGatewayRole);
            const authorizer = new aws_apigatewayv2_1.CfnAuthorizer(this, "Authorizer", {
                apiId: api.apiId,
                authorizerPayloadFormatVersion: "2.0",
                authorizerType: "REQUEST",
                name: `${id}-authorizer`,
                identitySource: ["$request.header.Authorization"],
                enableSimpleResponses: true,
                authorizerUri: core_1.Fn.join("/", [
                    `arn:aws:apigateway:${this.provider.region}:lambda:path/2015-03-31/functions`,
                    lambda.functionArn,
                    "invocations",
                ]),
                authorizerCredentialsArn: apiGatewayRole.roleArn,
            });
            route.authorizerId = authorizer.ref;
            route.authorizationType = "CUSTOM";
        }
        this.endpointPathOutput = new core_1.CfnOutput(this, "Endpoint", {
            value: route.routeKey,
        });
        this.appendFunctions();
    }
    outputs() {
        return {
            httpMethod: () => this.getHttpMethod(),
            url: () => this.getUrl(),
        };
    }
    variables() {
        return {
            busName: this.bus.eventBusName,
        };
    }
    appendFunctions() {
        const resolvedWebhookConfiguration = Object.assign({}, WEBHOOK_DEFAULTS, this.configuration);
        if (resolvedWebhookConfiguration.insecure) {
            return;
        }
        this.provider.addFunction(`${this.id}Authorizer`, resolvedWebhookConfiguration.authorizer);
    }
    async getEndpointPath() {
        return this.provider.getStackOutput(this.endpointPathOutput);
    }
    async getHttpMethod() {
        const endpointPath = await this.getEndpointPath();
        if (endpointPath === undefined) {
            return undefined;
        }
        const [httpMethod] = endpointPath.split(" ");
        return httpMethod;
    }
    async getUrl() {
        const apiEndpoint = await this.provider.getStackOutput(this.apiEndpointOutput);
        if (apiEndpoint === undefined) {
            return undefined;
        }
        const endpointPath = await this.getEndpointPath();
        if (endpointPath === undefined) {
            return undefined;
        }
        const [, path] = endpointPath.split(" ");
        return apiEndpoint + path;
    }
}
exports.Webhook = Webhook;
Webhook.type = "webhook";
Webhook.schema = WEBHOOK_DEFINITION;
//# sourceMappingURL=Webhook.js.map