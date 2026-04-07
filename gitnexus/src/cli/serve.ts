import { createServer } from '../server/api.js';

export const serveCommand = async (options?: {
  port?: string;
  host?: string;
  embeddings?: boolean;
  nightlyRefresh?: boolean;
  nightlyAt?: string;
}) => {
  const port = Number(options?.port ?? 6660);
  const host = options?.host ?? '127.0.0.1';
  await createServer(port, host, {
    embeddings: options?.embeddings,
    nightlyRefresh: options?.nightlyRefresh,
    nightlyAt: options?.nightlyAt,
  });
};
