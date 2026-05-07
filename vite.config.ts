import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    port: 5173,
    host: true,        // bind to LAN
    https: true,       // self-signed cert
    proxy: {
      // ws://(host)/ws → ws://localhost:8080
      '/ws': { target: 'ws://localhost:8080', ws: true, changeOrigin: true },
    },
  },
  build: { target: 'es2020', sourcemap: true },
});
