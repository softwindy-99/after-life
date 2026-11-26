import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { createObjectStorage, ObjectStorage, readObject } from './object-storage';
import { StorageSettings } from './storage-config';

describe.each(['s3', 'oss'] as const)('%s official SDK HTTP contract', (driver) => {
  let server: Server;
  let client: ObjectStorage;
  const requests: { method: string; url: string; authorization: string }[] = [];
  const objects = new Map<string, Buffer>();

  beforeAll(async () => {
    server = createServer(async (request, response) => {
      const path = request.url.split('?')[0];
      requests.push({
        method: request.method,
        url: path,
        authorization: request.headers.authorization || '',
      });
      response.setHeader('x-oss-request-id', 'test-request');
      if (request.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        objects.set(path, Buffer.concat(chunks));
        response.setHeader('ETag', '"test-etag"');
        response.end();
      } else if (request.method === 'GET') {
        const body = objects.get(path);
        response.setHeader('Content-Length', body.length);
        response.end(body);
      } else {
        objects.delete(path);
        response.statusCode = 204;
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const settings: StorageSettings = {
      driver,
      endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      region: driver === 'oss' ? 'cn-hangzhou' : 'us-east-1',
      bucket: 'private-bucket',
      prefix: 'after-life',
      forcePathStyle: true,
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
    };
    client = createObjectStorage(settings);
  });

  afterAll(async () => {
    client?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it('writes, streams and deletes a private object using V4 authentication', async () => {
    const body = Buffer.from('private attachment');
    await client.put('after-life/file-uuid', body);
    expect(await readObject(await client.open('after-life/file-uuid'), body.length)).toEqual(body);
    await client.delete('after-life/file-uuid');
    expect(objects.size).toBe(0);
    expect(requests.map((request) => request.method)).toEqual(['PUT', 'GET', 'DELETE']);
    for (const request of requests) {
      expect(request.url).toContain('/after-life/file-uuid');
      expect(request.authorization).toMatch(
        driver === 's3' ? /^AWS4-HMAC-SHA256 / : /^OSS4-HMAC-SHA256 /,
      );
    }
  });
});
