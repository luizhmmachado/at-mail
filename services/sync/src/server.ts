import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncConfig } from './config.js';
import { encrypt, hashToken, opaqueToken } from './crypto.js';
import { openDb, type Db } from './db.js';
import { exchangeCode, getUser } from './google.js';
import { body, cors, html, json } from './http.js';
import { fetchChat, fetchGmail, markGmailMessagesRead, sendChat, sendGmail, type GmailAttachmentPayload } from './providers.js';
import { readVault, writeVault } from './vault.js';

export interface AppServer { handler(req: IncomingMessage, res: ServerResponse): Promise<void>; close(): Promise<void> }

export async function createAppServer(config: SyncConfig, database?: Db): Promise<AppServer> {
  const db = database ?? await openDb(config.databaseUrl);
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
      const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const headers = { ...cors(config.publicOrigins, requestOrigin), 'cache-control': 'no-store' };
      if (req.method === 'OPTIONS') return json(res, 204, null, headers);
      try {
        // Inicia um login e registra o `state` no servidor. O callback só aceita
        // states criados aqui, então esta rota pública não grava nada arbitrário.
        if (req.method === 'POST' && (url.pathname === '/auth/google/start' || url.pathname === '/api/auth/google/start')) {
          if (!allowLoginStart(clientAddress(req))) return json(res, 429, { error: 'muitas tentativas de login; tente novamente em alguns minutos' }, headers);
          const requestedPlatform = url.searchParams.get('platform');
          const platform = requestOrigin === 'https://at-mail-web.vercel.app'
            ? 'web-legacy'
            : requestedPlatform === 'web' || requestedPlatform === 'web-legacy' || requestedPlatform === 'android' || requestedPlatform === 'ios' || requestedPlatform === 'tauri'
              ? requestedPlatform
            : requestOrigin === 'tauri://localhost'
              ? 'tauri'
              : requestOrigin === undefined
                ? 'android'
                : 'web';
          const state = `${platform}:${opaqueToken()}`;
          const now = Date.now();
          await db.query('DELETE FROM atmail_oauth_pending WHERE created_at < $1', [now - PENDING_TTL_MS]);
          await db.query('INSERT INTO atmail_oauth_pending (state, code, error, created_at) VALUES ($1, $2, $3, $4)', [state, '', '', now]);
          return json(res, 200, { state }, headers);
        }
        // Callback do Google: o app não pode receber `atmail://` (o Google exige HTTPS
        // para clients Web), então o backend guarda o `code` e o entrega no polling abaixo.
        if (req.method === 'GET' && (url.pathname === '/auth/google/callback' || url.pathname === '/api/auth/google/callback')) {
          const state = (url.searchParams.get('state') ?? '').slice(0, 128);
          const authorizationCode = url.searchParams.get('code') ?? '';
          const authorizationError = url.searchParams.get('error') ?? '';
          if (state.length === 0) return html(res, 400, oauthPage('Não foi possível concluir', 'O Google não devolveu o identificador da sessão. Volte ao @mail e tente novamente.'), headers);
          // Sem o `state` pré-registrado, a requisição é descartada: esta rota é pública.
          const known = (await db.query<{ state: string }>('UPDATE atmail_oauth_pending SET code = $1, error = $2 WHERE state = $3 AND created_at > $4 RETURNING state', [authorizationCode, authorizationError, state, Date.now() - PENDING_TTL_MS])).rows;
          if (known.length === 0) return html(res, 400, oauthPage('Sessão de login expirada', 'Este login não foi iniciado pelo @mail ou já expirou. Volte ao app e tente novamente.'), headers);
          const returnUrl = oauthReturnUrl(state, config.webAppOrigin);
          if (authorizationCode.length === 0) return html(res, 200, oauthPage('Login não concluído', 'O Google recusou a autorização. Voltando ao @mail…', returnUrl), headers);
          return html(res, 200, oauthPage('Login concluído', 'Voltando ao @mail…', returnUrl), headers);
        }
        if (req.method === 'GET' && (url.pathname === '/auth/google/code' || url.pathname === '/api/auth/google/code')) {
          const state = (url.searchParams.get('state') ?? '').slice(0, 128);
          if (state.length === 0) return json(res, 400, { error: 'state obrigatório' }, headers);
          const pending = (await db.query<{ code: string; error: string }>("SELECT code, error FROM atmail_oauth_pending WHERE state = $1 AND created_at > $2 AND (code <> '' OR error <> '')", [state, Date.now() - PENDING_TTL_MS])).rows[0];
          if (!pending) return json(res, 200, { pending: true }, headers);
          await db.query('DELETE FROM atmail_oauth_pending WHERE state = $1', [state]);
          if (pending.error.length > 0) return json(res, 200, { error: pending.error }, headers);
          return json(res, 200, { code: pending.code }, headers);
        }
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
        if (req.method === 'POST' && (url.pathname === '/accounts/context' || url.pathname === '/api/accounts/context')) {
          const input = await body(req);
          const accountIds = Array.isArray(input.accountIds) ? [...new Set(input.accountIds.map(String).filter(Boolean))] : [];
          const contextId = String(input.contextId ?? '');
          if (accountIds.length === 0 || accountIds.length > 10 || !['work', 'studies', 'personal'].includes(contextId)) {
            return json(res, 400, { error: 'contas e contexto válido são obrigatórios' }, headers);
          }
          const ownedAccounts = (await db.query<{ id: string }>(
            'SELECT id FROM atmail_accounts WHERE id = ANY($1::text[]) AND user_id = $2',
            [accountIds, userId]
          )).rows;
          if (ownedAccounts.length !== accountIds.length) return json(res, 404, { error: 'uma ou mais contas não foram encontradas' }, headers);
          const updated = (await db.query<{ id: string }>(
            'UPDATE atmail_accounts SET context_id = $1, updated_at = $2 WHERE id = ANY($3::text[]) AND user_id = $4 RETURNING id',
            [contextId, Date.now(), accountIds, userId]
          )).rows;
          if (updated.length !== accountIds.length) return json(res, 404, { error: 'uma ou mais contas não foram encontradas' }, headers);
          return json(res, 200, { updated: updated.length }, headers);
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
          const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];
          if (rawAttachments.length > MAX_EMAIL_ATTACHMENTS) return json(res, 413, { error: `máximo de ${MAX_EMAIL_ATTACHMENTS} anexos por e-mail` }, headers);
          const attachments: GmailAttachmentPayload[] = [];
          let totalAttachmentBytes = 0;
          for (const rawAttachment of rawAttachments) {
            if (rawAttachment === null || typeof rawAttachment !== 'object') return json(res, 400, { error: 'anexo inválido' }, headers);
            const attachment = rawAttachment as Record<string, unknown>;
            const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : '';
            const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
            const base64 = typeof attachment.base64 === 'string' ? attachment.base64 : '';
            if (!fileName || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
              return json(res, 400, { error: 'metadados ou conteúdo de anexo inválidos' }, headers);
            }
            if (base64.length > Math.ceil(MAX_EMAIL_ATTACHMENT_BYTES * 4 / 3) + 4) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            const sizeInBytes = Buffer.from(base64, 'base64').length;
            totalAttachmentBytes += sizeInBytes;
            if (totalAttachmentBytes > MAX_EMAIL_ATTACHMENT_BYTES) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            attachments.push({ fileName, mimeType, base64 });
          }
          const bodyText = String(input.body ?? '');
          if (to.length === 0 || (!bodyText.trim() && attachments.length === 0)) return json(res, 400, { error: 'destinatário e corpo ou anexo são obrigatórios' }, headers);
          await sendGmail(db, config, userId, accountId, { to, subject: input.subject ? String(input.subject) : undefined, body: bodyText, inReplyTo: input.inReplyTo ? String(input.inReplyTo) : undefined, attachments });
          return json(res, 200, { sent: true }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/send-chat' || url.pathname === '/api/messages/send-chat')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'google-chat' || account.channel !== 'chat') return json(res, 404, { error: 'conta Google Chat não encontrada' }, headers);
          const recipient = String(input.recipient ?? '').trim();
          const message = String(input.body ?? '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || message.length === 0) {
            return json(res, 400, { error: 'destinatário válido e mensagem são obrigatórios' }, headers);
          }
          await sendChat(db, config, userId, accountId, { recipient, body: message });
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

/** Quanto tempo um login iniciado continua válido para o callback do Google. */
const PENDING_TTL_MS = 10 * 60 * 1000;
const LOGIN_START_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_START_LIMIT = 30;
const MAX_EMAIL_ATTACHMENTS = 10;
const MAX_EMAIL_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const loginStartAttempts = new Map<string, number[]>();

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket?.remoteAddress || 'desconhecido';
}

/**
 * Limite best-effort por instância para o início de logins. Não substitui um
 * rate limiter distribuído, mas evita que a rota pública seja usada para encher
 * a tabela de logins pendentes com um único endereço.
 */
function allowLoginStart(address: string, now = Date.now()): boolean {
  const recent = (loginStartAttempts.get(address) ?? []).filter((at) => now - at < LOGIN_START_WINDOW_MS);
  if (recent.length >= LOGIN_START_LIMIT) {
    loginStartAttempts.set(address, recent);
    return false;
  }
  recent.push(now);
  loginStartAttempts.set(address, recent);
  if (loginStartAttempts.size > 5000) loginStartAttempts.clear();
  return true;
}

/** Página mostrada no navegador depois do consentimento do Google. */
function oauthReturnUrl(state: string, webAppOrigin: string): string | undefined {
  const separator = state.indexOf(':');
  if (separator < 0) return undefined;
  const platform = state.slice(0, separator);
  if (platform === 'web-legacy') return 'https://at-mail-web.vercel.app/';
  if (platform === 'web' || platform === 'tauri') return `${webAppOrigin.replace(/\/+$/, '')}/`;
  if (platform === 'android' || platform === 'ios') {
    return `atmail://auth/google/callback?state=${encodeURIComponent(state)}`;
  }
  return undefined;
}

function oauthPage(title: string, message: string, returnUrl?: string): string {
  const returnLink = returnUrl === undefined ? '' : `<p><a href="${returnUrl}">Continuar no @mail</a></p>`;
  const returnScript = returnUrl === undefined ? '' : `<script>window.location.replace(${JSON.stringify(returnUrl)});</script>`;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>@mail · ${title}</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #FBFBFA; color: #1A1A19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; }
      main { max-width: 380px; padding: 32px; text-align: center; }
      span { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #61615C; }
      h1 { margin: 12px 0 8px; font-size: 22px; font-weight: 600; }
      p { margin: 0; font-size: 15px; line-height: 1.5; color: #61615C; }
      @media (prefers-color-scheme: dark) { body { background: #111110; color: #F5F5F2; } p, span { color: #A6A6A0; } }
    </style>
  </head>
  <body>
    <main>
      <span>@mail</span>
      <h1>${title}</h1>
      <p>${message}</p>
      ${returnLink}
    </main>
    ${returnScript}
  </body>
</html>`;
}
