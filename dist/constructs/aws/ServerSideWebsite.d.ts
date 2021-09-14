import type { Construct } from "@aws-cdk/core";
import type { FromSchema } from "json-schema-to-ts";
import { AwsConstruct } from "@lift/constructs/abstracts";
import type { ConstructCommands } from "@lift/constructs";
import type { AwsProvider } from "@lift/providers";
declare const SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly const: "server-side-website";
        };
        readonly apiGateway: {
            readonly enum: readonly ["http", "rest"];
        };
        readonly assets: {
            readonly type: "object";
            readonly additionalProperties: {
                readonly type: "string";
            };
            readonly propertyNames: {
                readonly pattern: "^/.*$";
            };
            readonly minProperties: 1;
        };
        readonly errorPage: {
            readonly type: "string";
        };
        readonly domain: {
            readonly anyOf: readonly [{
                readonly type: "string";
            }, {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            }];
        };
        readonly certificate: {
            readonly type: "string";
        };
        readonly forwardedHeaders: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
    };
    readonly additionalProperties: false;
};
declare type Configuration = FromSchema<typeof SCHEMA>;
export declare class ServerSideWebsite extends AwsConstruct {
    private readonly id;
    readonly configuration: Configuration;
    private readonly provider;
    static type: string;
    static schema: {
        readonly type: "object";
        readonly properties: {
            readonly type: {
                readonly const: "server-side-website";
            };
            readonly apiGateway: {
                readonly enum: readonly ["http", "rest"];
            };
            readonly assets: {
                readonly type: "object";
                readonly additionalProperties: {
                    readonly type: "string";
                };
                readonly propertyNames: {
                    readonly pattern: "^/.*$";
                };
                readonly minProperties: 1;
            };
            readonly errorPage: {
                readonly type: "string";
            };
            readonly domain: {
                readonly anyOf: readonly [{
                    readonly type: "string";
                }, {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "string";
                    };
                }];
            };
            readonly certificate: {
                readonly type: "string";
            };
            readonly forwardedHeaders: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
            };
        };
        readonly additionalProperties: false;
    };
    static commands: ConstructCommands;
    private readonly distribution;
    private readonly bucketNameOutput;
    private readonly domainOutput;
    private readonly cnameOutput;
    private readonly distributionIdOutput;
    constructor(scope: Construct, id: string, configuration: Configuration, provider: AwsProvider);
    outputs(): Record<string, () => Promise<string | undefined>>;
    variables(): Record<string, unknown>;
    postDeploy(): Promise<void>;
    uploadAssets(): Promise<void>;
    private clearCDNCache;
    preRemove(): Promise<void>;
    getUrl(): Promise<string | undefined>;
    getBucketName(): Promise<string | undefined>;
    getDomain(): Promise<string | undefined>;
    getCName(): Promise<string | undefined>;
    getDistributionId(): Promise<string | undefined>;
    getMainCustomDomain(): string | undefined;
    private headersToForward;
    private createCacheBehaviors;
    private createRequestFunction;
    private createErrorResponses;
    private getAssetPatterns;
    private getErrorPageFileName;
}
export {};
