
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Use absolute base so built asset paths are /assets/... and work from any route (Vercel SPA).
  base: '/',
  build: {
    outDir: 'dist',
  }
});
