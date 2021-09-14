import type { FromSchema } from "json-schema-to-ts";
declare const CONSTRUCTS_DEFINITION: {
    readonly type: "object";
    readonly patternProperties: {
        readonly "^[a-zA-Z0-9-_]+$": {
            readonly allOf: readonly [{
                readonly type: "object";
                readonly properties: {
                    readonly type: {
                        readonly type: "string";
                    };
                    readonly provider: {
                        readonly type: "string";
                    };
                };
                readonly required: readonly ["type"];
            }];
        };
    };
    readonly additionalProperties: false;
};
export declare type Lift = {
    constructs: FromSchema<typeof CONSTRUCTS_DEFINITION>;
};
export {};
