import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_API_BASE_URL is injected at build time by Vercel / Docker ARG
const API_BASE_URL = process.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'assets/icons/*.png'],
      manifest: false,        // We use the hand-crafted public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB — covers offline bundles
        runtimeCaching: [
          {
            urlPattern: new RegExp(`^${API_BASE_URL}/api/v1/(students|teachers|schools)/`),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],

  define: {
    __API_BASE_URL__: JSON.stringify(API_BASE_URL),
  },

  build: {
    outDir: 'dist',
    sourcemap: false,         // Disable in production to reduce bundle size
    rollupOptions: {
      output: {
        // Manual chunk strategy removed due to Vite 8 Rolldown compatibility
        // Default chunking provides adequate performance splitting
      },
    },
    // Target modern browsers — Safari 14+, Chrome 90+, Firefox 88+
    // (covers ~99% of Kenyan school lab browsers in 2026)
    target: 'es2020',
    // Chunk size warning threshold — PWA offline shell must be < 500KB
    chunkSizeWarningLimit: 500,
  },

  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: API_BASE_URL,
        changeOrigin: true,
      },
    },
  },
});
