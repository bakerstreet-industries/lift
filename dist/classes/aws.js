"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateCloudFrontCache = exports.emptyBucket = exports.awsRequest = void 0;
// This is defined as a separate function to allow mocking in tests
async function awsRequest(params, service, method, provider) {
    return await provider.request(service, method, params);
}
exports.awsRequest = awsRequest;
async function emptyBucket(aws, bucketName) {
    const data = await aws.request("S3", "listObjectsV2", {
        Bucket: bucketName,
    });
    if (data.Contents === undefined) {
        return;
    }
    const keys = data.Contents.map((item) => item.Key).filter((key) => key !== undefined);
    await aws.request("S3", "deleteObjects", {
        Bucket: bucketName,
        Delete: {
            Objects: keys.map((key) => ({ Key: key })),
        },
    });
}
exports.emptyBucket = emptyBucket;
async function invalidateCloudFrontCache(aws, distributionId) {
    await aws.request("CloudFront", "createInvalidation", {
        DistributionId: distributionId,
        InvalidationBatch: {
            // This should be a unique ID: we use a timestamp
            CallerReference: Date.now().toString(),
            Paths: {
                // Invalidate everything
                Items: ["/*"],
                Quantity: 1,
            },
        },
    });
}
exports.invalidateCloudFrontCache = invalidateCloudFrontCache;
//# sourceMappingURL=aws.js.map