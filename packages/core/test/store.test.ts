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

const NOW = 1_770_000_000_000;

function storeWithSeed() {
  const seed = createSeedData(NOW);
  return createAppStore({ contexts: seed.contexts, accounts: seed.accounts, messages: seed.messages });
}

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
