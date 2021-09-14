"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsConstruct = void 0;
const core_1 = require("@aws-cdk/core");
class AwsConstruct extends core_1.Construct {
    static create(provider, id, configuration) {
        /**
         * We are passing a `configuration` of type `Record<string, unknown>` to a parameter
         * of stricter type. This is theoretically invalid.
         *
         * In practice however, `configuration` has been validated with the exact JSON schema
         * of the construct. And that construct has generated the type for `configuration` based
         * on that schema.
         * As such, we _know_ that `configuration` has the correct type, it is just not validated
         * by TypeScript's compiler.
         */
        return new this(provider.stack, id, configuration, provider);
    }
}
exports.AwsConstruct = AwsConstruct;
//# sourceMappingURL=AwsConstruct.js.map