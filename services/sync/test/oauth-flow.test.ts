import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { SyncConfig } from '../src/config';
import { hashToken } from '../src/crypto';
import { serverlessDatabaseUrl } from '../src/db';
import type { Db } from '../src/db';
import { chatDirectMessageUrl, chatMessagesUrl, chatReactionRequest, chatReplyRequest, chatSpaceReadStateRequest, chatSpaceReadStateUrl, createDirectMessageSetupRequest, createGmailRawMessage, extractGmailBodies, gmailAddedMessageIds, gmailHistoryUrl, gmailMessagesUrl, isChatMessageRead, resolveChatSpaceName } from '../src/providers';
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
  publicOrigins: ['http://localhost:8081', 'https://at-mail.vercel.app', 'http://tauri.localhost', 'tauri://localhost'],
  webAppOrigin: 'https://at-mail.vercel.app'
};

describe('nome de espaços do Google Chat', () => {
  it('localiza uma conversa direta existente pelo e-mail', () => {
    const url = new URL(chatDirectMessageUrl('pessoa@example.com'));
    assert.equal(url.pathname, '/v1/spaces:findDirectMessage');
    assert.equal(url.searchParams.get('name'), 'users/pessoa@example.com');
  });

  it('responde no espaço/thread existente e cria reações com emoji Unicode', () => {
    assert.deepEqual(chatReplyRequest('Olá', 'spaces/space-1/threads/thread-1'), {
      text: 'Olá',
      thread: { name: 'spaces/space-1/threads/thread-1' }
    });
    assert.deepEqual(chatReactionRequest('👍'), { emoji: { unicode: '👍' } });
  });

  it('constrói o read-state do Google Chat no caminho users/me', () => {
    const url = chatSpaceReadStateUrl('spaces/space-1');
    assert.equal(url, 'https://chat.googleapis.com/v1/users/me/spaces/space-1/spaceReadState');
    assert.deepEqual(chatSpaceReadStateRequest('spaces/space-1', 1_700_000_000_000), {
      name: 'users/me/spaces/space-1/spaceReadState',
      lastReadTime: new Date(1_700_000_000_000).toISOString()
    });
    assert.equal(isChatMessageRead(1_699_999_999_000, 1_700_000_000_000, true), true);
    assert.equal(isChatMessageRead(1_700_000_001_000, 1_700_000_000_000, true), false);
    assert.equal(isChatMessageRead(1_699_999_999_000, 1_700_000_000_000, false), false);
    assert.equal(isChatMessageRead(1_700_000_001_000, 1_700_000_000_000, false, 1_700_000_002_000), true);
    assert.equal(isChatMessageRead(1_700_000_003_000, 1_700_000_000_000, true, 1_700_000_002_000), false);
  });

  it('inclui destinatário e requestId no corpo de setup do DM', () => {
    assert.deepEqual(createDirectMessageSetupRequest('pessoa@example.com', 'request-1'), {
      requestId: 'request-1',
      space: { spaceType: 'DIRECT_MESSAGE', singleUserBotDm: false },
      memberships: [{ member: { name: 'users/pessoa@example.com', type: 'HUMAN' } }]
    });
  });

  it('busca as mensagens mais recentes de cada espaço', () => {
    const url = new URL(chatMessagesUrl('spaces/example'));

    assert.equal(url.pathname, '/v1/spaces/example/messages');
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(url.searchParams.get('orderBy'), 'createTime desc');
    assert.match(url.searchParams.get('fields') ?? '', /sender\(.*avatarUrl/);
    assert.match(url.searchParams.get('fields') ?? '', /emojiReactionSummaries/);
  });

  it('usa o nome do outro participante quando o DM não tem displayName', () => {
    const name = resolveChatSpaceName(
      { name: 'spaces/direct-message', displayName: '  ', spaceType: 'DIRECT_MESSAGE' },
      [
        { sender: { name: 'users/user-1', displayName: 'Luiz Machado' } },
        { sender: { name: 'users/user-2', displayName: 'Luciano' } }
      ],
      'user-1',
      'Luiz Machado'
    );

    assert.equal(name, 'Luciano');
  });

  it('prioriza o nome definido para o espaço', () => {
    assert.equal(
      resolveChatSpaceName(
        { name: 'spaces/group', displayName: 'Engenharia', spaceType: 'GROUP_CHAT' },
        [{ sender: { name: 'users/user-2', displayName: 'Luciano' } }],
        'user-1'
      ),
      'Engenharia'
    );
  });
});

describe('conexão PostgreSQL serverless', () => {
  it('usa transaction pooler do Supabase para hosts compartilhados', () => {
    assert.equal(
      new URL(serverlessDatabaseUrl('postgresql://user:pass@aws-0-region.pooler.supabase.com:5432/postgres')).port,
      '6543'
    );
  });

  it('mantém inalterada a conexão direta e os URLs já em transaction mode', () => {
    assert.equal(new URL(serverlessDatabaseUrl('postgresql://user:pass@db.example.com:5432/postgres')).port, '5432');
    assert.equal(new URL(serverlessDatabaseUrl('postgresql://user:pass@aws-0-region.pooler.supabase.com:6543/postgres')).port, '6543');
  });
});

describe('sincronização do Gmail', () => {
  it('sempre consulta as mensagens mais recentes sem reaproveitar pageToken', () => {
    const url = new URL(gmailMessagesUrl());

    assert.equal(url.searchParams.get('maxResults'), '50');
    assert.equal(url.searchParams.has('pageToken'), false);
  });

  it('consulta historyId e deduplica as mensagens adicionadas', () => {
    const url = new URL(gmailHistoryUrl('12345', 'next-page'));
    assert.equal(url.searchParams.get('startHistoryId'), '12345');
    assert.equal(url.searchParams.get('historyTypes'), 'messageAdded');
    assert.equal(url.searchParams.get('pageToken'), 'next-page');
    assert.deepEqual(gmailAddedMessageIds({ history: [
      { messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] },
      { messagesAdded: [{ message: { id: 'm1' } }] }
    ] }), ['m1', 'm2']);
  });
});

describe('montagem MIME do e-mail', () => {
  it('preserva o HTML original e não expõe CSS no texto de fallback', () => {
    const bodyHtml = '<html><head><style>.promo{color:red}</style></head><body><table><tr><td>Oferta</td></tr></table></body></html>';
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('Oferta para você').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from(bodyHtml).toString('base64url') } }
      ]
    };

    const bodies = extractGmailBodies(payload);

    assert.equal(bodies.bodyHtml, bodyHtml);
    assert.equal(bodies.bodyText, 'Oferta para você');
  });

  it('remove style e head do fallback quando o e-mail só tem HTML', () => {
    const bodyHtml = '<html><head><style>.promo{color:red}</style></head><body><p>Oferta&nbsp;especial</p></body></html>';
    const bodies = extractGmailBodies({ mimeType: 'text/html', body: { data: Buffer.from(bodyHtml).toString('base64url') } });

    assert.equal(bodies.bodyHtml, bodyHtml);
    assert.equal(bodies.bodyText, 'Oferta especial');
  });

  it('inclui corpo UTF-8 e arquivos anexados em multipart/mixed', () => {
    const raw = createGmailRawMessage({
      to: ['destino@example.com'],
      subject: 'Relatório mensal',
      body: 'Olá, segue o arquivo.',
      attachments: [{ fileName: 'relatório.txt', mimeType: 'text/plain', base64: Buffer.from('conteúdo').toString('base64') }]
    });
    const mime = Buffer.from(raw, 'base64url').toString('utf8');

    assert.match(mime, /Content-Type: multipart\/mixed; boundary=/);
    assert.match(mime, /Subject: =\?UTF-8\?B\?/);
    assert.match(mime, /Content-Disposition: attachment;/);
    assert.match(mime, /filename\*=UTF-8''relat%C3%B3rio.txt/);
    assert.ok(mime.includes(Buffer.from('Olá, segue o arquivo.').toString('base64')));
    assert.ok(mime.includes(Buffer.from('conteúdo').toString('base64')));
  });

  it('mantém o formato simples para e-mail sem anexo', () => {
    const mime = Buffer.from(createGmailRawMessage({ to: ['destino@example.com'], subject: 'Olá', body: 'Mensagem' }), 'base64url').toString('utf8');
    assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"/);
    assert.ok(mime.endsWith('Mensagem'));
  });

  it('rejeita mais de dez anexos antes de acessar o provedor', async () => {
    const { db, accounts } = createFakeDb();
    accounts.set('gmail-account', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
    const app = await createAppServer(config, db);
    const attachments = Array.from({ length: 11 }, (_, index) => ({ fileName: `${index}.txt`, mimeType: 'text/plain', base64: 'YQ==' }));

    const response = await call(app, 'POST', '/messages/send', '10.0.0.19', undefined, 'Bearer test-session', JSON.stringify({ accountId: 'gmail-account', to: ['destino@example.com'], body: 'Olá', attachments }));

    assert.equal(response.status, 413);
    await app.close();
  });
});

/** Banco de mentira: só as quatro consultas que o fluxo de login realmente usa. */
function createFakeDb(): {
  db: Db;
  rows: Map<string, PendingRow>;
  accounts: Map<string, { userId: string; contextId: string; provider?: string; channel?: string; email?: string }>;
  notifications: Map<string, boolean>;
  credentials: Set<string>;
} {
  const rows = new Map<string, PendingRow>();
  const accounts = new Map<string, { userId: string; contextId: string; provider?: string; channel?: string; email?: string }>();
  const notifications = new Map<string, boolean>();
  const credentials = new Set<string>();

  let db: Db;
  db = {
    pool: null as unknown as Pool,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      if (text.startsWith('SELECT user_id, expires_at FROM atmail_sessions')) {
        if (values[0] !== hashToken('test-session')) return { rows: [] };
        return { rows: [{ user_id: 'user-1', expires_at: String(Date.now() + 60_000) } as unknown as T] };
      }
      if (text.startsWith('SELECT provider, channel FROM atmail_accounts')) {
        const [accountId, userId] = values as [string, string];
        const account = accounts.get(accountId);
        if (!account || account.userId !== userId) return { rows: [] };
        return { rows: [{ provider: account.provider ?? 'gmail', channel: account.channel ?? 'email' } as unknown as T] };
      }
      if (text.startsWith('SELECT id FROM atmail_accounts WHERE id = $1 AND user_id = $2')) {
        const [accountId, userId] = values as [string, string];
        return { rows: accounts.get(accountId)?.userId === userId ? [{ id: accountId } as unknown as T] : [] };
      }
      if (text.startsWith('SELECT id FROM atmail_accounts WHERE id = ANY')) {
        const [accountIds, userId] = values as [string[], string];
        const owned = accountIds.filter((accountId) => accounts.get(accountId)?.userId === userId);
        return { rows: owned.map((id) => ({ id } as unknown as T)) };
      }
      if (text.startsWith('UPDATE atmail_accounts SET context_id')) {
        const [contextId, _updatedAt, accountIds, userId] = values as [string, number, string[], string];
        const updated: T[] = [];
        for (const accountId of accountIds) {
          const account = accounts.get(accountId);
          if (account?.userId !== userId) continue;
          account.contextId = contextId;
          updated.push({ id: accountId } as unknown as T);
        }
        return { rows: updated };
      }
      if (text.startsWith('INSERT INTO atmail_notification_preferences')) {
        const [userId, accountId, enabled] = values as [string, string, boolean];
        notifications.set(`${userId}:${accountId}`, enabled);
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM atmail_notification_preferences')) {
        notifications.delete(`${String(values[0])}:${String(values[1])}`);
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM atmail_credentials')) {
        credentials.delete(String(values[1]));
        return { rows: [] };
      }
      if (text.startsWith('DELETE FROM atmail_accounts WHERE user_id = $1 AND id = $2')) {
        const [userId, accountId] = values as [string, string];
        if (accounts.get(accountId)?.userId !== userId) return { rows: [] };
        accounts.delete(accountId);
        return { rows: [{ id: accountId } as unknown as T] };
      }
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
    async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = { query: (text: string, values: unknown[] = []) => db.query(text, values) } as unknown as PoolClient;
      return callback(client);
    },
    close: async () => undefined
  };

  return { db, rows, accounts, notifications, credentials };
}

interface ResponseSnapshot {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function call(
  app: AppServer,
  method: 'GET' | 'POST' | 'OPTIONS' | 'DELETE',
  path: string,
  ip: string,
  origin?: string,
  authorization?: string,
  requestBody?: string
): Promise<ResponseSnapshot> {
  return await new Promise<ResponseSnapshot>((resolve) => {
    let status = 0;
    let headers: Record<string, string> = {};
    const req = {
      method,
      url: path,
      headers: {
        host: 'localhost:8790',
        'x-forwarded-for': ip,
        ...(origin ? { origin } : {}),
        ...(authorization ? { authorization } : {})
      },
      async *[Symbol.asyncIterator]() {
        if (requestBody !== undefined) yield Buffer.from(requestBody);
      }
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

async function startLogin(app: AppServer, ip: string, platform?: string, origin?: string): Promise<string> {
  const response = await call(app, 'POST', `/auth/google/start${platform ? `?platform=${platform}` : ''}`, ip, origin);
  assert.equal(response.status, 200);
  const { state } = JSON.parse(response.body) as { state: string };
  assert.equal(typeof state, 'string');
  assert.ok(state.length >= 32, 'state precisa ter entropia suficiente');
  return state;
}

describe('fluxo OAuth do backend', () => {
  it('persiste preferência de notificações por conta', async () => {
    const { db, accounts, notifications } = createFakeDb();
    accounts.set('gmail-account', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email', email: 'pessoa@example.com' });
    const app = await createAppServer(config, db);

    const response = await call(app, 'POST', '/accounts/notifications', '10.0.0.21', undefined, 'Bearer test-session', JSON.stringify({ accountId: 'gmail-account', enabled: false }));

    assert.equal(response.status, 200);
    assert.equal(notifications.get('user-1:gmail-account'), false);
    await app.close();
  });

  it('remove a conta e suas credenciais somente para seu proprietário', async () => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('gmail-account', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
    credentials.add('gmail-account');
    const app = await createAppServer(config, db);

    const response = await call(app, 'DELETE', '/accounts/gmail-account', '10.0.0.22', undefined, 'Bearer test-session');

    assert.equal(response.status, 200);
    assert.equal(accounts.has('gmail-account'), false);
    assert.equal(credentials.has('gmail-account'), false);
    await app.close();
  });

  it('persiste o contexto apenas nas contas autenticadas e válidas', async () => {
    const { db, accounts } = createFakeDb();
    accounts.set('gmail-account', { userId: 'user-1', contextId: 'work' });
    accounts.set('chat-account', { userId: 'user-1', contextId: 'work' });
    accounts.set('other-user-account', { userId: 'user-2', contextId: 'work' });
    const app = await createAppServer(config, db);
    const payload = JSON.stringify({ accountIds: ['gmail-account'], contextId: 'studies' });

    const unauthorized = await call(app, 'POST', '/accounts/context', '10.0.0.11', undefined, undefined, payload);
    assert.equal(unauthorized.status, 401);

    const updated = await call(app, 'POST', '/accounts/context', '10.0.0.12', undefined, 'Bearer test-session', payload);
    assert.equal(updated.status, 200);
    assert.deepEqual(JSON.parse(updated.body), { updated: 1 });
    assert.equal(accounts.get('gmail-account')?.contextId, 'studies');

    const mixedOwnership = await call(app, 'POST', '/accounts/context', '10.0.0.15', undefined, 'Bearer test-session', JSON.stringify({ accountIds: ['chat-account', 'other-user-account'], contextId: 'personal' }));
    assert.equal(mixedOwnership.status, 404);
    assert.equal(accounts.get('chat-account')?.contextId, 'work');

    const forbidden = await call(app, 'POST', '/accounts/context', '10.0.0.13', undefined, 'Bearer test-session', JSON.stringify({ accountIds: ['other-user-account'], contextId: 'personal' }));
    assert.equal(forbidden.status, 404);
    assert.equal(accounts.get('other-user-account')?.contextId, 'work');

    const invalidContext = await call(app, 'POST', '/accounts/context', '10.0.0.14', undefined, 'Bearer test-session', JSON.stringify({ accountIds: ['gmail-account'], contextId: 'all' }));
    assert.equal(invalidContext.status, 400);
    await app.close();
  });

  it('permite preflight somente para origens configuradas', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const web = await call(app, 'OPTIONS', '/auth/google/start', '10.0.0.6', 'https://at-mail.vercel.app');
    assert.equal(web.status, 204);
    assert.equal(web.headers['access-control-allow-origin'], 'https://at-mail.vercel.app');
    assert.equal(web.headers.vary, 'Origin');
    assert.match(web.headers['access-control-allow-methods'] ?? '', /DELETE/);

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
    assert.match(callback.body, /voltando ao @mail/i);
    assert.equal(callback.headers['cache-control'], 'no-store');

    const polled = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(polled.body), { code: 'CODE123' });

    const consumed = await call(app, 'GET', `/auth/google/code?state=${state}`, ip);
    assert.deepEqual(JSON.parse(consumed.body), { pending: true }, 'o code não pode ser devolvido duas vezes');
    await app.close();
  });

  it('retorna ao site ou app mobile ao concluir OAuth', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const webState = await startLogin(app, '10.0.0.9', 'web');
    const webCallback = await call(app, 'GET', `/auth/google/callback?code=WEB_CODE&state=${encodeURIComponent(webState)}`, '10.0.0.9');
    assert.match(webCallback.body, /https:\/\/at-mail\.vercel\.app\//);

    const androidState = await startLogin(app, '10.0.0.10', 'android');
    const androidCallback = await call(app, 'GET', `/auth/google/callback?code=ANDROID_CODE&state=${encodeURIComponent(androidState)}`, '10.0.0.10');
    assert.match(androidCallback.body, /atmail:\/\/auth\/google\/callback/);
    assert.match(androidCallback.body, new RegExp(encodeURIComponent(androidState)));

    const tauriState = await startLogin(app, '10.0.0.11', 'tauri');
    const tauriCallback = await call(app, 'GET', `/auth/google/callback?code=TAURI_CODE&state=${encodeURIComponent(tauriState)}`, '10.0.0.11');
    assert.match(tauriCallback.body, /https:\/\/at-mail\.vercel\.app\//);

    const legacyWebState = await startLogin(app, '10.0.0.13', 'web', 'https://at-mail-web.vercel.app');
    const legacyWebCallback = await call(app, 'GET', `/auth/google/callback?code=LEGACY_WEB_CODE&state=${encodeURIComponent(legacyWebState)}`, '10.0.0.13');
    assert.match(legacyWebCallback.body, /https:\/\/at-mail-web\.vercel\.app\//);

    const legacyMobileState = await startLogin(app, '10.0.0.14');
    const legacyMobileCallback = await call(app, 'GET', `/auth/google/callback?code=LEGACY_CODE&state=${encodeURIComponent(legacyMobileState)}`, '10.0.0.14');
    assert.match(legacyMobileCallback.body, /atmail:\/\/auth\/google\/callback/);
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
