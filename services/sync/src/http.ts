import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** Limite de bytes aceito em qualquer corpo JSON enviado ao backend. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor() {
    super('corpo da requisição excede o limite');
    this.name = 'PayloadTooLargeError';
  }
}

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('corpo JSON inválido');
    this.name = 'InvalidJsonBodyError';
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function html(res: ServerResponse, status: number, content: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(content);
}

/**
 * Lê o corpo JSON com limite de tamanho. Sem o limite um POST grande esgotaria a
 * memória da função serverless antes de qualquer validação.
 */
export async function body(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new PayloadTooLargeError();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new PayloadTooLargeError();
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InvalidJsonBodyError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InvalidJsonBodyError();
  return parsed as Record<string, unknown>;
}

export function cors(allowedOrigins: readonly string[], requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };
  const allowed = requestOrigin !== undefined && allowedOrigins.includes(requestOrigin);
  if (allowed) {
    headers['access-control-allow-origin'] = requestOrigin;
    headers['access-control-allow-credentials'] = 'true';
    headers.vary = 'Origin';
  }
  return headers;
}

export { createServer };
