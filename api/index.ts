import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../services/sync/src/config';
import { createAppServer, type AppServer } from '../services/sync/src/server';

let appPromise: Promise<AppServer> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    appPromise ??= createAppServer(loadConfig());
    const app = await appPromise;
    // Vercel already strips /api from the function route in some configurations;
    // the service accepts both prefixed and unprefixed paths.
    await app.handler(req, res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'backend initialization failed' }));
  }
}
