import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../services/sync/src/config';
import { createAppServer, type AppServer } from '../services/sync/src/server';

let appPromise: Promise<AppServer> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  appPromise ??= createAppServer(loadConfig());
  const app = await appPromise;
  // Vercel already strips /api from the function route in some configurations;
  // the service accepts both prefixed and unprefixed paths.
  await app.handler(req, res);
}
