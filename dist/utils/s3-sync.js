"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeS3ETag = exports.s3Put = exports.s3Sync = void 0;
const tslib_1 = require("tslib");
const fs = (0, tslib_1.__importStar)(require("fs"));
const util = (0, tslib_1.__importStar)(require("util"));
const path = (0, tslib_1.__importStar)(require("path"));
const crypto = (0, tslib_1.__importStar)(require("crypto"));
const mime_types_1 = require("mime-types");
const lodash_1 = require("lodash");
const chalk_1 = (0, tslib_1.__importDefault)(require("chalk"));
const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);
/**
 * Synchronize a local folder to a S3 bucket.
 *
 * @return True if some changes were uploaded.
 */
async function s3Sync({ aws, localPath, targetPathPrefix, bucketName, }) {
    var _a;
    let hasChanges = false;
    const filesToUpload = await listFilesRecursively(localPath);
    const existingS3Objects = await s3ListAll(aws, bucketName, targetPathPrefix);
    const fileMatchers = (_a = aws.custom) === null || _a === void 0 ? void 0 : _a.cachePolicy.map((item) => {
        return item;
    });
    // Upload files by chunks
    let skippedFiles = 0;
    for (const batch of (0, lodash_1.chunk)(filesToUpload, 2)) {
        await Promise.all(batch.map(async (file) => {
            const targetKey = targetPathPrefix !== undefined ? path.join(targetPathPrefix, file) : file;
            const fullFilePath = path.join(localPath, file);
            const fileContent = fs.readFileSync(fullFilePath);
            // Check that the file isn't already uploaded
            if (targetKey in existingS3Objects) {
                const existingObject = existingS3Objects[targetKey];
                const etag = computeS3ETag(fileContent);
                if (etag === existingObject.ETag) {
                    skippedFiles++;
                    return;
                }
            }
            let cachePolicy;
            if (fileMatchers) {
                for (let i = 0; i < fileMatchers.length; i++) {
                    const item = fileMatchers[i];
                    if (fullFilePath.match(item.matcher)) {
                        cachePolicy = item.policy;
                        break;
                    }
                }
            }
            // eslint-disable-next-line
            console.log(`Uploading ${file} with cache policy: ${cachePolicy || ""}`);
            await s3Put(aws, bucketName, targetKey, fileContent, cachePolicy);
            hasChanges = true;
        }));
    }
    if (skippedFiles > 0) {
        console.log(chalk_1.default.gray(`Skipped uploading ${skippedFiles} unchanged files`));
    }
    const targetKeys = filesToUpload.map((file) => targetPathPrefix !== undefined ? path.join(targetPathPrefix, file) : file);
    const keysToDelete = findKeysToDelete(Object.keys(existingS3Objects), targetKeys);
    if (keysToDelete.length > 0) {
        keysToDelete.map((key) => console.log(`Deleting ${key}`));
        await s3Delete(aws, bucketName, keysToDelete);
        hasChanges = true;
    }
    return { hasChanges };
}
exports.s3Sync = s3Sync;
async function listFilesRecursively(directory) {
    const items = await readdir(directory);
    const files = await Promise.all(items.map(async (fileName) => {
        const fullPath = path.join(directory, fileName);
        const fileStat = await stat(fullPath);
        if (fileStat.isFile()) {
            return [fileName];
        }
        else if (fileStat.isDirectory()) {
            const subFiles = await listFilesRecursively(fullPath);
            return subFiles.map((subFileName) => path.join(fileName, subFileName));
        }
        return [];
    }));
    return (0, lodash_1.flatten)(files);
}
async function s3ListAll(aws, bucketName, pathPrefix) {
    var _a;
    let result;
    let continuationToken = undefined;
    const objects = {};
    do {
        result = await aws.request("S3", "listObjectsV2", {
            Bucket: bucketName,
            Prefix: pathPrefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
        });
        ((_a = result.Contents) !== null && _a !== void 0 ? _a : []).forEach((object) => {
            if (object.Key === undefined) {
                return;
            }
            objects[object.Key] = object;
        });
        continuationToken = result.NextContinuationToken;
    } while (result.IsTruncated === true);
    return objects;
}
function findKeysToDelete(existing, target) {
    // Returns every key that shouldn't exist anymore
    return existing.filter((key) => target.indexOf(key) === -1);
}
async function s3Put(aws, bucket, key, fileContent, cacheControl) {
    let contentType = (0, mime_types_1.lookup)(key);
    if (contentType === false) {
        contentType = "application/octet-stream";
    }
    await aws.request("S3", "putObject", {
        Bucket: bucket,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        CacheControl: cacheControl,
    });
}
exports.s3Put = s3Put;
async function s3Delete(aws, bucket, keys) {
    await aws.request("S3", "deleteObjects", {
        Bucket: bucket,
        Delete: {
            Objects: keys.map((key) => {
                return {
                    Key: key,
                };
            }),
        },
    });
}
function computeS3ETag(fileContent) {
    return `"${crypto.createHash("md5").update(fileContent).digest("hex")}"`;
}
exports.computeS3ETag = computeS3ETag;
//# sourceMappingURL=s3-sync.js.map