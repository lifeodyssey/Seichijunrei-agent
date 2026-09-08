import { catalogMediaBucket, catalogSnapshotBucket, mapTilesBucket } from "./buckets.ts"

export const catalogBucketName = catalogMediaBucket.name;
export const tilesBucketName = mapTilesBucket.name;
export const snapshotBucketName = catalogSnapshotBucket.name;

// The staging Access service token, whose output NAMES are what the ESC
// environment imports through the `pulumi-stacks` provider (see staging-access.ts).
export { stagingAccessClientId, stagingAccessClientSecret } from "./staging-access.ts"
