"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Vpc = void 0;
const aws_ec2_1 = require("@aws-cdk/aws-ec2");
const VPC_DEFINITION = {
    type: "object",
    properties: {
        type: { const: "vpc" },
    },
    additionalProperties: false,
    required: [],
};
class Vpc extends aws_ec2_1.Vpc {
    constructor(scope, id, configuration, provider) {
        super(scope, id, {
            maxAzs: 2,
        });
        this.provider = provider;
        // Add a security group for the Lambda functions
        this.appSecurityGroup = new aws_ec2_1.SecurityGroup(this, "AppSecurityGroup", {
            vpc: this,
        });
        // Lambda is allowed to reach out to the whole internet
        this.appSecurityGroup.addEgressRule(aws_ec2_1.Peer.anyIpv4(), aws_ec2_1.Port.allTraffic());
        // Auto-register the VPC
        provider.setVpcConfig([this.appSecurityGroup.securityGroupName], this.privateSubnets.map((subnet) => subnet.subnetId));
    }
    static create(provider, id, configuration) {
        return new this(provider.stack, id, configuration, provider);
    }
    outputs() {
        return {};
    }
}
exports.Vpc = Vpc;
Vpc.type = "vpc";
Vpc.schema = VPC_DEFINITION;
//# sourceMappingURL=Vpc.js.map