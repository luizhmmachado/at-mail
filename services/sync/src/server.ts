import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { brand } from '@mail/core';
import type { SyncConfig } from './config';
import { encrypt, hashToken, opaqueToken } from './crypto';
import { openDb, type Db } from './db';
import { exchangeCode, getUser } from './google';
import { body, cors, json } from './http';
import { fetchChat, fetchGmail } from './providers';
import { readVault, writeVault } from './vault';

export interface AppServer { handler(req: IncomingMessage, res: ServerResponse): Promise<void>; close(): void }

export function createAppServer(config: SyncConfig, database = openDb(config.databasePath)): AppServer {
  const { sqlite } = database;
  const originHeaders = cors(config.publicOrigin);
  async function authenticated(req: IncomingMessage): Promise<string | undefined> {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookie = req.headers.cookie?.match(/(?:^|; )atmail_session=([^;]+)/)?.[1];
    const tokenHash = hashToken(bearer ?? cookie ?? '');
    const row = sqlite.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as { user_id: string; expires_at: number } | undefined;
    if (!row || row.expires_at < Date.now()) return undefined;
    return row.user_id;
  }
  function session(userId: string): { token: string; cookie: string } {
    const token = opaqueToken();
    sqlite.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, Date.now(), Date.now() + 30 * 24 * 60 * 60 * 1000);
    return { token, cookie: `atmail_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` };
  }
  return {
    async handler(req, res) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const headers = { ...originHeaders, 'cache-control': 'no-store' };
      if (req.method === 'OPTIONS') return json(res, 204, null, headers);
      try {
        if (req.method === 'POST' && (url.pathname === '/auth/google/exchange' || url.pathname === '/api/auth/google/exchange')) {
          const input = await body(req);
          const exchanged = await exchangeCode({ code: String(input.code ?? ''), codeVerifier: input.codeVerifier ? String(input.codeVerifier) : undefined, redirectUri: String(input.redirectUri ?? config.redirectUri), clientId: config.clientId, clientSecret: config.clientSecret });
          const user = await getUser(exchanged.accessToken);
          sqlite.prepare('INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture').run(user.sub, user.email, user.name ?? '', user.picture ?? '', Date.now());
          const accountId = `google:${user.sub}:gmail`;
          sqlite.prepare('INSERT INTO credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at').run(accountId, user.sub, 'gmail', user.email, encrypt(exchanged.refreshToken ?? '', config.encryptionKey), exchanged.scope, Date.now());
          sqlite.prepare('INSERT INTO accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').run(accountId, user.sub, 'gmail', 'email', user.email, user.name ?? user.email, 'work', Date.now());
          const chatAccountId = `google:${user.sub}:chat`;
          sqlite.prepare('INSERT INTO credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at').run(chatAccountId, user.sub, 'google-chat', user.email, encrypt(exchanged.refreshToken ?? '', config.encryptionKey), exchanged.scope, Date.now());
          sqlite.prepare('INSERT INTO accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').run(chatAccountId, user.sub, 'google-chat', 'chat', user.email, `${user.name ?? user.email} · Chat`, 'work', Date.now());
          const created = session(user.sub);
          return json(res, 200, { sessionToken: created.token, user }, { ...headers, 'set-cookie': created.cookie });
        }
        const userId = await authenticated(req);
        if (!userId) return json(res, 401, { error: 'não autenticado' }, headers);
        if (req.method === 'GET' && (url.pathname === '/vault' || url.pathname === '/api/vault')) return json(res, 200, readVault(sqlite, userId, Number(url.searchParams.get('since') ?? 0)), headers);
        if (req.method === 'GET' && (url.pathname === '/accounts' || url.pathname === '/api/accounts')) {
          const accounts = sqlite.prepare('SELECT id, provider, channel, email, display_name, context_id, updated_at FROM accounts WHERE user_id = ? ORDER BY updated_at').all(userId) as Array<{ id: string; provider: string; channel: string; email: string; display_name: string; context_id: string; updated_at: number }>;
          return json(res, 200, { accounts: accounts.map((account) => ({ id: account.id, provider: account.provider, channel: account.channel, transport: 'oauth2-google', email: account.email, displayName: account.display_name, contextId: account.context_id, status: 'connected', secretRef: `server:${account.id}`, createdAt: account.updated_at, updatedAt: account.updated_at })) }, headers);
        }
        if (req.method === 'PUT' && (url.pathname === '/vault' || url.pathname === '/api/vault')) {
          const input = await body(req);
          return json(res, 200, writeVault(sqlite, userId, Array.isArray(input.records) ? input.records as never[] : []), headers);
        }
        const syncMatch = url.pathname.match(/^(?:\/api)?\/sync\/(gmail|google-chat)$/);
        if (req.method === 'POST' && syncMatch) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = sqlite.prepare('SELECT context_id FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId) as { context_id: string } | undefined;
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          const result = syncMatch[1] === 'gmail' ? await fetchGmail(sqlite, config, userId, accountId, account.context_id, input.cursor ? String(input.cursor) : undefined) : await fetchChat(sqlite, config, userId, accountId, account.context_id);
          return json(res, 200, result, headers);
        }
        return json(res, 404, { error: 'rota não encontrada' }, headers);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'erro interno';
        return json(res, 500, { error: message }, headers);
      }
    },
    close() { database.close(); }
  };
}

export function randomEncryptionKey(): string { return randomBytes(32).toString('base64'); }
