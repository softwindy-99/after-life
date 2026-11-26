import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const path = new URL('../.env', import.meta.url);
  const env: Record<string, string> = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3000';

  return {
    envPrefix: [],
    define: Object.fromEntries(
      Object.entries(env)
        .filter(([key]) => key.startsWith('VITE_'))
        .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
    ),
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        injectRegister: null,
        manifest: {
          name: 'After Life',
          short_name: 'After Life',
          description: '每日签到并管理写给未来的信件',
          lang: 'zh-CN',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#0c0e13',
          theme_color: '#0c0e13',
          icons: [
            { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
          shortcuts: [
            {
              name: '立即签到',
              short_name: '签到',
              description: '打开每日签到页面',
              url: '/checkin',
              icons: [{ src: '/icons/pwa-192.png', sizes: '192x192' }],
            },
          ],
        },
        injectManifest: {
          injectionPoint: undefined,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    preview: { proxy: {} },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '^/api(?:/|\\?|$)': {
          target: proxyTarget,
          rewrite: (path) => path.replace(/^\/api(?=\/|\?|$)/, '') || '/',
        },
      },
    },
  };
});
