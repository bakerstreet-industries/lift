import type { Construct as CdkConstruct } from "@aws-cdk/core";
import type { FromSchema } from "json-schema-to-ts";
import type { AwsProvider } from "@lift/providers";
import { AwsConstruct } from "@lift/constructs/abstracts";
import type { ConstructCommands } from "@lift/constructs";
declare const STATIC_WEBSITE_DEFINITION: {
    readonly type: "object";
    readonly properties: {
        readonly type: {
            readonly const: "static-website";
        };
        readonly path: {
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
        readonly security: {
            readonly type: "object";
            readonly properties: {
                readonly allowIframe: {
                    readonly type: "boolean";
                };
            };
            readonly additionalProperties: false;
        };
        readonly errorPage: {
            readonly type: "string";
        };
    };
    readonly additionalProperties: false;
    readonly required: readonly ["path"];
};
declare type Configuration = FromSchema<typeof STATIC_WEBSITE_DEFINITION>;
export declare class StaticWebsite extends AwsConstruct {
    private readonly id;
    private readonly configuration;
    private readonly provider;
    static type: string;
    static schema: {
        readonly type: "object";
        readonly properties: {
            readonly type: {
                readonly const: "static-website";
            };
            readonly path: {
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
            readonly security: {
                readonly type: "object";
                readonly properties: {
                    readonly allowIframe: {
                        readonly type: "boolean";
                    };
                };
                readonly additionalProperties: false;
            };
            readonly errorPage: {
                readonly type: "string";
            };
        };
        readonly additionalProperties: false;
        readonly required: readonly ["path"];
    };
    static commands: ConstructCommands;
    private readonly distribution;
    private readonly bucketNameOutput;
    private readonly domainOutput;
    private readonly cnameOutput;
    private readonly distributionIdOutput;
    constructor(scope: CdkConstruct, id: string, configuration: Configuration, provider: AwsProvider);
    variables(): Record<string, unknown>;
    outputs(): Record<string, () => Promise<string | undefined>>;
    postDeploy(): Promise<void>;
    uploadWebsite(): Promise<void>;
    private clearCDNCache;
    preRemove(): Promise<void>;
    getUrl(): Promise<string | undefined>;
    getBucketName(): Promise<string | undefined>;
    getDomain(): Promise<string | undefined>;
    getCName(): Promise<string | undefined>;
    getDistributionId(): Promise<string | undefined>;
    private errorResponse;
    private createResponseFunction;
}
export {};
