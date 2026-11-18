import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import type { Pool, QueryResultRow } from 'pg';
import type { SyncConfig } from '../src/config';
import type { Db } from '../src/db';
import { createAppServer, type AppServer } from '../src/server';

interface PendingRow {
  code: string;
  error: string;
  createdAt: number;
}

const config: SyncConfig = {
  port: 8790,
  databaseUrl: 'postgresql://fake',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:8790/auth/google/callback',
  sessionSecret: 'session',
  encryptionKey: Buffer.alloc(32),
  publicOrigins: ['http://localhost:8081', 'https://at-mail.vercel.app', 'http://tauri.localhost', 'tauri://localhost']
};

/** Banco de mentira: só as quatro consultas que o fluxo de login realmente usa. */
function createFakeDb(): { db: Db; rows: Map<string, PendingRow> } {
  const rows = new Map<string, PendingRow>();

  const db: Db = {
    pool: null as unknown as Pool,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      if (text.startsWith('DELETE FROM atmail_oauth_pending WHERE created_at <')) {
        const cutoff = Number(values[0]);
        for (const [state, row] of rows) if (row.createdAt < cutoff) rows.delete(state);
        return { rows: [] };
      }
      if (text.startsWith('INSERT INTO atmail_oauth_pending')) {
        const [state, code, error, createdAt] = values as [string, string, string, number];
        rows.set(state, { code, error, createdAt });
        return { rows: [] };
      }
      if (text.startsWith('UPDATE atmail_oauth_pending')) {
        const [code, error, state, since] = values as [string, string, string, number];
        const row = rows.get(state);
        if (!row || row.createdAt <= since) return { rows: [] };
        row.code = code;
        row.error = error;
        return { rows: [{ state } as unknown as T] };
      }
      if (text.startsWith('SELECT code, error FROM atmail_oauth_pending')) {
        const [state, since] = values as [string, number];
        const row = rows.get(state);
        if (!row || row.createdAt <= since || (row.code === '' && row.error === '')) return { rows: [] };
        return { rows: [{ code: row.code, error: row.error } as unknown as T] };
      }
      if (text.startsWith('DELETE FROM atmail_oauth_pending WHERE state =')) {
        rows.delete(String(values[0]));
        return { rows: [] };
      }
      throw new Error(`consulta não suportada pelo banco de teste: ${text}`);
    },
    transaction: (() => {
      throw new Error('transação não usada no fluxo OAuth');
    }) as unknown as Db['transaction'],
    close: async () => undefined
  };

  return { db, rows };
}

interface ResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function call(app: AppServer, method: 'GET' | 'POST' | 'OPTIONS', path: string, ip: string, origin?: string): Promise<ResponseSnapshot> {
  return await new Promise<ResponseSnapshot>((resolve) => {
    let status = 0;
    let headers: Record<string, string> = {};
    const req = {
      method,
      url: path,
      headers: { host: 'localhost:8790', 'x-forwarded-for': ip, ...(origin ? { origin } : {}) }
    } as unknown as IncomingMessage;
    const res = {
      writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
        status = nextStatus;
        headers = nextHeaders ?? {};
      },
      end(body?: string) {
        resolve({ status, headers, body: body ?? '' });
      }
    } as unknown as ServerResponse;
    void app.handler(req, res);
  });
}

async function startLogin(app: AppServer, ip: string): Promise<string> {
  const response = await call(app, 'POST', '/auth/google/start', ip);
  assert.equal(response.status, 200);
  const { state } = JSON.parse(response.body) as { state: string };
  assert.equal(typeof state, 'string');
  assert.ok(state.length >= 32, 'state precisa ter entropia suficiente');
  return state;
}

describe('fluxo OAuth do backend', () => {
  it('permite preflight somente para origens configuradas', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const web = await call(app, 'OPTIONS', '/auth/google/start', '10.0.0.6', 'https://at-mail.vercel.app');
    assert.equal(web.status, 204);
    assert.equal(web.headers['access-control-allow-origin'], 'https://at-mail.vercel.app');
    assert.equal(web.headers.vary, 'Origin');

    const desktop = await call(app, 'OPTIONS', '/auth/google/start', '10.0.0.7', 'http://tauri.localhost');
    assert.equal(desktop.headers['access-control-allow-origin'], 'http://tauri.localhost');

    const unknown = await call(app, 'OPTIONS', '/auth/google/start', '10.0.0.8', 'https://malicious.example');
    assert.equal(unknown.headers['access-control-allow-origin'], undefined);
    await app.close();
  });

  it('só aceita callback de um state registrado pelo /auth/google/start', async () => {
    const { db, rows } = createFakeDb();
    const app = await createAppServer(config, db);

    const response = await call(app, 'GET', '/auth/google/callback?code=INVASOR&state=state-inventado', '10.0.0.1');

    assert.equal(response.status, 400);
    assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(response.body, /expirada/i);
    assert.equal(rows.size, 0, 'a rota pública não pode criar linhas sem state prévio');
    await app.close();
  });

  it('entrega o code uma única vez e mantém o state em espera antes disso', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.2';

    const state = await startLogin(app, ip);

    const beforeCallback = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(beforeCallback.body), { pending: true });

    const callback = await call(app, 'GET', `/auth/google/callback?code=CODE123&state=${state}`, ip);
    assert.equal(callback.status, 200);
    assert.equal(callback.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(callback.body, /voltar ao @mail/i);
    assert.equal(callback.headers['cache-control'], 'no-store');

    const polled = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(polled.body), { code: 'CODE123' });

    const consumed = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(consumed.body), { pending: true }, 'o code não pode ser devolvido duas vezes');
    await app.close();
  });

  it('propaga a recusa do Google e não vaza código', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.3';

    const state = await startLogin(app, ip);
    const denied = await call(app, 'GET', `/auth/google/callback?error=access_denied&state=${state}`, ip);
    assert.equal(denied.status, 200);
    assert.match(denied.body, /recusou/i);

    const polled = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(polled.body), { error: 'access_denied' });
    await app.close();
  });

  it('exige state no polling', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const response = await call(app, 'GET', '/auth/google/code', '10.0.0.4');

    assert.equal(response.status, 400);
    await app.close();
  });

  it('limita quantos logins um mesmo endereço pode iniciar', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.5';

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      statuses.push((await call(app, 'POST', '/auth/google/start', ip)).status);
    }

    assert.equal(statuses.slice(0, 30).every((status) => status === 200), true);
    assert.equal(statuses[30], 429);
    await app.close();
  });
});
