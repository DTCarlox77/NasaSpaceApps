/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// El origen http://localhost:5173 está en CORS_ORIGIN de la API: el puerto es fijo.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: { VITE_API_URL: 'http://api.test' },
    restoreMocks: true,
  },
});
