import { INestApplication } from '@nestjs/common';
import { Router, static as serveStatic } from 'express';
import { extname, join } from 'path';
import { rootDir } from './setup/env';

export function configureFrontendHost(
  app: INestApplication,
  directory = join(rootDir, 'frontend', 'dist'),
): void {
  app.setGlobalPrefix('api');
  const frontend = Router();
  frontend.use('/api', (_request, _response, next) => next('router'));
  frontend.use(
    '/assets',
    serveStatic(join(directory, 'assets'), {
      immutable: true,
      maxAge: '1y',
      index: false,
      dotfiles: 'deny',
    }),
    (_request, response) => response.sendStatus(404),
  );
  frontend.use(
    serveStatic(directory, {
      index: false,
      redirect: false,
      dotfiles: 'deny',
      setHeaders: (response) => response.setHeader('Cache-Control', 'no-cache'),
    }),
  );
  frontend.get<{ 0: string }>('*', (request, response, next) => {
    const path = request.params[0];
    if (
      path.split('/').some((part) => part.startsWith('.')) ||
      extname(path) ||
      !request.accepts('html')
    ) {
      next();
      return;
    }
    response.sendFile('index.html', { root: directory, headers: { 'Cache-Control': 'no-cache' } });
  });
  app.use(frontend);
}
