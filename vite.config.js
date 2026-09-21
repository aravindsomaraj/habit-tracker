import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [react()],
  publicDir: 'public',
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
  },
});
