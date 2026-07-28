
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteApiDevPlugin } from './vite-api-dev-plugin';
import { viteMarketDevPlugin } from './vite-market-dev-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [react(), viteMarketDevPlugin(), viteApiDevPlugin()],
  base: '/',
  define: {
    // `npm run dev:emulator` (vite --mode emulator) points Firebase at the local
    // emulator suite. Any other mode — including every production build — inlines
    // false, so the emulator branch is dropped from the bundle.
    'import.meta.env.VITE_FIREBASE_EMULATOR': JSON.stringify(mode === 'emulator'),
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'vendor-charts': ['recharts'],
          'vendor-ui': ['lucide-react'],
          'vendor-xlsx': ['xlsx'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));