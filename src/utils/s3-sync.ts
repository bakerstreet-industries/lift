import type {
    DeleteObjectsOutput,
    DeleteObjectsRequest,
    ListObjectsV2Output,
    ListObjectsV2Request,
    PutObjectOutput,
    PutObjectRequest,
    Object as S3Object,
} from "aws-sdk/clients/s3";
import * as fs from "fs";
import * as util from "util";
import * as path from "path";
import * as crypto from "crypto";
import { lookup } from "mime-types";
import { chunk, flatten } from "lodash";
import chalk from "chalk";
import type { AwsProvider } from "@lift/providers";

const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

type S3Objects = Record<string, S3Object>;

/**
 * Synchronize a local folder to a S3 bucket.
 *
 * @return True if some changes were uploaded.
 */
export async function s3Sync({
    aws,
    localPath,
    targetPathPrefix,
    bucketName,
}: {
    aws: AwsProvider;
    localPath: string;
    targetPathPrefix?: string;
    bucketName: string;
}): Promise<{ hasChanges: boolean }> {
    let hasChanges = false;
    const filesToUpload: string[] = await listFilesRecursively(localPath);
    const existingS3Objects = await s3ListAll(aws, bucketName, targetPathPrefix);

    const fileMatchers = aws.custom?.cachePolicy.map((item) => {
        return item;
    });

    // Upload files by chunks
    let skippedFiles = 0;
    for (const batch of chunk(filesToUpload, 2)) {
        await Promise.all(
            batch.map(async (file) => {
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

                let cachePolicy: string | undefined;
                if (fileMatchers) {
                    for (let i = 0; i < fileMatchers.length; i++) {
                        const item = fileMatchers[i];
                        if (RegExp(item.matcher).exec(fullFilePath)) {
                            cachePolicy = item.policy;
                            break;
                        }
                    }
                }
                // eslint-disable-next-line
                console.log(`Uploading ${file} with cache policy: ${cachePolicy || ""}`);
                await s3Put(aws, bucketName, targetKey, fileContent, cachePolicy);
                hasChanges = true;
            })
        );
    }
    if (skippedFiles > 0) {
        console.log(chalk.gray(`Skipped uploading ${skippedFiles} unchanged files`));
    }

    const targetKeys = filesToUpload.map((file) =>
        targetPathPrefix !== undefined ? path.join(targetPathPrefix, file) : file
    );
    const keysToDelete = findKeysToDelete(Object.keys(existingS3Objects), targetKeys);
    if (keysToDelete.length > 0) {
        keysToDelete.map((key) => console.log(`Deleting ${key}`));
        await s3Delete(aws, bucketName, keysToDelete);
        hasChanges = true;
    }

    return { hasChanges };
}

async function listFilesRecursively(directory: string): Promise<string[]> {
    const items = await readdir(directory);

    const files = await Promise.all(
        items.map(async (fileName) => {
            const fullPath = path.join(directory, fileName);
            const fileStat = await stat(fullPath);
            if (fileStat.isFile()) {
                return [fileName];
            } else if (fileStat.isDirectory()) {
                const subFiles = await listFilesRecursively(fullPath);

                return subFiles.map((subFileName) => path.join(fileName, subFileName));
            }

            return [];
        })
    );

    return flatten(files);
}

async function s3ListAll(aws: AwsProvider, bucketName: string, pathPrefix?: string): Promise<S3Objects> {
    let result;
    let continuationToken = undefined;
    const objects: Record<string, S3Object> = {};
    do {
        result = await aws.request<ListObjectsV2Request, ListObjectsV2Output>("S3", "listObjectsV2", {
            Bucket: bucketName,
            Prefix: pathPrefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
        });
        (result.Contents ?? []).forEach((object) => {
            if (object.Key === undefined) {
                return;
            }
            objects[object.Key] = object;
        });
        continuationToken = result.NextContinuationToken;
    } while (result.IsTruncated === true);

    return objects;
}

function findKeysToDelete(existing: string[], target: string[]): string[] {
    // Returns every key that shouldn't exist anymore
    return existing.filter((key) => target.indexOf(key) === -1);
}

export async function s3Put(
    aws: AwsProvider,
    bucket: string,
    key: string,
    fileContent: Buffer,
    cacheControl?: string
): Promise<void> {
    let contentType = lookup(key);
    if (contentType === false) {
        contentType = "application/octet-stream";
    }
    await aws.request<PutObjectRequest, PutObjectOutput>("S3", "putObject", {
        Bucket: bucket,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        CacheControl: cacheControl,
    });
}

async function s3Delete(aws: AwsProvider, bucket: string, keys: string[]): Promise<void> {
    await aws.request<DeleteObjectsRequest, DeleteObjectsOutput>("S3", "deleteObjects", {
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

export function computeS3ETag(fileContent: Buffer): string {
    return `"${crypto.createHash("md5").update(fileContent).digest("hex")}"`;
}
