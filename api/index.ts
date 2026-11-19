import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadConfig } from '../services/sync/src/config.js';
import { cors } from '../services/sync/src/http.js';
import { createAppServer, type AppServer } from '../services/sync/src/server.js';

let appPromise: Promise<AppServer> | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  const publicOrigins = (process.env.PUBLIC_ORIGINS ?? process.env.PUBLIC_ORIGIN ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const corsHeaders = cors(publicOrigins, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  try {
    appPromise ??= createAppServer(loadConfig());
    const app = await appPromise;
    // Vercel already strips /api from the function route in some configurations;
    // the service accepts both prefixed and unprefixed paths.
    await app.handler(req, res);
  } catch (error) {
    res.writeHead(500, { ...corsHeaders, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'backend initialization failed' }));
  }
}
