import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

const server = process.env.SERVER_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [svelte()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../../shared', import.meta.url)) } },
  server: {
    port: 5174,
    proxy: {
      '/api': server,
      '/audio': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
