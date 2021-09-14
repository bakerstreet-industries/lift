import { Construct as CdkConstruct } from "@aws-cdk/core";
import type { AwsProvider } from "@lift/providers";
import type { ConstructInterface } from "@lift/constructs";
export declare abstract class AwsConstruct extends CdkConstruct implements ConstructInterface {
    static create<C extends AwsConstruct = AwsConstruct>(this: {
        new (scope: CdkConstruct, id: string, configuration: Record<string, unknown>, provider: AwsProvider): C;
    }, provider: AwsProvider, id: string, configuration: Record<string, unknown>): C;
    abstract outputs?(): Record<string, () => Promise<string | undefined>>;
}
