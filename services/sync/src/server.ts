import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SyncConfig } from './config.js';
import { decrypt, encrypt, hashToken, matchesPkceChallenge, opaqueToken } from './crypto.js';
import { openDb, type Db } from './db.js';
import { exchangeCode, getUser, revokeToken, SyncError } from './google.js';
import { body, cors, html, json, PayloadTooLargeError } from './http.js';
import { createChatReaction, fetchChat, fetchChatImage, fetchGmail, isValidEmailAddress, markChatSpaceRead, markChatThreadRead, markGmailMessagesRead, sendChat, sendChatToSpace, sendGmail, setGmailThreadStarred, type GmailAttachmentPayload } from './providers.js';
import { readVault, writeVault, type VaultRecord } from './vault.js';

export interface AppServer { handler(req: IncomingMessage, res: ServerResponse): Promise<void>; close(): Promise<void> }

export async function createAppServer(config: SyncConfig, database?: Db): Promise<AppServer> {
  const db = database ?? await openDb(config.databaseUrl);
  async function authenticated(req: IncomingMessage): Promise<string | undefined> {
    const token = sessionTokens(req)[0];
    if (!token) return undefined;
    const tokenHash = hashToken(token);
    const row = (await db.query<{ user_id: string; expires_at: string }>('SELECT user_id, expires_at FROM atmail_sessions WHERE token_hash = $1', [tokenHash])).rows[0];
    const expiresAt = Number(row?.expires_at);
    const now = Date.now();
    if (!row || !Number.isFinite(expiresAt) || expiresAt < now) return undefined;
    // Sessão deslizante: renova a validade apenas quando metade do prazo já passou.
    if (expiresAt - now < SESSION_TTL_MS / 2) {
      await db.query('UPDATE atmail_sessions SET expires_at = $1 WHERE token_hash = $2', [now + SESSION_TTL_MS, tokenHash]);
    }
    return row.user_id;
  }
  async function session(userId: string): Promise<{ token: string; cookie: string }> {
    const token = opaqueToken();
    const now = Date.now();
    await db.query('INSERT INTO atmail_sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [hashToken(token), userId, now, now + SESSION_TTL_MS]);
    return { token, cookie: sessionCookie(token) };
  }
  return {
    async handler(req, res) {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const headers = { ...cors(config.publicOrigins, requestOrigin), 'cache-control': 'no-store' };
      if (req.method === 'OPTIONS') return json(res, 204, null, headers);
      try {
        // Inicia um login e registra o `state` + `code_challenge` no servidor. O
        // exchange só aceita um state criado aqui, com o code e o verifier certos.
        if (req.method === 'POST' && (url.pathname === '/auth/google/start' || url.pathname === '/api/auth/google/start')) {
          if (!(await allow(db, 'login-start', clientAddress(req), LOGIN_START_LIMIT, LOGIN_START_WINDOW_MS))) {
            return json(res, 429, { error: 'muitas tentativas de login; tente novamente em alguns minutos' }, headers);
          }
          const input = await body(req);
          const codeChallenge = typeof input.codeChallenge === 'string' ? input.codeChallenge.trim() : '';
          if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) return json(res, 400, { error: 'code_challenge obrigatório' }, headers);
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
          await db.query('DELETE FROM atmail_login_attempts WHERE window_start < $1', [now - LOGIN_ATTEMPTS_RETENTION_MS]);
          await db.query('INSERT INTO atmail_oauth_pending (state, code, error, code_challenge, created_at) VALUES ($1, $2, $3, $4, $5)', [state, '', '', codeChallenge, now]);
          return json(res, 200, { state }, headers);
        }
        // Callback do Google: o app não pode receber `atmail://` (o Google exige HTTPS
        // para clients Web), então o backend guarda o `code` e o entrega no polling abaixo.
        if (req.method === 'GET' && (url.pathname === '/auth/google/callback' || url.pathname === '/api/auth/google/callback')) {
          const pageHeaders = htmlHeaders(headers);
          const state = (url.searchParams.get('state') ?? '').slice(0, 128);
          const authorizationCode = url.searchParams.get('code') ?? '';
          const authorizationError = url.searchParams.get('error') ?? '';
          if (state.length === 0) return html(res, 400, oauthPage('Não foi possível concluir', 'O Google não devolveu o identificador da sessão. Volte ao @mail e tente novamente.'), pageHeaders);
          // Sem o `state` pré-registrado, a requisição é descartada: esta rota é pública.
          const known = (await db.query<{ state: string }>('UPDATE atmail_oauth_pending SET code = $1, error = $2 WHERE state = $3 AND created_at > $4 RETURNING state', [authorizationCode, authorizationError, state, Date.now() - PENDING_TTL_MS])).rows;
          if (known.length === 0) return html(res, 400, oauthPage('Sessão de login expirada', 'Este login não foi iniciado pelo @mail ou já expirou. Volte ao app e tente novamente.'), pageHeaders);
          if (state.startsWith('tauri:')) {
            const title = authorizationCode.length === 0 ? 'Login não concluído' : 'Login concluído';
            return html(res, 200, oauthPage(title, 'Volte ao aplicativo @mail. Você pode fechar esta aba.', undefined, true), pageHeaders);
          }
          const returnUrl = oauthReturnUrl(state, config.webAppOrigin);
          if (authorizationCode.length === 0) return html(res, 200, oauthPage('Login não concluído', 'O Google recusou a autorização. Voltando ao @mail…', returnUrl), pageHeaders);
          return html(res, 200, oauthPage('Login concluído', 'Voltando ao @mail…', returnUrl), pageHeaders);
        }
        if (req.method === 'POST' && (url.pathname === '/auth/google/code' || url.pathname === '/api/auth/google/code')) {
          if (!(await allow(db, 'oauth-code', clientAddress(req), OAUTH_CODE_LIMIT, OAUTH_CODE_WINDOW_MS))) {
            return json(res, 429, { error: 'muitas consultas de login; tente novamente em alguns minutos' }, headers);
          }
          const input = await body(req);
          const state = String(input.state ?? '').slice(0, 128);
          if (state.length === 0) return json(res, 400, { error: 'state obrigatório' }, headers);
          // Entrega uma vez só, preservando o vínculo PKCE até o exchange consumir a linha.
          const pending = (await db.query<{ code: string; error: string }>("UPDATE atmail_oauth_pending SET code_delivered = TRUE WHERE state = $1 AND created_at > $2 AND code_delivered = FALSE AND (code <> '' OR error <> '') RETURNING code, error", [state, Date.now() - PENDING_TTL_MS])).rows[0];
          if (!pending) return json(res, 200, { pending: true }, headers);
          if (pending.error.length > 0) return json(res, 200, { error: pending.error }, headers);
          return json(res, 200, { code: pending.code }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/auth/google/exchange' || url.pathname === '/api/auth/google/exchange')) {
          if (!(await allow(db, 'oauth-exchange', clientAddress(req), OAUTH_EXCHANGE_LIMIT, OAUTH_EXCHANGE_WINDOW_MS))) {
            return json(res, 429, { error: 'muitas tentativas de login; tente novamente em alguns minutos' }, headers);
          }
          const input = await body(req);
          const state = String(input.state ?? '').trim().slice(0, 128);
          const code = String(input.code ?? '').trim();
          const codeVerifier = String(input.codeVerifier ?? '').trim();
          if (state.length === 0 || code.length === 0 || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
            return json(res, 400, { error: 'state, code e code_verifier são obrigatórios' }, headers);
          }
          // Troca atômica da linha pendente: só quem apresentar o state e o code
          // gravados pelo /start e pelo callback consome o login.
          const consumed = (await db.query<{ code_challenge: string }>(
            'DELETE FROM atmail_oauth_pending WHERE state = $1 AND code = $2 AND created_at > $3 RETURNING code_challenge',
            [state, code, Date.now() - PENDING_TTL_MS]
          )).rows[0];
          if (!consumed) return json(res, 400, { error: 'código de autorização inválido ou expirado' }, headers);
          if (!matchesPkceChallenge(codeVerifier, consumed.code_challenge)) return json(res, 400, { error: 'verificação PKCE falhou' }, headers);
          // redirectUri é sempre o do servidor: o cliente não escolhe o destino.
          const exchanged = await exchangeCode({ code, codeVerifier, redirectUri: config.redirectUri, clientId: config.clientId, clientSecret: config.clientSecret });
          const user = await getUser(exchanged.accessToken);
          if (user.email_verified === false) return json(res, 403, { error: 'a conta Google não tem e-mail verificado' }, headers);
          const now = Date.now();
          const accountId = `google:${user.sub}:gmail`;
          const chatAccountId = `google:${user.sub}:chat`;
          const encryptedRefresh = encrypt(exchanged.refreshToken ?? '', config.encryptionKey);
          await db.transaction(async (client) => {
            await client.query('INSERT INTO atmail_users (id, email, name, picture, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture', [user.sub, user.email, user.name ?? '', user.picture ?? '', now]);
            await client.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at WHERE atmail_credentials.user_id = excluded.user_id', [accountId, user.sub, 'gmail', user.email, encryptedRefresh, exchanged.scope, now]);
            await client.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO NOTHING', [accountId, user.sub, 'gmail', 'email', user.email, user.name ?? user.email, 'work', now]);
            await client.query('INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at WHERE atmail_credentials.user_id = excluded.user_id', [chatAccountId, user.sub, 'google-chat', user.email, encryptedRefresh, exchanged.scope, now]);
            await client.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO NOTHING', [chatAccountId, user.sub, 'google-chat', 'chat', user.email, `${user.name ?? user.email} · Chat`, 'work', now]);
          });
          const created = await session(user.sub);
          return json(res, 200, { sessionToken: created.token, user }, { ...headers, 'set-cookie': created.cookie });
        }
        const userId = await authenticated(req);
        if (!userId) return json(res, 401, { error: 'não autenticado' }, headers);
        if (req.method === 'POST' && (url.pathname === '/auth/google/add' || url.pathname === '/api/auth/google/add')) {
          const input = await body(req);
          const state = String(input.state ?? '').trim().slice(0, 128);
          const code = String(input.code ?? '').trim();
          const codeVerifier = String(input.codeVerifier ?? '').trim();
          const targetAccountId = typeof input.accountId === 'string' ? input.accountId : undefined;
          if (!state || !code || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return json(res, 400, { error: 'state, code e code_verifier são obrigatórios' }, headers);
          const consumed = (await db.query<{ code_challenge: string }>(
            'DELETE FROM atmail_oauth_pending WHERE state = $1 AND code = $2 AND created_at > $3 RETURNING code_challenge',
            [state, code, Date.now() - PENDING_TTL_MS]
          )).rows[0];
          if (!consumed || !matchesPkceChallenge(codeVerifier, consumed.code_challenge)) return json(res, 400, { error: 'login inválido ou expirado' }, headers);
          if (targetAccountId) {
            const owned = (await db.query<{ id: string }>('SELECT id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [targetAccountId, userId])).rows[0];
            if (!owned) return json(res, 404, { error: 'conta não encontrada' }, headers);
          }
          const exchanged = await exchangeCode({ code, codeVerifier: codeVerifier || undefined, redirectUri: config.redirectUri, clientId: config.clientId, clientSecret: config.clientSecret });
          const user = await getUser(exchanged.accessToken);
          if (targetAccountId && targetAccountId !== `google:${user.sub}:gmail` && targetAccountId !== `google:${user.sub}:chat`) {
            return json(res, 409, { error: 'Selecione a conta Google que precisa ser reconectada.' }, headers);
          }
          if (!exchanged.refreshToken) return json(res, 400, { error: 'O Google não forneceu autorização para sincronização. Tente novamente.' }, headers);
          const now = Date.now();
          const accountId = `google:${user.sub}:gmail`;
          const chatAccountId = `google:${user.sub}:chat`;
          const encryptedRefresh = encrypt(exchanged.refreshToken ?? '', config.encryptionKey);
          await db.transaction(async (client) => {
            // Só atualiza a credencial se ela já pertencer ao usuário atual: uma
            // conta Google de outro usuário nunca é transferida silenciosamente.
            const savedEmail = (await client.query<{ account_id: string }>(
              'INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at WHERE atmail_credentials.user_id = excluded.user_id RETURNING account_id',
              [accountId, userId, 'gmail', user.email, encryptedRefresh, exchanged.scope, now]
            )).rows;
            if (savedEmail.length === 0) throw new ConflictError('esta conta Google já está conectada a outro usuário');
            const savedChat = (await client.query<{ account_id: string }>(
              'INSERT INTO atmail_credentials (account_id, user_id, provider, email, encrypted_refresh_token, scopes, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(account_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, scopes=excluded.scopes, updated_at=excluded.updated_at WHERE atmail_credentials.user_id = excluded.user_id RETURNING account_id',
              [chatAccountId, userId, 'google-chat', user.email, encryptedRefresh, exchanged.scope, now]
            )).rows;
            if (savedChat.length === 0) throw new ConflictError('esta conta Google já está conectada a outro usuário');
            await client.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at WHERE atmail_accounts.user_id = excluded.user_id', [accountId, userId, 'gmail', 'email', user.email, user.name ?? user.email, 'work', now]);
            await client.query('INSERT INTO atmail_accounts (id, user_id, provider, channel, email, display_name, context_id, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT(id) DO UPDATE SET email=excluded.email, display_name=excluded.display_name, updated_at=excluded.updated_at WHERE atmail_accounts.user_id = excluded.user_id', [chatAccountId, userId, 'google-chat', 'chat', user.email, `${user.name ?? user.email} · Chat`, 'work', now]);
          });
          return json(res, 200, { added: true }, headers);
        }
        if (req.method === 'DELETE' && (url.pathname === '/auth/session' || url.pathname === '/api/auth/session')) {
          for (const token of sessionTokens(req)) {
            await db.query('DELETE FROM atmail_sessions WHERE token_hash = $1', [hashToken(token)]);
          }
          return json(res, 200, { signedOut: true }, { ...headers, 'set-cookie': clearSessionCookie() });
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
        if (req.method === 'POST' && (url.pathname === '/accounts/notifications' || url.pathname === '/api/accounts/notifications')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          if (!accountId || typeof input.enabled !== 'boolean') return json(res, 400, { error: 'conta e preferência são obrigatórias' }, headers);
          const account = (await db.query<{ id: string }>('SELECT id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          await db.query('INSERT INTO atmail_notification_preferences (user_id, account_id, enabled, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT(user_id, account_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at', [userId, accountId, input.enabled, Date.now()]);
          return json(res, 200, { updated: true }, headers);
        }
        const accountMatch = url.pathname.match(/^(?:\/api)?\/accounts\/([^/]+)$/);
        if (req.method === 'DELETE' && accountMatch) {
          const accountId = decodeURIComponent(accountMatch[1] ?? '');
          const account = (await db.query<{ id: string }>('SELECT id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          await revokeGoogleGrantIfLast(db, config, userId, accountId);
          await db.transaction(async (client) => {
            await client.query('DELETE FROM atmail_notification_preferences WHERE user_id = $1 AND account_id = $2', [userId, accountId]);
            await client.query('DELETE FROM atmail_credentials WHERE user_id = $1 AND account_id = $2', [userId, accountId]);
            await client.query('DELETE FROM atmail_accounts WHERE user_id = $1 AND id = $2', [userId, accountId]);
          });
          return json(res, 200, { removed: true }, headers);
        }
        if (req.method === 'GET' && (url.pathname === '/vault' || url.pathname === '/api/vault')) return json(res, 200, await readVault(db, userId, Number(url.searchParams.get('since') ?? 0)), headers);
        if (req.method === 'GET' && (url.pathname === '/accounts' || url.pathname === '/api/accounts')) {
          const accounts = (await db.query<{ id: string; provider: string; channel: string; email: string; display_name: string; context_id: string; updated_at: string; notifications_enabled: boolean }>('SELECT A.id, A.provider, A.channel, A.email, A.display_name, A.context_id, A.updated_at, COALESCE(P.enabled, TRUE) AS notifications_enabled FROM atmail_accounts A LEFT JOIN atmail_notification_preferences P ON P.account_id = A.id AND P.user_id = A.user_id WHERE A.user_id = $1 ORDER BY A.updated_at', [userId])).rows;
          return json(res, 200, { accounts: accounts.map((account) => ({ id: account.id, provider: account.provider, channel: account.channel, transport: 'oauth2-google', email: account.email, displayName: account.display_name, contextId: account.context_id, status: 'connected', notificationsEnabled: account.notifications_enabled, secretRef: `server:${account.id}`, createdAt: Number(account.updated_at), updatedAt: Number(account.updated_at) })) }, headers);
        }
        if (req.method === 'PUT' && (url.pathname === '/vault' || url.pathname === '/api/vault')) {
          const input = await body(req);
          const records = Array.isArray(input.records) ? input.records : [];
          if (records.length > MAX_VAULT_RECORDS) return json(res, 413, { error: `máximo de ${MAX_VAULT_RECORDS} registros por envio` }, headers);
          const validated: VaultRecord[] = [];
          for (const raw of records) {
            if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return json(res, 400, { error: 'registro do vault inválido' }, headers);
            const record = raw as Record<string, unknown>;
            const kind = typeof record.kind === 'string' ? record.kind : '';
            const id = typeof record.id === 'string' ? record.id : '';
            const updatedAt = Number(record.updatedAt);
            if (kind.length === 0 || kind.length > MAX_VAULT_KIND_LENGTH || id.length === 0 || id.length > MAX_VAULT_ID_LENGTH || !Number.isFinite(updatedAt)) {
              return json(res, 400, { error: 'kind, id ou updatedAt inválidos' }, headers);
            }
            const payloadJson = JSON.stringify(record.payload ?? null) ?? 'null';
            if (Buffer.byteLength(payloadJson, 'utf8') > MAX_VAULT_PAYLOAD_BYTES) return json(res, 413, { error: 'payload do vault excede 256 KB' }, headers);
            validated.push({ kind, id, updatedAt, deleted: record.deleted === true, payload: JSON.parse(payloadJson) });
          }
          return json(res, 200, await writeVault(db, userId, validated), headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/star' || url.pathname === '/api/messages/star')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const threadId = typeof input.threadId === 'string' ? input.threadId : '';
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(threadId) || typeof input.isStarred !== 'boolean') {
            return json(res, 400, { error: 'conversa ou preferência inválida' }, headers);
          }
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'gmail' || account.channel !== 'email') return json(res, 404, { error: 'conta Gmail não encontrada' }, headers);
          await setGmailThreadStarred(db, config, userId, accountId, threadId, input.isStarred);
          return json(res, 200, { updated: true }, headers);
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
        if (req.method === 'POST' && (url.pathname === '/messages/read-chat' || url.pathname === '/api/messages/read-chat')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'google-chat' || account.channel !== 'chat') return json(res, 404, { error: 'conta Google Chat não encontrada' }, headers);
          const spaceName = String(input.spaceId ?? '');
          const threadName = String(input.threadName ?? '').trim() || undefined;
          const lastReadTime = Number(input.lastReadTime);
          if (!/^spaces\/[A-Za-z0-9._-]+$/.test(spaceName) || (threadName !== undefined && !new RegExp(`^${spaceName}/threads/[A-Za-z0-9._-]+$`).test(threadName)) || !Number.isFinite(lastReadTime) || lastReadTime < 0) {
            return json(res, 400, { error: 'espaço e horário de leitura inválidos' }, headers);
          }
          if (threadName) await markChatThreadRead(db, config, userId, accountId, spaceName, threadName, lastReadTime);
          else await markChatSpaceRead(db, config, userId, accountId, spaceName, lastReadTime);
          return json(res, 200, { updated: true }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/send' || url.pathname === '/api/messages/send')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'gmail' || account.channel !== 'email') return json(res, 404, { error: 'conta Gmail não encontrada' }, headers);
          const to = Array.isArray(input.to) ? input.to.map((value) => String(value).trim()).filter(Boolean) : [];
          if (to.length === 0 || to.length > MAX_EMAIL_RECIPIENTS || to.some((address) => /[\r\n]/.test(address) || !isValidEmailAddress(address))) {
            return json(res, 400, { error: 'destinatário inválido' }, headers);
          }
          const inReplyTo = input.inReplyTo === undefined ? undefined : String(input.inReplyTo).trim();
          if (inReplyTo !== undefined && !/^<?[^<>\r\n]{1,320}>?$/.test(inReplyTo)) return json(res, 400, { error: 'In-Reply-To inválido' }, headers);
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
            if (!fileName || /[\r\n]/.test(fileName) || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
              return json(res, 400, { error: 'metadados ou conteúdo de anexo inválidos' }, headers);
            }
            if (base64.length > Math.ceil(MAX_EMAIL_ATTACHMENT_BYTES * 4 / 3) + 4) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            const sizeInBytes = Buffer.from(base64, 'base64').length;
            totalAttachmentBytes += sizeInBytes;
            if (totalAttachmentBytes > MAX_EMAIL_ATTACHMENT_BYTES) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            attachments.push({ fileName, mimeType, base64 });
          }
          const bodyText = String(input.body ?? '');
          const bodyHtml = typeof input.bodyHtml === 'string' ? input.bodyHtml : undefined;
          if (!bodyText.trim() && attachments.length === 0) return json(res, 400, { error: 'corpo ou anexo são obrigatórios' }, headers);
          const providerThreadId = typeof input.providerThreadId === 'string' ? input.providerThreadId : undefined;
          if (providerThreadId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(providerThreadId)) {
            return json(res, 400, { error: 'thread de e-mail inválida' }, headers);
          }
          const receipt = await sendGmail(db, config, userId, accountId, { to, subject: input.subject ? String(input.subject) : undefined, body: bodyText, bodyHtml, inReplyTo, providerThreadId, attachments });
          return json(res, 200, { sent: true, ...receipt }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/send-chat' || url.pathname === '/api/messages/send-chat')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'google-chat' || account.channel !== 'chat') return json(res, 404, { error: 'conta Google Chat não encontrada' }, headers);
          const message = String(input.body ?? '').trim();
          const rawAttachments = Array.isArray(input.attachments) ? input.attachments : [];
          if (rawAttachments.length > MAX_EMAIL_ATTACHMENTS) return json(res, 413, { error: 'máximo de 10 anexos por mensagem' }, headers);
          const attachments: GmailAttachmentPayload[] = [];
          let totalAttachmentBytes = 0;
          for (const rawAttachment of rawAttachments) {
            if (rawAttachment === null || typeof rawAttachment !== 'object') return json(res, 400, { error: 'anexo inválido' }, headers);
            const attachment = rawAttachment as Record<string, unknown>;
            const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : '';
            const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
            const base64 = typeof attachment.base64 === 'string' ? attachment.base64 : '';
            if (!fileName || /[\r\n]/.test(fileName) || !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(mimeType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return json(res, 400, { error: 'anexo inválido' }, headers);
            if (base64.length > Math.ceil(MAX_EMAIL_ATTACHMENT_BYTES * 4 / 3) + 4) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            totalAttachmentBytes += Buffer.from(base64, 'base64').length;
            if (totalAttachmentBytes > MAX_EMAIL_ATTACHMENT_BYTES) return json(res, 413, { error: 'tamanho total dos anexos excede 3 MB' }, headers);
            attachments.push({ fileName, mimeType, base64 });
          }
          if (message.length === 0 && attachments.length === 0) return json(res, 400, { error: 'mensagem ou anexo é obrigatório' }, headers);
          const spaceName = String(input.spaceId ?? '').trim();
          if (spaceName) {
            const threadName = String(input.threadName ?? '').trim() || undefined;
            if (!/^spaces\/[A-Za-z0-9._-]+$/.test(spaceName) || (threadName !== undefined && !/^spaces\/[A-Za-z0-9._-]+\/threads\/[A-Za-z0-9._-]+$/.test(threadName))) {
              return json(res, 400, { error: 'espaço ou thread inválidos' }, headers);
            }
            const receipt = await sendChatToSpace(db, config, userId, accountId, { spaceName, threadName, body: message, attachments });
            return json(res, 200, { sent: true, ...receipt }, headers);
          }
          const recipient = String(input.recipient ?? '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json(res, 400, { error: 'destinatário válido é obrigatório' }, headers);
          const receipt = await sendChat(db, config, userId, accountId, { recipient, body: message, attachments });
          return json(res, 200, { sent: true, ...receipt }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/react-chat' || url.pathname === '/api/messages/react-chat')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ provider: string; channel: string }>('SELECT provider, channel FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account || account.provider !== 'google-chat' || account.channel !== 'chat') return json(res, 404, { error: 'conta Google Chat não encontrada' }, headers);
          const messageId = String(input.messageId ?? '');
          const prefix = `chat:${accountId}:`;
          const messageName = messageId.startsWith(prefix) ? messageId.slice(prefix.length) : '';
          const emoji = String(input.emoji ?? '').trim();
          if (!/^spaces\/[A-Za-z0-9._-]+\/messages\/[A-Za-z0-9._-]+$/.test(messageName) || Array.from(emoji).length === 0 || Array.from(emoji).length > 8) {
            return json(res, 400, { error: 'mensagem ou emoji inválidos' }, headers);
          }
          await createChatReaction(db, config, userId, accountId, { messageName, emoji, remove: input.remove === true });
          return json(res, 200, { reacted: true }, headers);
        }
        if (req.method === 'POST' && (url.pathname === '/messages/chat-image' || url.pathname === '/api/messages/chat-image')) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const attachmentName = String(input.attachmentName ?? '');
          if (!/^spaces\/[A-Za-z0-9._-]+\/messages\/[A-Za-z0-9._-]+\/attachments\/[A-Za-z0-9._-]+$/.test(attachmentName)) return json(res, 400, { error: 'anexo inválido' }, headers);
          const account = (await db.query<{ id: string }>('SELECT id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          const image = await fetchChatImage(db, config, userId, accountId, attachmentName);
          return json(res, 200, image, headers);
        }
        const syncMatch = url.pathname.match(/^(?:\/api)?\/sync\/(gmail|google-chat)$/);
        if (req.method === 'POST' && syncMatch) {
          const input = await body(req);
          const accountId = String(input.accountId ?? '');
          const account = (await db.query<{ context_id: string }>('SELECT context_id FROM atmail_accounts WHERE id = $1 AND user_id = $2', [accountId, userId])).rows[0];
          if (!account) return json(res, 404, { error: 'conta não encontrada' }, headers);
          const cursor = typeof input.cursor === 'string' ? input.cursor : undefined;
          const spaceId = typeof input.spaceId === 'string' ? input.spaceId : undefined;
          if (spaceId !== undefined && !/^spaces\/[A-Za-z0-9._-]+$/.test(spaceId)) {
            return json(res, 400, { error: 'espaço inválido' }, headers);
          }
          const result = syncMatch[1] === 'gmail'
            ? await fetchGmail(db, config, userId, accountId, account.context_id, cursor)
            : await fetchChat(db, config, userId, accountId, account.context_id, { cursor, spaceId });
          return json(res, 200, result, headers);
        }
        return json(res, 404, { error: 'rota não encontrada' }, headers);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'erro interno';
        const upstreamStatus = (error as Error & { status?: number }).status;
        if (error instanceof PayloadTooLargeError) return json(res, 413, { error: 'corpo da requisição muito grande' }, headers);
        if (error instanceof SyntaxError) return json(res, 400, { error: 'corpo JSON inválido' }, headers);
        if (error instanceof ConflictError) return json(res, 409, { error: error.message }, headers);
        if ((error instanceof SyncError && error.kind === 'auth') || upstreamStatus === 401 || (upstreamStatus === 403 && /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|invalidCredentials|authError/i.test(detail))) {
          return json(res, 401, { error: 'A autorização da conta Google expirou. Faça login novamente.', errorCode: 'GOOGLE_AUTH_REVOKED' }, headers);
        }
        if (upstreamStatus === 404 && detail.includes('Google Chat app not found')) {
          return json(res, 409, { error: 'Não há um DM existente para este destinatário. Para criar um novo, habilite a API Chat e configure o app Chat no Google Cloud.' }, headers);
        }
        // Detalhes de SQL, do Google e de criptografia ficam no log do servidor.
        console.error('[sync] erro interno:', detail);
        return json(res, 500, { error: 'erro interno' }, headers);
      }
    },
    close: () => db.close()
  };
}

class ConflictError extends Error {}

export function randomEncryptionKey(): string { return randomBytes(32).toString('base64'); }

/** Quanto tempo um login iniciado continua válido para o callback do Google. */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** Validade absoluta de uma sessão; renovada a cada uso depois de metade do prazo. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_START_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_START_LIMIT = 30;
const OAUTH_CODE_WINDOW_MS = 10 * 60 * 1000;
const OAUTH_CODE_LIMIT = 600;
const OAUTH_EXCHANGE_WINDOW_MS = 10 * 60 * 1000;
const OAUTH_EXCHANGE_LIMIT = 60;
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_RECIPIENTS = 50;
const MAX_EMAIL_ATTACHMENTS = 10;
const MAX_EMAIL_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_VAULT_RECORDS = 200;
const MAX_VAULT_KIND_LENGTH = 64;
const MAX_VAULT_ID_LENGTH = 128;
const MAX_VAULT_PAYLOAD_BYTES = 256 * 1024;

/**
 * Endereço do cliente a partir do hop gravado pelo proxy confiável. O primeiro
 * elemento de X-Forwarded-For é controlado pelo cliente, então só o último hop
 * (anexado pela borda) serve como chave de rate limit.
 */
function clientAddress(req: IncomingMessage): string {
  const vercel = headerValue(req.headers['x-vercel-forwarded-for']);
  if (vercel) return lastHop(vercel);
  const realIp = headerValue(req.headers['x-real-ip']);
  if (realIp) return realIp;
  const forwarded = headerValue(req.headers['x-forwarded-for']);
  if (forwarded) return lastHop(forwarded);
  return req.socket?.remoteAddress ?? 'desconhecido';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value.join(',') : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function lastHop(chain: string): string {
  const hops = chain.split(',').map((hop) => hop.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? 'desconhecido';
}

/**
 * Rate limit por janela fixa, persistido no banco: sobrevive a reinícios e não é
 * zerado por quem estourar a memória da instância.
 */
async function allow(db: Db, bucket: string, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = (await db.query<{ count: string | number }>(
    `INSERT INTO atmail_login_attempts (bucket, key, window_start, count) VALUES ($1, $2, $3, 1)
     ON CONFLICT (bucket, key) DO UPDATE SET
       count = CASE WHEN atmail_login_attempts.window_start = EXCLUDED.window_start THEN atmail_login_attempts.count + 1 ELSE 1 END,
       window_start = EXCLUDED.window_start
     RETURNING count`,
    [bucket, key, windowStart]
  )).rows[0];
  return Number(row?.count ?? 1) <= limit;
}

function sessionTokens(req: IncomingMessage): string[] {
  const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : '';
  const cookie = req.headers.cookie?.match(/(?:^|; )atmail_session=([^;]+)/)?.[1] ?? '';
  return [...new Set([bearer, decodeURIComponent(cookie)].filter((token) => token.length > 0))];
}

function sessionCookie(token: string): string {
  return `atmail_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

function clearSessionCookie(): string {
  return 'atmail_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

/** Revoga o grant no Google quando a última credencial daquela conta Google sai. */
async function revokeGoogleGrantIfLast(db: Db, config: SyncConfig, userId: string, accountId: string): Promise<void> {
  const sub = accountId.split(':')[1];
  if (!sub) return;
  const siblings = (await db.query<{ account_id: string }>(
    "SELECT account_id FROM atmail_credentials WHERE user_id = $1 AND account_id <> $2 AND account_id LIKE ('google:' || $3 || ':%')",
    [userId, accountId, sub]
  )).rows;
  if (siblings.length > 0) return;
  const credential = (await db.query<{ encrypted_refresh_token: string }>(
    'SELECT encrypted_refresh_token FROM atmail_credentials WHERE account_id = $1 AND user_id = $2',
    [accountId, userId]
  )).rows[0];
  if (!credential) return;
  try {
    await revokeToken(decrypt(credential.encrypted_refresh_token, config.encryptionKey));
  } catch (error) {
    // A revogação é best-effort: a conta local precisa sair mesmo se o Google falhar.
    console.error('[sync] falha ao revogar grant Google:', error instanceof Error ? error.message : 'erro');
  }
}

function htmlHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  };
}

/** Página mostrada no navegador depois do consentimento do Google. */
function oauthReturnUrl(state: string, webAppOrigin: string): string | undefined {
  const separator = state.indexOf(':');
  if (separator < 0) return undefined;
  const platform = state.slice(0, separator);
  if (platform === 'web-legacy') return 'https://at-mail-web.vercel.app/';
  if (platform === 'web') return `${webAppOrigin.replace(/\/+$/, '')}/`;
  if (platform === 'android' || platform === 'ios') {
    return `atmail://auth/google/callback?state=${encodeURIComponent(state)}`;
  }
  return undefined;
}

function oauthPage(title: string, message: string, returnUrl?: string, closeWindow = false): string {
  const returnLink = returnUrl === undefined ? '' : `<p><a href="${returnUrl}">Continuar no @mail</a></p>`;
  const returnScript = closeWindow ? '<script>window.close();</script>' : returnUrl === undefined ? '' : `<script>window.location.replace(${JSON.stringify(returnUrl)});</script>`;
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
