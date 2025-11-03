import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Enable easy debugging in prod by setting VITE_DEBUG_BUILD=1
// This turns off minification but leaves sourcemaps on either way.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const debug = env.VITE_DEBUG_BUILD === '1';
  const filesProxyTarget = env.VITE_FILES_PROXY_TARGET || 'http://localhost:9000';
  return {
    plugins: [react()],
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
      },
    },
    build: {
      sourcemap: true,
      minify: debug ? false : 'esbuild',
      target: 'es2019',
    },
  };
});
