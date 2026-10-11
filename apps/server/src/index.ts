import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);

const { app } = await buildApp({
  databaseUrl: process.env.DATABASE_URL,
  // Sans DATABASE_URL, les parties sont gardées dans .data/ grâce à PGlite.
  databaseDir: process.env.PGLITE_DIR ?? fileURLToPath(new URL('../.data', import.meta.url)),
  clientDir: process.env.CLIENT_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url)),
  corsOrigin: process.env.CORS_ORIGIN,
  logger: true,
});

await app.listen({ port, host: '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
