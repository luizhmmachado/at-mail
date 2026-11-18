import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function html(res: ServerResponse, status: number, content: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(content);
}

export async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON body inválido');
  return parsed as Record<string, unknown>;
}

export function cors(allowedOrigins: readonly string[], requestOrigin?: string): Record<string, string> {
  const originHeaders: Record<string, string> = {};
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    originHeaders['access-control-allow-origin'] = requestOrigin;
    originHeaders.vary = 'Origin';
  }
  return { ...originHeaders, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
}

export { createServer };
