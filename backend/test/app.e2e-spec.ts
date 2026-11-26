import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { configureFrontendHost } from 'src/frontend-host';
import { configureMcpOriginProtection } from 'src/mcp/mcp-origin.middleware';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppController } from 'src/app.controller';
import { AppService } from 'src/app.service';
import * as setupEnv from 'src/setup/env';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  let directory: string;

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'after-life-frontend-'));
    mkdirSync(join(directory, 'assets'));
    writeFileSync(join(directory, 'index.html'), '<html>After Life</html>');
    writeFileSync(join(directory, 'assets', 'app-test.js'), 'export {};');
    writeFileSync(join(directory, '.hidden'), 'private');
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureMcpOriginProtection(app, new ConfigService(), '/api');
    configureFrontendHost(app, directory);
    await app.init();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('/api (GET)', () => {
    jest.spyOn(setupEnv, 'isRuntimeConfigured').mockReturnValue(true);

    return request(app.getHttpServer())
      .get('/api')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          version: '1.0.0',
          status: 'ready',
          ipAddress: expect.any(String),
          supportedClientVersion: {
            min: '0.0.0',
            max: '1.0.0',
          },
        });
      });
  });

  it('serves the app shell for browser routes and caches only built assets long-term', async () => {
    const client = request(app.getHttpServer());
    for (const path of ['/', '/letters', '/apiary']) {
      await client
        .get(path)
        .expect(200, '<html>After Life</html>')
        .expect('Cache-Control', 'no-cache');
    }
    await client
      .get('/assets/app-test.js')
      .expect(200)
      .expect('Cache-Control', /immutable/);
    for (const path of ['/assets/missing.js', '/sw.js', '/.hidden']) {
      await client.get(path).expect(404);
    }
    await client
      .get('/api/missing')
      .set('Accept', 'text/html')
      .expect(404)
      .expect('Content-Type', /json/);
    await client.post('/letters').expect(404);
    await client.options('/api/mcp').set('Origin', 'https://untrusted.example').expect(403);
  });
});
