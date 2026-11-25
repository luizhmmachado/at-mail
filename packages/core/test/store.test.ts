import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  brand,
  createAppStore,
  createPresetContexts,
  createSeedData,
  shouldIgnoreInEditableTarget,
  formatShortcut,
  normalizeEvent,
  resolveShortcut
} from '../src/index.ts';
import { SyncEngine } from '../src/sync/engine.ts';
import { SyncError, type MailboxAdapter } from '../src/sync/types.ts';

const NOW = 1_770_000_000_000;

describe('tema do sistema', () => {
  it('inicializa a preferência manual e mantém a opção legada de tema', () => {
    const manual = createAppStore({ themePreference: 'dark' });
    manual.actions.applySystemTheme('light');
    assert.equal(manual.getSnapshot().ui.themeMode, 'dark');
    assert.equal(manual.getSnapshot().ui.themePreference, 'dark');
    const legacy = createAppStore({ themeMode: 'dark' });
    legacy.actions.applySystemTheme('light');
    assert.equal(legacy.getSnapshot().ui.themeMode, 'dark');
    assert.equal(legacy.getSnapshot().ui.themePreference, 'dark');
  });

  it('acompanha mudanças do sistema sem transformar o tema em uma preferência manual', () => {
    const store = createAppStore();
    store.actions.applySystemTheme('dark');
    assert.equal(store.getSnapshot().ui.themeMode, 'dark');
    assert.equal(store.getSnapshot().ui.themePreference, 'system');
    store.actions.applySystemTheme('light');
    assert.equal(store.getSnapshot().ui.themeMode, 'light');
    assert.equal(store.getSnapshot().ui.themePreference, 'system');
  });

  it('respeita o tema manual e volta a acompanhar o sistema quando solicitado', () => {
    const store = createAppStore({ themeMode: 'dark', themePreference: 'system' });
    store.actions.setThemeMode('light');
    store.actions.applySystemTheme('dark');
    assert.equal(store.getSnapshot().ui.themeMode, 'light');
    assert.equal(store.getSnapshot().ui.themePreference, 'light');
    store.actions.setThemePreference('system');
    store.actions.applySystemTheme('dark');
    assert.equal(store.getSnapshot().ui.themeMode, 'dark');
    assert.equal(store.getSnapshot().ui.themePreference, 'system');
  });
});

function storeWithSeed() {
  const seed = createSeedData(NOW);
  return createAppStore({ contexts: seed.contexts, accounts: seed.accounts, messages: seed.messages });
}

describe('sync por canal', () => {
  it('aplica cada página antes de a varredura terminar e preserva o cursor para retomar falhas', async () => {
    const seed = createSeedData(NOW);
    const account = seed.accounts.find((item) => item.channel === 'chat')!;
    const message = seed.messages.find((item) => item.channel === 'chat')!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const secondPageStarted = new Promise<void>((resolve) => { started = resolve; });
    const cursors: (string | undefined)[] = [];
    let fail = true;
    const engine = new SyncEngine({ store, adapters: [{
      provider: 'google-chat', channel: 'chat',
      async fetchSince(_account, cursor) {
        cursors.push(cursor);
        if (cursor === undefined) return { messages: [message], removedIds: [], nextCursor: 'next', hasMore: true };
        started();
        await blocked;
        if (fail) throw new Error('espaço indisponível');
        return { messages: [], removedIds: [], nextCursor: '' };
      }
    }] });

    const sync = engine.syncAccount(account.id);
    await secondPageStarted;
    assert.equal(store.getSnapshot().messages.length, 1);
    assert.equal(store.accountFor(account.id)?.syncCursor, 'next');
    release();
    assert.equal((await sync).ok, false);
    assert.equal(store.accountFor(account.id)?.lastError, 'espaço indisponível');
    fail = false;
    assert.equal((await engine.syncAccount(account.id)).ok, true);
    assert.deepEqual(cursors, [undefined, 'next', 'next']);
    assert.equal(store.accountFor(account.id)?.syncCursor, '');
  });

  it('consulta o espaço aberto sem aguardar o sync geral, deduplica consultas e não altera seu cursor', async () => {
    const seed = createSeedData(NOW);
    const original = seed.accounts.find((item) => item.channel === 'chat')!;
    const account = { ...original, syncCursor: 'background-page', lastSyncedAt: NOW - 1000 };
    const message = seed.messages.find((item) => item.channel === 'chat')!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    let releaseFull!: () => void;
    let releaseSpace!: () => void;
    const fullBlocked = new Promise<void>((resolve) => { releaseFull = resolve; });
    const spaceBlocked = new Promise<void>((resolve) => { releaseSpace = resolve; });
    let spaceCalls = 0;
    const engine = new SyncEngine({ store, adapters: [{
      provider: 'google-chat', channel: 'chat',
      async fetchSince() {
        await fullBlocked;
        return { messages: [], removedIds: [], nextCursor: '' };
      },
      async fetchSpace(_account, spaceId) {
        assert.equal(spaceId, 'spaces/open');
        spaceCalls += 1;
        await spaceBlocked;
        return { messages: [message], removedIds: [], nextCursor: 'not-an-account-cursor' };
      }
    }] });

    const full = engine.syncAccount(account.id);
    const focused = engine.syncSpace(account.id, 'spaces/open');
    assert.equal(engine.syncSpace(account.id, 'spaces/open'), focused);
    releaseSpace();
    assert.equal((await focused).ok, true);
    assert.equal(spaceCalls, 1);
    assert.equal(store.getSnapshot().messages.length, 1);
    assert.equal(store.accountFor(account.id)?.syncCursor, 'background-page');
    assert.equal(store.accountFor(account.id)?.lastSyncedAt, NOW - 1000);
    releaseFull();
    await full;
    assert.equal(store.getSnapshot().messages.length, 1);
  });

  it('faz uma consulta nova após a consulta que já estava em andamento ao enviar', async () => {
    const seed = createSeedData(NOW);
    const account = seed.accounts[0]!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const engine = new SyncEngine({ store, adapters: [{
      provider: account.provider, channel: account.channel,
      async fetchSince() {
        calls += 1;
        if (calls === 1) await blocked;
        return { messages: [], removedIds: [] };
      }
    }] });
    const beforeSend = engine.syncAccount(account.id);
    const afterSend = engine.syncAccount(account.id, { afterCurrent: true });
    assert.equal(calls, 1);
    release();
    await Promise.all([beforeSend, afterSend]);
    assert.equal(calls, 2);
  });

  it('sinaliza cursor repetido em vez de consultar páginas em loop', async () => {
    const seed = createSeedData(NOW);
    const account = seed.accounts[0]!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    const engine = new SyncEngine({ store, adapters: [{
      provider: account.provider, channel: account.channel,
      async fetchSince() { return { messages: [], removedIds: [], nextCursor: 'same', hasMore: true }; }
    }] });
    const result = await engine.syncAccount(account.id);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /cursor/);
  });

  it('limpa um cursor expirado e permite reiniciar a próxima consulta sem perder mensagens', async () => {
    const seed = createSeedData(NOW);
    const account = { ...seed.accounts.find((item) => item.channel === 'chat')!, syncCursor: 'expired' };
    const store = createAppStore({ accounts: [account], contexts: seed.contexts, messages: seed.messages });
    const engine = new SyncEngine({ store, adapters: [{
      provider: account.provider, channel: account.channel,
      async fetchSince(_account, cursor) {
        if (cursor === 'expired') throw new SyncError('token expirado', 'cursor');
        assert.equal(cursor, '');
        return { messages: [], removedIds: [], nextCursor: '' };
      }
    }] });
    assert.equal((await engine.syncAccount(account.id)).ok, false);
    assert.equal(store.accountFor(account.id)?.syncCursor, '');
    assert.equal((await engine.syncAccount(account.id)).ok, true);
    assert.equal(store.getSnapshot().messages.length, seed.messages.length);
  });

  it('pausa apenas a conta com autorização revogada até ser reconectada', async () => {
    const seed = createSeedData(NOW);
    const account = seed.accounts[0]!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    let calls = 0;
    const engine = new SyncEngine({ store, adapters: [{
      provider: account.provider, channel: account.channel,
      async fetchSince() {
        calls += 1;
        throw new SyncError('autorização revogada', 'auth');
      }
    }] });
    await engine.syncAll();
    assert.equal(store.accountFor(account.id)?.status, 'reauth-required');
    await engine.syncAll();
    assert.equal(calls, 1);
  });

  it('não restaura a conta quando uma consulta simultânea termina após a revogação', async () => {
    const seed = createSeedData(NOW);
    const account = seed.accounts.find((item) => item.channel === 'chat')!;
    const store = createAppStore({ accounts: [account], contexts: seed.contexts });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const engine = new SyncEngine({ store, adapters: [{
      provider: account.provider, channel: account.channel,
      async fetchSince() { throw new SyncError('autorização revogada', 'auth'); },
      async fetchSpace() { await blocked; return { messages: [], removedIds: [] }; }
    }] });
    const focused = engine.syncSpace(account.id, 'spaces/open');
    await engine.syncAccount(account.id);
    release();
    await focused;
    assert.equal(store.accountFor(account.id)?.status, 'reauth-required');
  });

  it('notifica apenas mensagens novas após o sync inicial', async () => {
    const seed = createSeedData(NOW);
    const emailAccount = seed.accounts.find((account) => account.channel === 'email');
    const message = seed.messages.find((item) => item.channel === 'email');
    assert.ok(emailAccount !== undefined);
    assert.ok(message !== undefined && message.channel === 'email');
    const account = { ...emailAccount, lastSyncedAt: NOW - 1_000 };
    const store = createAppStore({ contexts: seed.contexts, accounts: [account] });
    let notified = 0;
    const engine = new SyncEngine({
      store,
      adapters: [{ provider: 'gmail', channel: 'email', async fetchSince() { return { messages: [{ ...message, receivedAt: NOW }], removedIds: [] }; } }],
      onNewMessages: (_account, messages) => { notified += messages.length; }
    });

    await engine.syncAccount(account.id);
    await engine.syncAccount(account.id);

    assert.equal(notified, 1);
  });

  it('sincroniza apenas as contas do canal solicitado', async () => {
    const seed = createSeedData(NOW);
    const store = createAppStore({ contexts: seed.contexts, accounts: seed.accounts });
    const synchronizedChannels: string[] = [];
    const adapters: MailboxAdapter[] = [
      {
        provider: 'gmail',
        channel: 'email',
        async fetchSince() {
          synchronizedChannels.push('email');
          return { messages: [], removedIds: [] };
        }
      },
      {
        provider: 'google-chat',
        channel: 'chat',
        async fetchSince() {
          synchronizedChannels.push('chat');
          return { messages: [], removedIds: [] };
        }
      }
    ];
    const engine = new SyncEngine({ store, adapters });

    await engine.syncChannel('chat');

    assert.ok(synchronizedChannels.length > 0);
    assert.ok(synchronizedChannels.every((channel) => channel === 'chat'));
  });

  it('sincroniza Chat enquanto outra conta continua sincronizando', async () => {
    const seed = createSeedData(NOW);
    const emailAccount = seed.accounts.find((account) => account.channel === 'email');
    const chatAccount = seed.accounts.find((account) => account.channel === 'chat');
    assert.ok(emailAccount !== undefined);
    assert.ok(chatAccount !== undefined);
    const store = createAppStore({ contexts: seed.contexts, accounts: [emailAccount, chatAccount] });
    let releaseEmail!: () => void;
    let markEmailStarted!: () => void;
    const emailStarted = new Promise<void>((resolve) => { markEmailStarted = resolve; });
    const emailBlocked = new Promise<void>((resolve) => { releaseEmail = resolve; });
    let chatSyncCount = 0;
    const adapters: MailboxAdapter[] = [
      {
        provider: 'gmail',
        channel: 'email',
        async fetchSince() {
          markEmailStarted();
          await emailBlocked;
          return { messages: [], removedIds: [] };
        }
      },
      {
        provider: 'google-chat',
        channel: 'chat',
        async fetchSince() {
          chatSyncCount += 1;
          return { messages: [], removedIds: [] };
        }
      }
    ];
    const engine = new SyncEngine({ store, adapters, concurrency: 1 });

    const fullSync = engine.syncAll();
    await emailStarted;
    await engine.syncChannel('chat');
    assert.equal(store.getSnapshot().sync.status, 'syncing');
    releaseEmail();
    await fullSync;

    assert.equal(chatSyncCount, 1);
  });
});

describe('contextos', () => {
  it('cria os três presets na ordem correta', () => {
    const contexts = createPresetContexts(NOW);
    assert.deepEqual(
      contexts.map((context) => context.name),
      ['Trabalho', 'Estudos', 'Pessoal']
    );
    assert.deepEqual(
      contexts.map((context) => context.order),
      [0, 1, 2]
    );
  });

  it('remove a conta conectada e as mensagens associadas', () => {
    const store = storeWithSeed();
    const account = store.getSnapshot().accounts[0];
    assert.ok(account !== undefined);

    store.actions.removeAccount(account.id);

    assert.equal(store.accountFor(account.id), undefined);
    assert.ok(store.getSnapshot().messages.every((message) => message.accountId !== account.id));
  });

  it('conta não lidas por contexto ignorando arquivadas', () => {
    const store = storeWithSeed();
    const work = brand.context('work');
    const before = store.unreadForContext(work);
    assert.ok(before > 0);

    const thread = store
      .getFeed()
      .threads.find((item) => item.contextIds.includes(work) && item.channel === 'email');
    assert.ok(thread !== undefined);
    store.actions.markThreadRead(thread.id);
    assert.equal(store.unreadForContext(work), before - thread.unreadCount);
  });

  it('move a conta de contexto e reposiciona as mensagens', () => {
    const store = storeWithSeed();
    const contexts = store.getSnapshot().contexts;
    const studies = contexts.find((context) => context.kind === 'studies');
    const account = store.getSnapshot().accounts.find((item) => item.channel === 'email');
    assert.ok(studies !== undefined);
    assert.ok(account !== undefined);

    store.actions.moveAccountToContext(account.id, studies.id);

    const moved = store.getSnapshot().messages.filter((message) => message.accountId === account.id);
    assert.ok(moved.every((message) => message.contextId === studies.id));
  });

  it('renomeia e silencia contexto', () => {
    const store = storeWithSeed();
    const work = brand.context('work');
    store.actions.renameContext(work, '  Cliente X  ');
    store.actions.setContextMuted(work, true);

    const context = store.getContext(work);
    assert.equal(context?.name, 'Cliente X');
    assert.equal(context?.muted, true);
  });
});

describe('navegação e seleção', () => {
  it('aguarda seleção explícita ao abrir e sincronizar mensagens', () => {
    const seed = createSeedData(NOW);
    const store = createAppStore({ contexts: seed.contexts, accounts: seed.accounts });
    assert.equal(store.getSnapshot().view.channel, 'email');
    assert.equal(store.getSnapshot().view.selectedThreadId, undefined);

    store.actions.upsertMessages(seed.messages);
    assert.equal(store.getSnapshot().view.selectedThreadId, undefined);

    const first = store.getFeed().threads[0];
    assert.ok(first !== undefined);
    store.actions.moveSelection(1);
    assert.equal(store.getSnapshot().view.selectedThreadId, first.id);
    assert.equal(store.getSnapshot().view.selectionPinned, true);
  });

  it('J/K respeitam os limites da lista', () => {
    const store = storeWithSeed();
    const total = store.getFeed().threads.length;

    for (let index = 0; index < total + 3; index += 1) store.actions.moveSelection(1);
    const last = store.getFeed().threads[total - 1];
    assert.equal(store.getSnapshot().view.selectedThreadId, last?.id);

    for (let index = 0; index < total + 3; index += 1) store.actions.moveSelection(-1);
    const first = store.getFeed().threads[0];
    assert.equal(store.getSnapshot().view.selectedThreadId, first?.id);
  });

  it('trocar de contexto limpa a seleção fixada', () => {
    const store = storeWithSeed();
    store.actions.setContext(brand.context('studies'));
    const view = store.getSnapshot().view;
    assert.equal(view.selectionPinned, false);
    assert.equal(view.selectedThreadId, undefined);
  });

  it('abre Enviados como filtro de e-mail e limpa o filtro ao trocar de canal', () => {
    const store = storeWithSeed();
    const thread = store.getFeed().threads.find((item) => item.channel === 'email');
    assert.ok(thread !== undefined);
    store.actions.selectThread(thread.id);

    store.actions.setSentOnly(true);
    assert.equal(store.getSnapshot().view.channel, 'email');
    assert.equal(store.getSnapshot().view.sentOnly, true);
    assert.equal(store.getSnapshot().view.selectedThreadId, undefined);

    store.actions.setChannel('chat');
    assert.equal(store.getSnapshot().view.sentOnly, false);
  });
});

describe('favoritos', () => {
  it('atualiza a conversa imediatamente, preserva a escolha durante sync e impede requisições simultâneas', async () => {
    const seed = createSeedData(NOW);
    const messages = seed.messages.map((message) => ({ ...message, isStarred: false }));
    let finish!: () => void;
    let calls = 0;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    const store = createAppStore({ messages, onSetThreadStarred: async (_message, value) => {
      assert.equal(value, true);
      calls += 1;
      await wait;
    } });
    const thread = store.getFeed().threads.find((item) => item.channel === 'email')!;
    const original = messages.find((message) => message.id === thread.messageIds[0])!;
    const request = store.actions.toggleThreadStar(thread.id);
    assert.equal(store.getThread(thread.id)?.flags.isStarred, true);
    assert.ok(store.getSnapshot().ui.pendingStarThreadIds.includes(thread.id));
    store.actions.upsertMessages([original]);
    assert.equal(store.getThread(thread.id)?.flags.isStarred, true);
    await store.actions.toggleThreadStar(thread.id);
    assert.equal(calls, 1);
    finish();
    await request;
    assert.equal(store.getThread(thread.id)?.flags.isStarred, true);
    assert.equal(store.getSnapshot().ui.pendingStarThreadIds.length, 0);
  });

  it('reverte a alteração e apresenta erro quando o provedor falha', async () => {
    const seed = createSeedData(NOW);
    const messages = seed.messages.map((message) => ({ ...message, isStarred: false }));
    const store = createAppStore({ messages, onSetThreadStarred: async () => { throw new Error('Rede indisponível'); } });
    const thread = store.getFeed().threads.find((item) => item.channel === 'email')!;
    await store.actions.toggleThreadStar(thread.id);
    assert.equal(store.getThread(thread.id)?.flags.isStarred, false);
    assert.match(store.getSnapshot().sync.lastError ?? '', /Rede indisponível/);
    assert.equal(store.getSnapshot().ui.pendingStarThreadIds.length, 0);
  });

  it('filtra somente e-mails favoritos, incluindo arquivados, e restaura a navegação por contexto', () => {
    const seed = createSeedData(NOW);
    const email = seed.messages.find((message) => message.channel === 'email')!;
    assert.equal(email.channel, 'email');
    const chat = seed.messages.find((message) => message.channel === 'chat')!;
    const store = createAppStore({ messages: [{ ...email, folder: 'archived', isStarred: true }, { ...chat, isStarred: true }] });
    store.actions.setStarredOnly(true);
    assert.equal(store.getFeed().threads.length, 1);
    assert.equal(store.getFeed().threads[0]?.channel, 'email');
    store.actions.setContext('all');
    assert.equal(store.getSnapshot().view.starredOnly, false);
  });
});

describe('ação de arquivar', () => {
  it('remove a thread do feed e seleciona a próxima', () => {
    const store = storeWithSeed();
    const target = store
      .getFeed()
      .threads.find((thread) => thread.channel === 'email' && thread.emailFolder !== 'archived');
    assert.ok(target !== undefined);

    const before = store.getFeed().threads.length;
    store.actions.archiveThread(target.id);

    assert.equal(store.getFeed().threads.length, before - 1);
    assert.equal(store.getThread(target.id), undefined);
    assert.notEqual(store.getSnapshot().view.selectedThreadId, target.id);

    const archived = store.getSnapshot().messages.filter((message) => message.id === target.messageIds[0]);
    assert.equal(archived[0]?.channel === 'email' ? archived[0].folder : undefined, 'archived');
  });

  it('arquivar é idempotente em thread já arquivada', () => {
    const store = storeWithSeed();
    const target = store.getFeed().threads.find((thread) => thread.channel === 'email');
    assert.ok(target !== undefined);
    store.actions.archiveThread(target.id);
    const count = store.getFeed().threads.length;
    store.actions.archiveThread(target.id);
    assert.equal(store.getFeed().threads.length, count);
  });
});

describe('ação de excluir', () => {
  it('move o e-mail para a lixeira e limpa a seleção', () => {
    const store = storeWithSeed();
    const target = store.getFeed().threads.find((thread) => thread.channel === 'email');
    assert.ok(target !== undefined);

    store.actions.selectThread(target.id);
    const before = store.getFeed().threads.length;
    store.actions.trashThread(target.id);

    assert.equal(store.getFeed().threads.length, before - 1);
    assert.equal(store.getThread(target.id), undefined);
    assert.notEqual(store.getSnapshot().view.selectedThreadId, target.id);

    const trashed = store.getSnapshot().messages.find((message) => message.id === target.messageIds[0]);
    assert.equal(trashed?.channel === 'email' ? trashed.folder : undefined, 'trash');
  });

  it('não altera conversa de chat', () => {
    const store = storeWithSeed();
    store.actions.setChannel('chat');
    const target = store.getFeed().threads.find((thread) => thread.channel === 'chat');
    assert.ok(target !== undefined);

    store.actions.trashThread(target.id);

    assert.notEqual(store.getThread(target.id), undefined);
  });
});

describe('mensagens', () => {
  it('upsert deduplica por id', () => {
    const store = storeWithSeed();
    const before = store.getSnapshot().messages.length;
    const existing = store.getSnapshot().messages[0];
    assert.ok(existing !== undefined);

    store.actions.upsertMessages([{ ...existing, isRead: true }]);
    assert.equal(store.getSnapshot().messages.length, before);
    assert.equal(store.getSnapshot().messages.find((message) => message.id === existing.id)?.isRead, true);
  });

  it('marcar thread como lida zera o contador de não lidas', () => {
    const store = storeWithSeed();
    const thread = store.getFeed().threads.find((item) => item.unreadCount > 0);
    assert.ok(thread !== undefined);
    store.actions.markThreadRead(thread.id);
    assert.equal(store.getThread(thread.id)?.unreadCount, 0);
  });
});

describe('atalhos de teclado', () => {
  it('resolve J/K/E/R/⌘K', () => {
    assert.equal(resolveShortcut(normalizeEvent({ key: 'j' })), 'next-thread');
    assert.equal(resolveShortcut(normalizeEvent({ key: 'k' })), 'prev-thread');
    assert.equal(resolveShortcut(normalizeEvent({ key: 'e' })), 'archive');
    assert.equal(resolveShortcut(normalizeEvent({ key: 'r' })), 'reply');
    assert.equal(resolveShortcut(normalizeEvent({ key: 'k', metaKey: true })), 'search');
    assert.equal(resolveShortcut(normalizeEvent({ key: 'k', ctrlKey: true })), 'search');
    assert.equal(resolveShortcut(normalizeEvent({ key: '0', ctrlKey: true })), undefined);
  });

  it('não dispara atalho sem modificador enquanto digita', () => {
    assert.equal(shouldIgnoreInEditableTarget('archive', true), true);
    assert.equal(shouldIgnoreInEditableTarget('close', true), false);
    assert.equal(shouldIgnoreInEditableTarget('archive', false), false);
  });

  it('formata atalho por plataforma', () => {
    assert.equal(formatShortcut('search', 'macos'), '⌘K');
    assert.equal(formatShortcut('search', 'windows'), 'Ctrl+K');
    assert.equal(formatShortcut('context-work', 'linux'), 'Alt+2');
  });
});
