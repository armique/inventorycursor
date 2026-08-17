
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteApiDevPlugin } from './vite-api-dev-plugin';
import { viteDealwatchRuntimeDevPlugin } from './vite-dealwatch-runtime-dev-plugin';

export default defineConfig(({ mode }) => ({
  plugins: [react(), viteDealwatchRuntimeDevPlugin(), viteApiDevPlugin()],
  base: '/',
  define: {
    // `npm run dev:emulator` (vite --mode emulator) points Firebase at the local
    // emulator suite. Any other mode — including every production build — inlines
    // false, so the emulator branch is dropped from the bundle.
    'import.meta.env.VITE_FIREBASE_EMULATOR': JSON.stringify(mode === 'emulator'),
  },
  server: {
    // Same-origin Firebase Auth helper (mobile redirect). Mirrors vercel.json production proxy.
    proxy: {
      '/__/auth': {
        target: 'https://inventorycursor-e9000.firebaseapp.com',
        changeOrigin: true,
        secure: true,
      },
      '/__/firebase': {
        target: 'https://inventorycursor-e9000.firebaseapp.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          'vendor-ui': ['lucide-react'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
}));