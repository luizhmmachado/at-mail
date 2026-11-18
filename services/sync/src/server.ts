import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncConfig } from './config.js';
import { encrypt, hashToken, opaqueToken } from './crypto.js';
import { openDb, type Db } from './db.js';
import { exchangeCode, getUser } from './google.js';
import { body, cors, json } from './http.js';
import { fetchChat, fetchGmail, markGmailMessagesRead, sendGmail } from './providers.js';
import { readVault, writeVault } from './vault.js';

export interface AppServer { handler(req: IncomingMessage, res: ServerResponse): Promise<void>; close(): Promise<void> }

export async function createAppServer(config: SyncConfig, database?: Db): Promise<AppServer> {
  const db = database ?? await openDb(config.databaseUrl);
  const originHeaders = cors(config.publicOrigin);
  async function authenticated(req: IncomingMessage): Promise<string | undefined> {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const cookie = req.headers.cookie?.match(/(?:^|; )atmail_session=([^;]+)/)?.[1];
    const tokenHash = hashToken(bearer ?? cookie ?? '');
    const row = (await db.query<{ user_id: string; expires_at: string }>('SELECT user_id, expires_at FROM atmail_sessions WHERE token_hash = $1', [tokenHash])).rows[0];
    if (!row || Number(row.expires_at) < Date.now()) return undefined;
    return row.user_id;
  }
  async function session(userId: string): Promise<{ token: string; cookie: string }> {
    const token = opaqueToken();
    await db.query('INSERT INTO atmail_sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [hashToken(token), userId, Date.now(), Date.now() + 30 * 24 * 60 * 60 * 1000]);
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
          const now = Date.now();
          await db.query('INSERT INTO atmail_users (id, email, name, picture, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture', [user.sub, user.email, user.name ?? '', user.picture ?? '', now]);
          const accountId = `google:${user.sub}:gmail`;
          const encryptedRefresh = encrypt(exchanged.refreshToken ?? '', config.encryptionKey);
          await db.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at', [accountId, user.sub, 'gmail', user.email, encryptedRefresh, exchanged.scope, now]);
          await db.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO NOTHING', [accountId, user.sub, 'gmail', 'email', user.email, user.name ?? user.email, 'work', now]);
          const chatAccountId = `google:${user.sub}:chat`;
          await db.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at', [chatAccountId, user.sub, 'google-chat', user.email, encryptedRefresh, exchanged.scope, now]);
          await db.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO NOTHING', [chatAccountId, user.sub, 'google-chat', 'chat', user.email, `${user.name ?? user.email} · Chat`, 'work', now]);
          const created = await session(user.sub);
          return json(res, 200, { sessionToken: created.token, user }, { ...headers, 'set-cookie': created.cookie });
        }
        const userId = await authenticated(req);
        if (!userId) return json(res, 401, { error: 'não autenticado' }, headers);
        if (req.method === 'POST' && (url.pathname === '/auth/google/add' || url.pathname === '/api/auth/google/add')) {
          const input = await body(req);
          const exchanged = await exchangeCode({ code: String(input.code ?? ''), codeVerifier: input.codeVerifier ? String(input.codeVerifier) : undefined, redirectUri: String(input.redirectUri ?? config.redirectUri), clientId: config.clientId, clientSecret: config.clientSecret });
          const user = await getUser(exchanged.accessToken);
          const now = Date.now();
          const accountId = `google:${user.sub}:gmail`;
          const encryptedRefresh = encrypt(exchanged.refreshToken ?? '', config.encryptionKey);
          await db.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET user_id=excluded.user_id, encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at', [accountId, userId, 'gmail', user.email, encryptedRefresh, exchanged.scope, now]);
          await db.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at', [accountId, userId, 'gmail', 'email', user.email, user.name ?? user.email, 'work', now]);
          const chatAccountId = `google:${user.sub}:chat`;
          await db.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET user_id=excluded.user_id, encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at', [chatAccountId, userId, 'google-chat', user.email, encryptedRefresh, exchanged.scope, now]);
          await db.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at', [chatAccountId, userId, 'google-chat', 'chat', user.email, `${user.name ?? user.email} · Chat`, 'work', now]);
          return json(res, 200, { added: true }, headers);
        }
        if (req.method === 'GET' && (url.pathname === '/vault' || url.pathname === '/api/vault')) return json(res, 200, await readVault(db, userId, Number(url.searchParams.get('since') ?? 0)), headers);
        if (req.method === 'GET' && (url.pathname === '/accounts' || url.pathname === '/api/accounts')) {
          const accounts = (await db.query<{ id: string; provider: string; channel: string; email: string; display_name: string; context_id: string; updated_at: string }>('SELECT id, provider, channel, email, display_name, context_id, updated_at FROM atmail_accounts WHERE user_id = $1 ORDER BY updated_at', [userId])).rows;
          return json(res, 200, { accounts: accounts.map((account) => ({ id: account.id, provider: account.provider, channel: account.channel, transport: 'oauth2-google', email: account.email, displayName: account.display_name, contextId: account.context_id, status: 'connected', secretRef: `server:${account.id}`, createdAt: Number(account.updated_at), updatedAt: Number(account.updated_at) })) }, headers);
        }
        if (req.method === 'PUT' && (url.pathname === '/vault' || url.pathname === '/api/vault')) {
          const input = await body(req);
          return json(res, 200, await writeVault(db, userId, Array.isArray(input.records) ? input.records as never[] : []), headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/read' || url.pathname === '/api/messages/read')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'gmail' || account.channel !== 'email') return json(res, 404, { error: 'conta Gmail não encontrada' }, headers);
          const messageIds = Array.isArray(input.messageIds) ? input.messageIds.map(String) : [];
          await markGmailMessagesRead(db, config, userId, accountId, messageIds, input.isRead !== false);
          return json(res, 200, { updated: messageIds.length }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/send' || url.pathname === '/api/messages/send')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'gmail' || account.channel !== 'email') return json(res, 404, { error: 'conta Gmail não encontrada' }, headers);
          const to = Array.isArray(input.to) ? input.to.map(String).filter(Boolean) : [];
          if (to.length === 0 || !String(input.body ?? '').trim()) return json(res, 400, { error: 'destinatário e corpo são obrigatórios' }, headers);
          await sendGmail(db, config, userId, accountId, { to, subject: input.subject ? String(input.subject) : undefined, body: String(input.body), inReplyTo: input.inReplyTo ? String(input.inReplyTo) : undefined });
          return json(res, 200, { sent: true }, headers);
        }
        const syncMatch = url.pathname.match(/^(?:\/api)?\/sync\/(gmail|google-chat)$/);
        if (req.method === 'POST' && syncMatch) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ context_id: string }>('SELECT context_id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          const result = syncMatch[1] === 'gmail' ? await fetchGmail(db, config, userId, accountId, account.context_id, input.cursor ? String(input.cursor) : undefined) : await fetchChat(db, config, userId, accountId, account.context_id);
          return json(res, 200, result, headers);
        }
        return json(res, 404, { error: 'rota não encontrada' }, headers);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'erro interno';
        return json(res, 500, { error: message }, headers);
      }
    },
    close: () => db.close()
  };
}

export function randomEncryptionKey(): string { return randomBytes(32).toString('base64'); }
