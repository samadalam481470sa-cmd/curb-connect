import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: { port: 4319, strictPort: true, host: '127.0.0.1' },
  define: {
    'process.env.NEXT_PUBLIC_FIELDPRO_NATIVE_AR': 'undefined',
    'process.env.NEXT_PUBLIC_FIELDPRO_WEBXR': 'undefined',
  },
});
