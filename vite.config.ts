
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteApiDevPlugin } from './vite-api-dev-plugin';
import { viteDealwatchRuntimeDevPlugin } from './vite-dealwatch-runtime-dev-plugin';

// HTTPS/HTTP2 was tried here to fix dev-mode cold-start lag (245+ unbundled source file
// requests queueing through Chrome's ~6-connection HTTP/1.1 cap). Reverted: http:// and
// https:// are different origins, so switching silently orphaned all existing
// localStorage/IndexedDB data (inventory, settings, everything) behind the old http://
// origin. Do not re-enable without a real data-migration step, not just a protocol swap.
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
    // CSV exports in data/ebay-abrechnung* can be locked by Excel/OneDrive on Windows — watching them crashes Vite (EBUSY).
    watch: {
      ignored: ['**/data/ebay-abrechnung/**', '**/data/ebay-abrechnung - backup/**'],
    },
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