import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createServer, preview } from 'vite';

// Exercise the actual Vite config in both modes without starting a database-backed API.
for (const mode of ['dev', 'preview']) {
  test(
    mode === 'dev'
      ? 'dev proxies API requests and serves SPA routes'
      : 'Vite preview has no API proxy',
    async () => {
      const upstream = createHttpServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.writeHead(req.url.startsWith('/missing') ? 404 : 200, {
          'Content-Type': 'application/json',
        });
        res.end(
          JSON.stringify({
            path: req.url,
            method: req.method,
            authorization: req.headers.authorization,
            contentType: req.headers['content-type'],
            body: Buffer.concat(chunks).toString(),
          }),
        );
      });
      await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
      const previousTarget = process.env.VITE_API_PROXY_TARGET;
      process.env.VITE_API_PROXY_TARGET = 'http://127.0.0.1:1';
      const directory = await mkdtemp(join(tmpdir(), 'afterlife-web-preview-'));
      let server;
      try {
        const configDir = join(directory, 'frontend');
        await mkdir(configDir);
        await copyFile('vite.config.ts', join(configDir, 'vite.config.ts'));
        await symlink(resolve('node_modules'), join(configDir, 'node_modules'), 'dir');
        await writeFile(join(configDir, 'package.json'), '{"type":"module"}');
        await writeFile(
          join(directory, '.env'),
          `VITE_API_PROXY_TARGET=http://127.0.0.1:${upstream.address().port}\n`,
        );
        const configFile = join(configDir, 'vite.config.ts');
        const output = join(directory, 'dist');
        await mkdir(output);
        await writeFile(join(output, 'index.html'), '<!doctype html><title>SPA fixture</title>');
        const options = { host: '127.0.0.1', port: 0, strictPort: false };
        if (mode === 'dev') {
          server = await createServer({ configFile, server: options });
          await server.listen();
        } else {
          server = await preview({ configFile, preview: options, build: { outDir: output } });
        }
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
        if (mode === 'preview') {
          const response = await fetch(`${origin}/api/user`);
          assert.match(response.headers.get('content-type'), /text\/html/);
          return;
        }
        for (const path of [
          '/api/user?limit=2',
          '/api/resource/id/content?token=test',
          '/api',
          '/api?x=1',
        ]) {
          const response = await fetch(`${origin}${path}`);
          const body = await response.json();
          const stripped = path.slice(4);
          assert.equal(body.path, stripped.startsWith('/') ? stripped : `/${stripped}`);
        }
        const api = await server.ssrLoadModule('/src/lib/api.ts');
        const originalWindow = globalThis.window;
        const originalFetch = globalThis.fetch;
        try {
          globalThis.window = { location: { origin }, localStorage: { getItem: () => null } };
          globalThis.fetch = (url, init) => originalFetch(new URL(url, origin), init);
          assert.equal((await api.fetchProfile()).path, '/user');
          assert.equal(
            api.absoluteResourceUrl('/resource/id/content?token=test'),
            `${origin}/api/resource/id/content?token=test`,
          );
        } finally {
          globalThis.fetch = originalFetch;
          if (originalWindow === undefined) delete globalThis.window;
          else globalThis.window = originalWindow;
        }
        const upload = await fetch(`${origin}/api/resource`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-only',
            'Content-Type': 'application/octet-stream',
          },
          body: 'upload bytes',
        });
        assert.deepEqual(await upload.json(), {
          path: '/resource',
          method: 'POST',
          authorization: 'Bearer test-only',
          contentType: 'application/octet-stream',
          body: 'upload bytes',
        });
        const missing = await fetch(`${origin}/api/missing`);
        assert.equal(missing.status, 404);
        assert.match(missing.headers.get('content-type'), /application\/json/);
        for (const path of ['/mail', '/letters', '/apiary']) {
          const response = await fetch(`${origin}${path}`, { headers: { Accept: 'text/html' } });
          assert.equal(response.status, 200);
          assert.match(response.headers.get('content-type'), /text\/html/);
        }
      } finally {
        if (server) {
          if (mode === 'dev') await server.close();
          else
            await new Promise((resolve, reject) =>
              server.httpServer.close((error) => (error ? reject(error) : resolve())),
            );
        }
        await new Promise((resolve) => upstream.close(resolve));
        if (previousTarget === undefined) delete process.env.VITE_API_PROXY_TARGET;
        else process.env.VITE_API_PROXY_TARGET = previousTarget;
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
