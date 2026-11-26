import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import OSS = require('ali-oss');
import { Readable } from 'stream';
import { StorageSettings } from './storage-config';

export interface ObjectStorage {
  put(key: string, body: Buffer): Promise<void>;
  open(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  close(): void;
}

export function createObjectStorage(settings: StorageSettings): ObjectStorage {
  if (settings.driver === 's3') {
    const client = new S3Client({
      endpoint: settings.endpoint,
      region: settings.region,
      forcePathStyle: settings.forcePathStyle,
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.accessKeySecret,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 },
    });
    return {
      async put(Key, Body) {
        await client.send(
          new PutObjectCommand({
            Bucket: settings.bucket,
            Key,
            Body,
            ContentType: 'application/octet-stream',
          }),
        );
      },
      async open(Key) {
        const result = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key }));
        if (!(result.Body instanceof Readable)) throw new Error('Invalid object stream');
        return result.Body;
      },
      async delete(Key) {
        await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key }));
      },
      close: () => client.destroy(),
    };
  }
  const client = new OSS({
    endpoint: settings.endpoint,
    region: settings.region.startsWith('oss-') ? settings.region : `oss-${settings.region}`,
    bucket: settings.bucket,
    accessKeyId: settings.accessKeyId,
    accessKeySecret: settings.accessKeySecret,
    authorizationV4: true,
    timeout: 30000,
  });
  return {
    async put(key, body) {
      await client.put(key, body, { mime: 'application/octet-stream' });
    },
    async open(key) {
      return (await client.getStream(key)).stream;
    },
    async delete(key) {
      await client.delete(key);
    },
    close() {},
  };
}

export async function readObject(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) throw new Error('Object exceeds expected size');
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}
