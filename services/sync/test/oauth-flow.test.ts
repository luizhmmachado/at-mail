import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import { Client, type Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { SyncConfig } from '../src/config';
import { encrypt, hashToken, pkceChallenge } from '../src/crypto';
import { databasePoolConfig, serverlessDatabaseUrl } from '../src/db';
import { SUPABASE_CA } from '../src/supabase-ca';
import type { Db } from '../src/db';
import { chatDirectMessageUrl, chatMessagesUrl, chatReactionRequest, chatReplyRequest, chatSendReceipt, chatSpaceReadStateRequest, chatSpaceReadStateUrl, createDirectMessageSetupRequest, createGmailRawMessage, extractGmailBodies, fetchGmail, gmailAddedMessageIds, gmailHistoryUrl, gmailMessagesUrl, isChatMessageRead, resolveChatSpaceName } from '../src/providers';
import { createAppServer, type AppServer } from '../src/server';

interface PendingRow {
  code: string;
  error: string;
  codeChallenge: string;
  codeDelivered: boolean;
  createdAt: number;
}

const config: SyncConfig = {
  port: 8790,
  databaseUrl: 'postgresql://fake',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:8790/auth/google/callback',
  encryptionKey: Buffer.alloc(32),
  publicOrigins: ['http://localhost:8081', 'https://at-mail.vercel.app', 'http://tauri.localhost', 'tauri://localhost'],
  webAppOrigin: 'https://at-mail.vercel.app'
};

describe('nome de espaços do Google Chat', () => {
  it('identifica credenciais revogadas sem confundir falhas temporárias com autenticação', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('chat-1', { userId: 'user-1', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    credentials.add('chat-1');
    let response = Response.json({ error: 'invalid_grant' }, { status: 400 });
    t.mock.method(globalThis, 'fetch', async () => response.clone());
    const app = await createAppServer(config, db);
    const sync = () => call(app, 'POST', '/sync/google-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId: 'chat-1' }));
    const revoked = await sync();
    assert.equal(revoked.status, 401);
    assert.equal(JSON.parse(revoked.body).errorCode, 'GOOGLE_AUTH_REVOKED');
    response = Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
    const unavailable = await sync();
    assert.equal(unavailable.status, 500);
    assert.equal(JSON.parse(unavailable.body).errorCode, undefined);
    response = Response.json({ access_token: 'access' });
    let apiStatus = 401;
    let reason = 'invalidCredentials';
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).includes('oauth2.googleapis.com')
      ? response.clone()
      : Response.json({ error: { errors: [{ reason }] } }, { status: apiStatus }));
    assert.equal((await sync()).status, 401);
    apiStatus = 403;
    reason = 'ACCESS_TOKEN_SCOPE_INSUFFICIENT';
    assert.equal(JSON.parse((await sync()).body).errorCode, 'GOOGLE_AUTH_REVOKED');
    reason = 'rateLimitExceeded';
    assert.equal((await sync()).status, 500);
  });

  it('carrega imagem do Chat com credencial da conta e rejeita acesso de outra conta', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('chat-1', { userId: 'user-1', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    accounts.set('other', { userId: 'user-2', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    credentials.add('chat-1');
    const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token' });
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer test-token');
      if (url.includes('/attachments/')) return Response.json({ contentType: 'image/png', attachmentDataRef: { resourceName: 'media/token' } });
      if (url.endsWith('/v1/media/media/token?alt=media')) return new Response(Buffer.from('imagem'));
      throw new Error(`URL não esperada: ${url}`);
    });
    const app = await createAppServer(config, db);
    const send = (accountId: string, attachmentName: string) => call(app, 'POST', '/messages/chat-image', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, attachmentName }));
    assert.equal((await send('other', 'spaces/s/messages/m/attachments/a')).status, 404);
    assert.equal((await send('chat-1', 'spaces/s/messages/m/attachments/../a')).status, 400);
    assert.equal(urls.length, 0);
    const image = await send('chat-1', 'spaces/s/messages/m/attachments/a');
    assert.equal(image.status, 200);
    assert.deepEqual(JSON.parse(image.body), { mimeType: 'image/png', base64: Buffer.from('imagem').toString('base64') });
  });

  it('sincroniza páginas de espaços e consulta a conversa aberta sem listar os outros espaços', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('chat-1', { userId: 'user-1', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    credentials.add('chat-1');
    const urls: URL[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token' });
      if (url.pathname === '/v1/spaces') {
        assert.equal(url.searchParams.get('pageSize'), '5');
        return Response.json(url.searchParams.get('pageToken') === 'page-2'
          ? { spaces: [{ name: 'spaces/second', displayName: 'Second' }] }
          : { spaces: [{ name: 'spaces/first', displayName: 'First' }], nextPageToken: 'page-2' });
      }
      if (url.pathname === '/v1/spaces/open') return Response.json({ name: 'spaces/open', displayName: 'Open' });
      if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{
        name: `${url.pathname.slice(4, -9)}/messages/message-1`, text: 'Nova mensagem',
        createTime: '2026-11-19T12:00:00Z', thread: { name: 'spaces/open/threads/root' }, threadReply: true
      }] });
      if (url.pathname.endsWith('/spaceReadState')) return Response.json({ lastReadTime: '2026-11-18T12:00:00Z' });
      throw new Error(`URL não esperada: ${url}`);
    });
    const app = await createAppServer(config, db);
    const sync = (input: object) => call(app, 'POST', '/sync/google-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId: 'chat-1', ...input }));
    const first = await sync({});
    assert.equal(first.status, 200);
    assert.equal(JSON.parse(first.body).cursor, 'page-2');
    assert.equal(JSON.parse(first.body).hasMore, true);
    const second = await sync({ cursor: 'page-2' });
    assert.equal(JSON.parse(second.body).hasMore, false);
    assert.equal(JSON.parse(second.body).cursor, '');
    urls.length = 0;
    const focused = await sync({ spaceId: 'spaces/open' });
    assert.equal(focused.status, 200);
    assert.equal(JSON.parse(focused.body).messages[0].isThreadReply, true);
    assert.equal(urls.some((url) => url.pathname === '/v1/spaces'), false);
    urls.length = 0;
    assert.equal((await sync({ spaceId: 'spaces/open/../../other' })).status, 400);
    assert.equal((await call(app, 'POST', '/sync/google-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId: 'other', spaceId: 'spaces/open' }))).status, 404);
    assert.equal(urls.length, 0);
  });

  it('localiza uma conversa direta existente pelo e-mail', () => {
    const url = new URL(chatDirectMessageUrl('pessoa@example.com'));
    assert.equal(url.pathname, '/v1/spaces:findDirectMessage');
    assert.equal(url.searchParams.get('name'), 'users/pessoa@example.com');
  });

  describe('recibo de envio de e-mail', () => {
    it('devolve os identificadores do Gmail e mantém a thread original ao responder', async (t) => {
      const { db, accounts, credentials } = createFakeDb();
      accounts.set('mail-1', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
      credentials.add('mail-1');
      t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token' });
        assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.threadId, 'thread-1');
        assert.match(Buffer.from(payload.raw, 'base64url').toString('utf8'), /In-Reply-To: <original@example.com>/);
        assert.match(Buffer.from(payload.raw, 'base64url').toString('utf8'), /Message-ID: <[^>]+@atmail.local>/);
        assert.match(Buffer.from(payload.raw, 'base64url').toString('utf8'), /filename="reply\.png"/);
        assert.match(Buffer.from(payload.raw, 'base64url').toString('utf8'), /YWJj/);
        assert.ok(Buffer.from(payload.raw, 'base64url').toString('utf8').includes(Buffer.from('<strong>Reply</strong>').toString('base64')));
        return Response.json({ id: 'mail-message-1', threadId: 'thread-1' });
      });
      const result = await call(await createAppServer(config, db), 'POST', '/messages/send', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({
        accountId: 'mail-1', to: ['other@example.com'], subject: 'Re: Test', body: 'Reply',
        inReplyTo: '<original@example.com>', providerThreadId: 'thread-1', bodyHtml: '<strong>Reply</strong>',
        attachments: [{ fileName: 'reply.png', mimeType: 'image/png', base64: 'YWJj' }]
      }));
      assert.equal(result.status, 200);
      const receipt = JSON.parse(result.body);
      assert.equal(receipt.sent, true);
      assert.equal(receipt.messageId, 'mail-message-1');
      assert.equal(receipt.threadId, 'thread-1');
      assert.ok(Number.isFinite(receipt.receivedAt));
      assert.match(receipt.rfcMessageId, /^<[^>]+@atmail.local>$/);
    });
  });

  it('responde no espaço/thread existente e cria reações com emoji Unicode', () => {
    assert.deepEqual(chatReplyRequest('Olá', 'spaces/space-1/threads/thread-1'), {
      text: 'Olá',
      thread: { name: 'spaces/space-1/threads/thread-1' }
    });
    assert.deepEqual(chatReplyRequest('Olá'), { text: 'Olá' });
    assert.deepEqual(chatReactionRequest('👍'), { emoji: { unicode: '👍' } });
  });

  it('identifica e remove a reação da conta autenticada', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    const accountId = 'google:123456:chat';
    accounts.set(accountId, { userId: 'user-1', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    credentials.add(accountId);
    const methods: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token' });
      if (url.pathname === '/v1/spaces/open') return Response.json({ name: 'spaces/open' });
      if (url.pathname.endsWith('/spaceReadState')) return Response.json({ lastReadTime: '2026-11-18T12:00:00Z' });
      if (url.pathname === '/v1/spaces/open/messages') return Response.json({ messages: [{
        name: 'spaces/open/messages/one', text: 'Olá', emojiReactionSummaries: [{ emoji: { unicode: '👍' }, reactionCount: 2 }]
      }] });
      if (url.pathname === '/v1/spaces/open/messages/one/reactions') {
        assert.equal(url.searchParams.get('filter'), 'user.name = "users/123456"');
        return Response.json({ reactions: [{ name: 'spaces/open/messages/one/reactions/own', emoji: { unicode: '👍' } }] });
      }
      if (url.pathname === '/v1/spaces/open/messages/one/reactions/own') {
        methods.push(init?.method ?? 'GET');
        return Response.json({});
      }
      throw new Error(`URL não esperada: ${url}`);
    });
    const app = await createAppServer(config, db);
    const synced = await call(app, 'POST', '/sync/google-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, spaceId: 'spaces/open' }));
    assert.deepEqual(JSON.parse(synced.body).messages[0].reactions, [{ emoji: '👍', count: 2, own: true }]);
    const removed = await call(app, 'POST', '/messages/react-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, messageId: `chat:${accountId}:spaces/open/messages/one`, emoji: '👍', remove: true }));
    assert.equal(removed.status, 200);
    assert.deepEqual(methods, ['DELETE']);
    await app.close();
  });

  it('envia anexos ao espaço e devolve seus metadados na sincronização', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    const accountId = 'chat-attachments';
    accounts.set(accountId, { userId: 'user-1', contextId: 'work', provider: 'google-chat', channel: 'chat' });
    credentials.add(accountId);
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token' });
      if (url.pathname === '/upload/v1/spaces/open/attachments:upload') {
        assert.equal(url.searchParams.get('uploadType'), 'multipart');
        assert.match(String(init?.body), /foto\.png/);
        assert.match(String(init?.body), /conteúdo/);
        return Response.json({ attachmentDataRef: { attachmentUploadToken: 'upload-token' } });
      }
      if (url.pathname === '/v1/spaces/open/messages' && init?.method === 'POST') {
        assert.deepEqual(JSON.parse(String(init.body)).attachment, [{ attachmentDataRef: { attachmentUploadToken: 'upload-token' } }]);
        return Response.json({ name: 'spaces/open/messages/one', createTime: '2026-11-19T12:00:00Z' });
      }
      if (url.pathname === '/v1/spaces/open') return Response.json({ name: 'spaces/open' });
      if (url.pathname.endsWith('/spaceReadState')) return Response.json({ lastReadTime: '2026-11-18T12:00:00Z' });
      if (url.pathname === '/v1/spaces/open/messages') return Response.json({ messages: [{ name: 'spaces/open/messages/one', attachment: [{ name: 'spaces/open/messages/one/attachments/file', contentName: 'foto.png', contentType: 'image/png', thumbnailUri: 'https://example.com/thumb', downloadUri: 'https://example.com/download' }] }] });
      throw new Error(`URL não esperada: ${url}`);
    });
    const app = await createAppServer(config, db);
    const sent = await call(app, 'POST', '/messages/send-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, spaceId: 'spaces/open', body: '', attachments: [{ fileName: 'foto.png', mimeType: 'image/png', base64: Buffer.from('conteúdo').toString('base64') }] }));
    assert.equal(sent.status, 200);
    const synced = await call(app, 'POST', '/sync/google-chat', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, spaceId: 'spaces/open' }));
    assert.deepEqual(JSON.parse(synced.body).messages[0].attachments, [{ id: 'spaces/open/messages/one/attachments/file', fileName: 'foto.png', mimeType: 'image/png', thumbnailUrl: 'https://example.com/thumb', downloadUrl: 'https://example.com/download' }]);
    await app.close();
  });

  it('retorna o identificador e horário da mensagem criada no Chat', () => {
    assert.deepEqual(chatSendReceipt('spaces/space-1', {
      name: 'spaces/space-1/messages/message-1',
      createTime: '2026-11-19T12:00:00Z'
    }), {
      messageName: 'spaces/space-1/messages/message-1',
      spaceResourceName: 'spaces/space-1',
      receivedAt: Date.parse('2026-11-19T12:00:00Z')
    });
    assert.throws(() => chatSendReceipt('spaces/space-1', { name: 'spaces/other/messages/message-1' }));
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
  it('mantém a CA e a verificação de certificado no cliente pg mesmo com parâmetros TLS no URL do Supabase', () => {
    for (const host of ['aws-0-region.pooler.supabase.com', 'db.project.supabase.co']) {
      for (const parameters of ['sslmode=require', 'ssl=true', 'sslmode=require&ssl=true']) {
        const config = databasePoolConfig(`postgresql://user:pass@${host}:5432/postgres?${parameters}&application_name=atmail`);
        const client = new Client(config);
        assert.deepEqual(client.ssl, { ca: [...rootCertificates, SUPABASE_CA], rejectUnauthorized: true });
        const url = new URL(config.connectionString!);
        assert.equal(url.searchParams.get('application_name'), 'atmail');
        assert.equal(url.username, 'user');
        assert.equal(url.password, 'pass');
      }
    }
  });

  it('preserva os parâmetros TLS explícitos de outros provedores', () => {
    const config = databasePoolConfig('postgresql://user:pass@db.example.com:5432/postgres?sslmode=verify-full');
    assert.equal(new URL(config.connectionString!).searchParams.get('sslmode'), 'verify-full');
  });

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
  it('carrega favoritos antigos de todas as páginas e retém o cursor anterior à varredura', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('gmail-1', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
    credentials.add('gmail-1');
    const paths: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test-token' });
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '100' });
      if (url.pathname.endsWith('/messages')) {
        if (url.searchParams.get('q') !== 'is:starred') return Response.json({ messages: [{ id: 'recent' }] });
        return Response.json(url.searchParams.get('pageToken')
          ? { messages: [{ id: 'old-2' }] }
          : { messages: [{ id: 'old-1' }, { id: 'recent' }], nextPageToken: 'next' });
      }
      const id = url.pathname.split('/').pop();
      return Response.json({ id, threadId: id, historyId: '105', labelIds: ['STARRED'], payload: { headers: [] } });
    });
    const result = await fetchGmail(db, config, 'user-1', 'gmail-1', 'work');
    assert.deepEqual(result.messages.map((message) => message.id), ['gmail:gmail-1:recent', 'gmail:gmail-1:old-1', 'gmail:gmail-1:old-2']);
    assert.equal(result.cursor, '100');
    assert.ok(paths.indexOf('/gmail/v1/users/me/profile') < paths.indexOf('/gmail/v1/users/me/messages'));
  });

  it('altera favoritos no Gmail apenas para a conta do usuário e valida a conversa', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('gmail-1', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
    accounts.set('other', { userId: 'user-2', contextId: 'work', provider: 'gmail', channel: 'email' });
    credentials.add('gmail-1');
    const changes: unknown[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-token' });
      assert.equal(String(input), 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-1/modify');
      changes.push(JSON.parse(String(init?.body)));
      return Response.json({ id: 'thread-1' });
    });
    const app = await createAppServer(config, db);
    const star = (accountId: string, threadId: string, isStarred: boolean) => call(app, 'POST', '/messages/star', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ accountId, threadId, isStarred }));
    assert.equal((await star('other', 'thread-1', true)).status, 404);
    assert.equal((await star('gmail-1', '../other', true)).status, 400);
    assert.equal(changes.length, 0);
    assert.equal((await star('gmail-1', 'thread-1', true)).status, 200);
    assert.equal((await star('gmail-1', 'thread-1', false)).status, 200);
    assert.deepEqual(changes, [{ addLabelIds: ['STARRED'] }, { removeLabelIds: ['STARRED'] }]);
  });

  it('sempre consulta as mensagens mais recentes sem reaproveitar pageToken', () => {
    const url = new URL(gmailMessagesUrl());

    assert.equal(url.searchParams.get('maxResults'), '50');
    assert.equal(url.searchParams.has('pageToken'), false);
  });

  it('consulta historyId e deduplica as mensagens adicionadas', () => {
    const url = new URL(gmailHistoryUrl('12345', 'next-page'));
    assert.equal(url.searchParams.get('startHistoryId'), '12345');
    assert.deepEqual(url.searchParams.getAll('historyTypes'), ['messageAdded', 'labelAdded', 'labelRemoved']);
    assert.equal(url.searchParams.get('pageToken'), 'next-page');
    assert.deepEqual(gmailAddedMessageIds({ history: [
      { messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] },
      { messagesAdded: [{ message: { id: 'm1' } }], labelsAdded: [{ message: { id: 'm3' } }], labelsRemoved: [{ message: { id: 'm2' } }] }
    ] }), ['m1', 'm2', 'm3']);
  });
});

describe('montagem MIME do e-mail', () => {
  it('envia texto e HTML formatado com ou sem anexos', () => {
    for (const attachments of [[], [{ fileName: 'imagem.png', mimeType: 'image/png', base64: 'YWJj' }]]) {
      const mime = Buffer.from(createGmailRawMessage({ to: ['destino@example.com'], body: '**Olá**', bodyHtml: '<p><strong>Olá</strong></p>', attachments }), 'base64url').toString('utf8');
      assert.match(mime, /Content-Type: multipart\/alternative/);
      assert.match(mime, /Content-Type: text\/plain/);
      assert.match(mime, /Content-Type: text\/html/);
      assert.ok(mime.includes(Buffer.from('<p><strong>Olá</strong></p>').toString('base64')));
      if (attachments.length > 0) {
        assert.match(mime, /Content-Type: multipart\/mixed/);
        assert.match(mime, /filename="imagem\.png"/);
      }
    }
  });
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
  const attempts = new Map<string, { windowStart: number; count: number }>();

  let db: Db;
  db = {
    pool: null as unknown as Pool,
    async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
      if (text.startsWith('SELECT user_id, expires_at FROM atmail_sessions')) {
        if (values[0] !== hashToken('test-session')) return { rows: [] };
        return { rows: [{ user_id: 'user-1', expires_at: String(Date.now() + 60_000) } as unknown as T] };
      }
      if (text.startsWith('UPDATE atmail_sessions SET expires_at') || text.startsWith('DELETE FROM atmail_sessions')) {
        return { rows: [] };
      }
      if (text.startsWith('INSERT INTO atmail_users') || text.startsWith('INSERT INTO atmail_sessions')) return { rows: [] };
      if (text.startsWith('INSERT INTO atmail_credentials')) {
        const [accountId, userId] = values as [string, string];
        const existing = accounts.get(accountId);
        if (existing && existing.userId !== userId) return { rows: [] };
        credentials.add(accountId);
        return { rows: [{ account_id: accountId } as unknown as T] };
      }
      if (text.startsWith('INSERT INTO atmail_accounts')) {
        const [accountId, userId, provider, channel, email, , contextId] = values as [string, string, string, string, string, string, string];
        if (!accounts.has(accountId)) accounts.set(accountId, { userId, provider, channel, email, contextId });
        return { rows: [] };
      }
      if (text.startsWith('INSERT INTO atmail_login_attempts')) {
        const [bucket, key, windowStart] = values as [string, string, number];
        const id = `${bucket}:${key}`;
        const current = attempts.get(id);
        const count = current && current.windowStart === windowStart ? current.count + 1 : 1;
        attempts.set(id, { windowStart, count });
        return { rows: [{ count } as unknown as T] };
      }
      if (text.startsWith('DELETE FROM atmail_login_attempts WHERE window_start <')) {
        const cutoff = Number(values[0]);
        for (const [id, attempt] of attempts) if (attempt.windowStart < cutoff) attempts.delete(id);
        return { rows: [] };
      }
      if (text.startsWith('SELECT account_id FROM atmail_credentials') || text.startsWith('SELECT encrypted_refresh_token FROM atmail_credentials')) {
        return { rows: [] };
      }
      if (text.startsWith('SELECT provider, channel FROM atmail_accounts')) {
        const [accountId, userId] = values as [string, string];
        const account = accounts.get(accountId);
        if (!account || account.userId !== userId) return { rows: [] };
        return { rows: [{ provider: account.provider ?? 'gmail', channel: account.channel ?? 'email' } as unknown as T] };
      }
      if (text.startsWith('SELECT context_id FROM atmail_accounts')) {
        const [accountId, userId] = values as [string, string];
        const account = accounts.get(accountId);
        return { rows: account?.userId === userId ? [{ context_id: account.contextId } as unknown as T] : [] };
      }
      if (text.startsWith('SELECT encrypted_refresh_token, email FROM atmail_credentials')) {
        const [accountId, userId] = values as [string, string];
        return { rows: credentials.has(accountId) && accounts.get(accountId)?.userId === userId
          ? [{ encrypted_refresh_token: encrypt('test-refresh-token', config.encryptionKey), email: 'test@example.com' } as unknown as T] : [] };
      }
      if (text.startsWith('SELECT name FROM atmail_users')) return { rows: [{ name: 'Test User' } as unknown as T] };
      if (text.startsWith('SELECT thread_name, last_read_time FROM atmail_chat_thread_read_states')) return { rows: [] };
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
        const [state, code, error, codeChallenge, createdAt] = values as [string, string, string, string, number];
        rows.set(state, { code, error, codeChallenge, codeDelivered: false, createdAt });
        return { rows: [] };
      }
      if (text.startsWith('UPDATE atmail_oauth_pending SET code =')) {
        const [code, error, state, since] = values as [string, string, string, number];
        const row = rows.get(state);
        if (!row || row.createdAt <= since) return { rows: [] };
        row.code = code;
        row.error = error;
        return { rows: [{ state } as unknown as T] };
      }
      if (text.startsWith('UPDATE atmail_oauth_pending SET code_delivered = TRUE')) {
        const [state, since] = values as [string, number];
        const row = rows.get(state);
        if (!row || row.createdAt <= since || row.codeDelivered || (row.code === '' && row.error === '')) return { rows: [] };
        row.codeDelivered = true;
        return { rows: [{ code: row.code, error: row.error } as unknown as T] };
      }
      if (text.startsWith('DELETE FROM atmail_oauth_pending WHERE state = $1 AND code = $2')) {
        const [state, code, since] = values as [string, string, number];
        const row = rows.get(state);
        if (!row || row.createdAt <= since || row.code !== code) return { rows: [] };
        rows.delete(state);
        return { rows: [{ code_challenge: row.codeChallenge } as unknown as T] };
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

async function startLogin(app: AppServer, ip: string, platform?: string, origin?: string): Promise<{ state: string; verifier: string }> {
  const verifier = randomBytes(32).toString('hex');
  const response = await call(app, 'POST', `/auth/google/start${platform ? `?platform=${platform}` : ''}`, ip, origin, undefined, JSON.stringify({ codeChallenge: pkceChallenge(verifier) }));
  assert.equal(response.status, 200);
  const { state } = JSON.parse(response.body) as { state: string };
  assert.equal(typeof state, 'string');
  assert.ok(state.length >= 32, 'state precisa ter entropia suficiente');
  return { state, verifier };
}

describe('fluxo OAuth do backend', () => {
  it('reconecta somente a conta selecionada e exige state e PKCE válidos', async (t) => {
    const { db, accounts, credentials } = createFakeDb();
    accounts.set('google:expected:gmail', { userId: 'user-1', contextId: 'work', provider: 'gmail', channel: 'email' });
    const app = await createAppServer(config, db);
    let subject = 'wrong';
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access', refresh_token: 'refresh' });
      if (String(input) === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ sub: subject, email: 'test@example.com' });
      throw new Error('URL não esperada');
    });
    const exchange = async (target: string, invalidVerifier = false) => {
      const { state, verifier } = await startLogin(app, '127.0.0.1');
      await call(app, 'GET', `/auth/google/callback?code=CODE&state=${encodeURIComponent(state)}`, '127.0.0.1');
      return call(app, 'POST', '/auth/google/add', '127.0.0.1', undefined, 'Bearer test-session', JSON.stringify({ state, code: 'CODE', codeVerifier: invalidVerifier ? 'a'.repeat(64) : verifier, accountId: target }));
    };
    assert.equal((await exchange('google:expected:gmail', true)).status, 400);
    assert.equal((await exchange('google:expected:gmail')).status, 409);
    assert.equal(credentials.size, 0);
    subject = 'expected';
    assert.equal((await exchange('google:expected:gmail')).status, 200);
    assert.ok(credentials.has('google:expected:gmail'));
    assert.ok(credentials.has('google:expected:chat'));
  });

  it('conclui callback, polling e exchange com PKCE sem permitir reutilizar código ou sessão pendente', async (t) => {
    const { db, rows, accounts, credentials } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.30';
    const { state, verifier } = await startLogin(app, ip, 'android');
    let tokenRequests = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        tokenRequests += 1;
        const payload = new URLSearchParams(String(init?.body));
        assert.equal(payload.get('code'), 'LOGIN_CODE');
        assert.equal(payload.get('code_verifier'), verifier);
        assert.equal(payload.get('redirect_uri'), config.redirectUri);
        return new Response(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token' }));
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(JSON.stringify({ sub: 'user-1', email: 'test@example.com', email_verified: true }));
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await call(app, 'GET', `/auth/google/callback?code=LOGIN_CODE&state=${encodeURIComponent(state)}`, ip);
    const pollPayload = JSON.stringify({ state });
    const polled = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, pollPayload);
    assert.deepEqual(JSON.parse(polled.body), { code: 'LOGIN_CODE' });
    const polledAgain = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, pollPayload);
    assert.deepEqual(JSON.parse(polledAgain.body), { pending: true });

    const exchangePayload = JSON.stringify({ state, code: 'LOGIN_CODE', codeVerifier: verifier });
    const exchanged = await call(app, 'POST', '/auth/google/exchange', ip, undefined, undefined, exchangePayload);
    assert.equal(exchanged.status, 200, exchanged.body);
    assert.equal(typeof JSON.parse(exchanged.body).sessionToken, 'string');
    assert.equal(accounts.size, 2);
    assert.equal(credentials.size, 2);
    assert.equal(rows.has(state), false);
    const replayed = await call(app, 'POST', '/auth/google/exchange', ip, undefined, undefined, exchangePayload);
    assert.equal(replayed.status, 400);
    assert.equal(tokenRequests, 1);
    await app.close();
  });

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

    const { state } = await startLogin(app, ip);

    const beforeCallback = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, JSON.stringify({ state }));
    assert.deepEqual(JSON.parse(beforeCallback.body), { pending: true });

    const callback = await call(app, 'GET', `/auth/google/callback?code=CODE123&state=${state}`, ip);
    assert.equal(callback.status, 200);
    assert.equal(callback.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(callback.body, /voltando ao @mail/i);
    assert.equal(callback.headers['cache-control'], 'no-store');

    const polled = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, JSON.stringify({ state }));
    assert.deepEqual(JSON.parse(polled.body), { code: 'CODE123' });

    const consumed = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, JSON.stringify({ state }));
    assert.deepEqual(JSON.parse(consumed.body), { pending: true }, 'o code não pode ser devolvido duas vezes');
    await app.close();
  });

  it('retorna ao site ou app mobile ao concluir OAuth', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const { state: webState } = await startLogin(app, '10.0.0.9', 'web');
    const webCallback = await call(app, 'GET', `/auth/google/callback?code=WEB_CODE&state=${encodeURIComponent(webState)}`, '10.0.0.9');
    assert.match(webCallback.body, /https:\/\/at-mail\.vercel\.app\//);

    const { state: androidState } = await startLogin(app, '10.0.0.10', 'android');
    const androidCallback = await call(app, 'GET', `/auth/google/callback?code=ANDROID_CODE&state=${encodeURIComponent(androidState)}`, '10.0.0.10');
    assert.match(androidCallback.body, /atmail:\/\/auth\/google\/callback/);
    assert.match(androidCallback.body, new RegExp(encodeURIComponent(androidState)));

    const { state: tauriState } = await startLogin(app, '10.0.0.11', 'tauri');
    const tauriCallback = await call(app, 'GET', `/auth/google/callback?code=TAURI_CODE&state=${encodeURIComponent(tauriState)}`, '10.0.0.11');
    assert.doesNotMatch(tauriCallback.body, /https:\/\/at-mail\.vercel\.app\//);
    assert.match(tauriCallback.body, /window\.close\(\)/);

    const { state: legacyWebState } = await startLogin(app, '10.0.0.13', 'web', 'https://at-mail-web.vercel.app');
    const legacyWebCallback = await call(app, 'GET', `/auth/google/callback?code=LEGACY_WEB_CODE&state=${encodeURIComponent(legacyWebState)}`, '10.0.0.13');
    assert.match(legacyWebCallback.body, /https:\/\/at-mail-web\.vercel\.app\//);

    const { state: legacyMobileState } = await startLogin(app, '10.0.0.14');
    const legacyMobileCallback = await call(app, 'GET', `/auth/google/callback?code=LEGACY_CODE&state=${encodeURIComponent(legacyMobileState)}`, '10.0.0.14');
    assert.match(legacyMobileCallback.body, /atmail:\/\/auth\/google\/callback/);
    await app.close();
  });

  it('propaga a recusa do Google e não vaza código', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.3';

    const { state } = await startLogin(app, ip);
    const denied = await call(app, 'GET', `/auth/google/callback?error=access_denied&state=${state}`, ip);
    assert.equal(denied.status, 200);
    assert.match(denied.body, /recusou/i);

    const polled = await call(app, 'POST', '/auth/google/code', ip, undefined, undefined, JSON.stringify({ state }));
    assert.deepEqual(JSON.parse(polled.body), { error: 'access_denied' });
    await app.close();
  });

  it('exige state no polling', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);

    const response = await call(app, 'POST', '/auth/google/code', '10.0.0.4');

    assert.equal(response.status, 400);
    await app.close();
  });

  it('limita quantos logins um mesmo endereço pode iniciar', async () => {
    const { db } = createFakeDb();
    const app = await createAppServer(config, db);
    const ip = '10.0.0.5';

    const statuses: number[] = [];
    const codeChallenge = pkceChallenge(randomBytes(32).toString('hex'));
    for (let attempt = 0; attempt < 31; attempt += 1) {
      statuses.push((await call(app, 'POST', '/auth/google/start', ip, undefined, undefined, JSON.stringify({ codeChallenge }))).status);
    }

    assert.equal(statuses.slice(0, 30).every((status) => status === 200), true);
    assert.equal(statuses[30], 429);
    await app.close();
  });
});
