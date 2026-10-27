// S3Storage: production adapter for any S3-compatible store. Presigned PUT/GET with server-side
// encryption (SSE-S3). The bucket must block public access; URLs are short-lived and only issued
// after the API authorized the caller for that object (BE-075 S).
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertObjectKey,
  type DownloadUrlOptions,
  safeFileName,
  type SignedUpload,
  type StorageAdapter,
  type StoredObjectInfo,
  type UploadUrlOptions,
} from './adapter';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
}

const SSE = 'AES256' as const;

export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint && { endpoint: options.endpoint }),
      forcePathStyle: options.forcePathStyle,
      ...(options.accessKeyId &&
        options.secretAccessKey && {
          credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
        }),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: SSE,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertObjectKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
    if (!out.Body) throw new Error('empty object body');
    return Buffer.from(await out.Body.transformToByteArray());
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    assertObjectKey(key);
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { sizeBytes: out.ContentLength ?? 0 };
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedUpload> {
    assertObjectKey(key);
    // The declared size cannot be enforced by a presigned PUT alone; the completion step re-checks
    // size, type and checksum before anything is published.
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ContentType: options.contentType,
        ServerSideEncryption: SSE,
      }),
      { expiresIn: options.expiresInSeconds },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': options.contentType, 'x-amz-server-side-encryption': SSE },
      expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000),
    };
  }

  async createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    assertObjectKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ...(options.fileName && {
          ResponseContentDisposition: `inline; filename="${safeFileName(options.fileName)}"`,
        }),
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }
}
