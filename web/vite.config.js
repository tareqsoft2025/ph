import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// وضع "demo": يبني نسخة تعمل بالكامل داخل المتصفح (لـ GitHub Pages)
// باستبدال مشغّل قاعدة البيانات و Express و JWT ببدائل للمتصفح.
function demoBackend() {
  const backendDir = here('../backend/src/');
  return {
    name: 'demo-backend',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer || !importer.startsWith(backendDir)) return null;
      if (id === './driver.js') return here('./src/demo/driver.js');
      if (id === 'express') return here('./src/demo/express.js');
      if (id === 'jsonwebtoken') return here('./src/demo/jwt.js');
      if (id === 'bcryptjs') return this.resolve('bcryptjs', here('./src/main.jsx'), { skipSelf: true });
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [demoBackend()] : [])],
  base: './',
  build: {
    target: 'es2022',
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
}));
