import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Enable easy debugging in prod by setting VITE_DEBUG_BUILD=1
// This turns off minification but leaves sourcemaps on either way.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const debug = env.VITE_DEBUG_BUILD === '1';
  const disablePwa = env.VITE_DISABLE_PWA === '1';
  const filesProxyTarget = env.VITE_FILES_PROXY_TARGET || 'http://localhost:9000';
  const pwa = VitePWA({
    strategies: 'injectManifest',
    srcDir: 'src',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifest: {
      name: 'ECHO',
      short_name: 'ECHO',
      start_url: '/',
      display: 'standalone',
      background_color: '#041b1f',
      theme_color: '#0ea37e',
      icons: [
        { src: '/brand/ECHO_logo.png', sizes: '192x192', type: 'image/png' },
        { src: '/brand/ECHO_logo.png', sizes: '512x512', type: 'image/png' }
      ]
    }
  });
  const basePlugins = [react()];
  if (!disablePwa) basePlugins.push(pwa);
  return {
    plugins: basePlugins,
    // Prevent multiple React copies in monorepos / linked deps
    resolve: { dedupe: ['react', 'react-dom'] },
    server: {
      host: '0.0.0.0',
      port: 3000,
      proxy: {
        // Proxy S3/MinIO bucket via same-origin path for browser uploads
        '/files': {
          target: filesProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/files/, '/'),
        },
        // Proxy API so web dev works without setting VITE_API_URL
        '/api': {
          target: 'http://localhost:5000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    build: {
      sourcemap: true,
      minify: debug ? false : 'esbuild',
      target: 'es2019',
    },
  };
});
