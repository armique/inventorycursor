
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteApiDevPlugin } from './vite-api-dev-plugin';

export default defineConfig({
  plugins: [react(), viteApiDevPlugin()],
  base: '/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
