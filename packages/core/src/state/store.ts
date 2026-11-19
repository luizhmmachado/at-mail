import { brand } from '../domain/ids';
import type {
  Account,
  AccountId,
  ContextId,
  ContextWorkspace,
  MailMessage,
  MessageId,
  ThreadId,
  UnifiedThread
} from '../domain/models';
import type { ThemeMode } from '../theme/tokens';
import {
  groupingKey,
  selectFeed,
  type ChannelFilter,
  type ContextFilter,
  type FeedResult
} from './feed';

export interface ViewState {
  contextId: ContextFilter;
  channel: ChannelFilter;
  sentOnly: boolean;
  query: string;
  unreadOnly: boolean;
  selectedThreadId?: ThreadId;
  /** `false` significa que a seleção foi automática (primeira da lista). */
  selectionPinned: boolean;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error';
  inFlightAccounts: AccountId[];
  lastSyncedAt?: number;
  lastError?: string;
}

export interface UiState {
  themeMode: ThemeMode;
  commandPaletteOpen: boolean;
  composeOpen: boolean;
  sidebarCollapsed: boolean;
}

export interface AppSnapshot {
  accounts: readonly Account[];
  contexts: readonly ContextWorkspace[];
  messages: readonly MailMessage[];
  view: ViewState;
  sync: SyncState;
  ui: UiState;
}

export type Listener = () => void;

export interface AppStoreOptions {
  accounts?: Account[];
  contexts?: ContextWorkspace[];
  messages?: MailMessage[];
  themeMode?: ThemeMode;
  onMarkMessagesRead?: (messages: readonly MailMessage[], isRead: boolean) => void | Promise<void>;
}

const DEFAULT_UI: UiState = {
  themeMode: 'light',
  commandPaletteOpen: false,
  composeOpen: false,
  sidebarCollapsed: false
};

export const ALL_CONTEXTS: ContextFilter = 'all';

export function createAppStore(options: AppStoreOptions = {}) {
  const onMarkMessagesRead = options.onMarkMessagesRead;
  let snapshot: AppSnapshot = {
    accounts: [],
    contexts: [],
    messages: [],
    view: {
      contextId: ALL_CONTEXTS,
      channel: 'email',
      sentOnly: false,
      query: '',
      unreadOnly: false,
      selectionPinned: false
    },
    sync: { status: 'idle', inFlightAccounts: [] },
    ui: { ...DEFAULT_UI, themeMode: options.themeMode ?? DEFAULT_UI.themeMode }
  };

  if (options.accounts) snapshot.accounts = options.accounts;
  if (options.contexts) snapshot.contexts = options.contexts;
  if (options.messages) snapshot.messages = sortMessages(options.messages);

  const listeners = new Set<Listener>();
  let cachedResult: { messages: readonly MailMessage[]; view: ViewState; feed: FeedResult } | undefined;

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function setSnapshot(next: AppSnapshot): void {
    if (next === snapshot) return;
    snapshot = next;
    emit();
  }

  function patch(partial: Partial<AppSnapshot>): void {
    setSnapshot({ ...snapshot, ...partial });
  }

  function setView(partial: Partial<ViewState>): void {
    const view = { ...snapshot.view, ...partial };
    if (
      partial.contextId !== undefined ||
      partial.channel !== undefined ||
      partial.sentOnly !== undefined ||
      partial.query !== undefined
    ) {
      view.selectionPinned = false;
      view.selectedThreadId = undefined;
    }
    setSnapshot({ ...snapshot, view });
  }

  function feed(): FeedResult {
    if (
      cachedResult !== undefined &&
      cachedResult.messages === snapshot.messages &&
      cachedResult.view === snapshot.view
    ) {
      return cachedResult.feed;
    }
    const result = selectFeed(snapshot.messages, {
      contextId: snapshot.view.contextId,
      channel: snapshot.view.channel,
      sentOnly: snapshot.view.sentOnly,
      query: snapshot.view.query,
      unreadOnly: snapshot.view.unreadOnly
    });
    cachedResult = { messages: snapshot.messages, view: snapshot.view, feed: result };
    return result;
  }

  function ensureSelection(): void {
    const { threads } = feed();
    const current = snapshot.view.selectedThreadId;
    if (current === undefined || threads.some((thread) => thread.id === current)) return;
    patch({ view: { ...snapshot.view, selectedThreadId: undefined, selectionPinned: false } });
  }

  function unreadForContext(contextId: ContextId): number {
    let total = 0;
    for (const message of snapshot.messages) {
      if (message.isRead) continue;
      if (message.contextId !== contextId) continue;
      if (message.channel === 'email' && message.folder === 'archived') continue;
      total += 1;
    }
    return total;
  }

  function upsertMessages(messages: readonly MailMessage[]): void {
    if (messages.length === 0) return;
    const index = new Map<MessageId, MailMessage>(snapshot.messages.map((message) => [message.id, message]));
    for (const message of messages) index.set(message.id, message);
    patch({ messages: sortMessages(Array.from(index.values())) });
    ensureSelection();
  }

  function removeMessages(messageIds: readonly MessageId[]): void {
    if (messageIds.length === 0) return;
    const removed = new Set(messageIds);
    patch({ messages: snapshot.messages.filter((message) => !removed.has(message.id)) });
    ensureSelection();
  }

  function patchMessagesById(messageIds: Iterable<MessageId>, mapper: (message: MailMessage) => MailMessage): void {
    const targets = new Set(messageIds);
    const updated: MailMessage[] = [];
    for (const message of snapshot.messages) {
      if (targets.has(message.id)) updated.push(mapper(message));
    }
    upsertMessages(updated);
  }

  const actions = {
    setContext(contextId: ContextFilter): void {
      setView({ contextId });
      ensureSelection();
    },

    setChannel(channel: ChannelFilter): void {
      setView({ channel, sentOnly: false });
      ensureSelection();
    },

    setSentOnly(sentOnly: boolean): void {
      setView({ channel: sentOnly ? 'email' : snapshot.view.channel, sentOnly });
      ensureSelection();
    },

    setQuery(query: string): void {
      setView({ query });
      ensureSelection();
    },

    setUnreadOnly(unreadOnly: boolean): void {
      setView({ unreadOnly });
      ensureSelection();
    },

    selectThread(threadId: ThreadId | undefined): void {
      patch({
        view: { ...snapshot.view, selectedThreadId: threadId, selectionPinned: threadId !== undefined }
      });
    },

    /** Atalhos J / K. */
    moveSelection(direction: 1 | -1): void {
      const { threads } = feed();
      if (threads.length === 0) return;
      const currentIndex = threads.findIndex((thread) => thread.id === snapshot.view.selectedThreadId);
      const baseIndex = currentIndex < 0 ? (direction === 1 ? -1 : threads.length) : currentIndex;
      const nextIndex = Math.min(threads.length - 1, Math.max(0, baseIndex + direction));
      const nextThread = threads[nextIndex];
      if (nextThread === undefined) return;
      patch({ view: { ...snapshot.view, selectedThreadId: nextThread.id, selectionPinned: true } });
    },

    setThemeMode(themeMode: ThemeMode): void {
      patch({ ui: { ...snapshot.ui, themeMode } });
    },

    toggleCommandPalette(open?: boolean): void {
      const next = open ?? !snapshot.ui.commandPaletteOpen;
      patch({ ui: { ...snapshot.ui, commandPaletteOpen: next } });
    },

    toggleCompose(open?: boolean): void {
      const next = open ?? !snapshot.ui.composeOpen;
      patch({ ui: { ...snapshot.ui, composeOpen: next } });
    },

    toggleSidebar(collapsed?: boolean): void {
      const next = collapsed ?? !snapshot.ui.sidebarCollapsed;
      patch({ ui: { ...snapshot.ui, sidebarCollapsed: next } });
    },

    upsertMessages,

    removeMessages,

    markThreadRead(threadId: ThreadId, isRead = true): void {
      const affected = snapshot.messages.filter((message) => groupingKey(message) === threadId);
      if (affected.length === 0) return;
      patchMessagesById(
        affected.map((message) => message.id),
        (message) => ({ ...message, isRead })
      );
      void onMarkMessagesRead?.(affected, isRead);
    },

    toggleStar(messageId: MessageId): void {
      patchMessagesById([messageId], (message) => ({ ...message, isStarred: !message.isStarred }));
    },

    archiveThread(threadId: ThreadId): void {
      const affected = snapshot.messages.filter(
        (message) => message.channel === 'email' && groupingKey(message) === threadId
      );
      if (affected.length === 0) return;
      patchMessagesById(
        affected.map((message) => message.id),
        (message) => ({ ...message, folder: 'archived' as const, isRead: true })
      );
      if (snapshot.view.selectedThreadId === threadId) {
        patch({ view: { ...snapshot.view, selectedThreadId: undefined, selectionPinned: false } });
        ensureSelection();
      }
    },

    trashThread(threadId: ThreadId): void {
      const affected = snapshot.messages.filter(
        (message) => message.channel === 'email' && groupingKey(message) === threadId
      );
      if (affected.length === 0) return;
      patchMessagesById(
        affected.map((message) => message.id),
        (message) => ({ ...message, folder: 'trash' as const, isRead: true })
      );
      if (snapshot.view.selectedThreadId === threadId) {
        patch({ view: { ...snapshot.view, selectedThreadId: undefined, selectionPinned: false } });
        ensureSelection();
      }
    },

    addContext(context: ContextWorkspace): void {
      if (snapshot.contexts.some((existing) => existing.id === context.id)) return;
      patch({ contexts: [...snapshot.contexts, context].sort(byOrder) });
    },

    renameContext(contextId: ContextId, name: string): void {
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      patch({
        contexts: snapshot.contexts.map((context) =>
          context.id === contextId ? { ...context, name: trimmed, updatedAt: Date.now() } : context
        )
      });
    },

    setContextMuted(contextId: ContextId, muted: boolean): void {
      patch({
        contexts: snapshot.contexts.map((context) =>
          context.id === contextId ? { ...context, muted, updatedAt: Date.now() } : context
        )
      });
    },

    moveAccountToContext(accountId: AccountId, contextId: ContextId): void {
      if (!snapshot.contexts.some((context) => context.id === contextId)) return;
      patch({
        accounts: snapshot.accounts.map((account) =>
          account.id === accountId ? { ...account, contextId, updatedAt: Date.now() } : account
        ),
        messages: snapshot.messages.map((message) =>
          message.accountId === accountId ? { ...message, contextId } : message
        )
      });
    },

    setSyncState(partial: Partial<SyncState>): void {
      patch({ sync: { ...snapshot.sync, ...partial } });
    },

    registerAccount(account: Account): void {
      const exists = snapshot.accounts.some((existing) => existing.id === account.id);
      patch({
        accounts: exists
          ? snapshot.accounts.map((existing) => (existing.id === account.id ? account : existing))
          : [...snapshot.accounts, account]
      });
    },

    replaceAccounts(accounts: readonly Account[]): void {
      patch({ accounts: accounts.slice() });
    },

    removeAccount(accountId: AccountId): void {
      patch({
        accounts: snapshot.accounts.filter((account) => account.id !== accountId),
        messages: snapshot.messages.filter((message) => message.accountId !== accountId)
      });
      ensureSelection();
    }
  };

  return {
    getSnapshot: (): AppSnapshot => snapshot,
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
    getFeed: feed,
    getThread(threadId: ThreadId): UnifiedThread | undefined {
      return feed().threads.find((thread) => thread.id === threadId);
    },
    getThreadMessages(threadId: ThreadId): MailMessage[] {
      return snapshot.messages.filter((message) => groupingKey(message) === threadId);
    },
    getContext(contextId: ContextId): ContextWorkspace | undefined {
      return snapshot.contexts.find((context) => context.id === contextId);
    },
    unreadForContext,
    accountFor(accountId: AccountId): Account | undefined {
      return snapshot.accounts.find((account) => account.id === accountId);
    }
  };
}

export type AppStore = ReturnType<typeof createAppStore>;

function sortMessages(messages: readonly MailMessage[]): MailMessage[] {
  return messages.slice().sort((a, b) => a.receivedAt - b.receivedAt);
}

function byOrder(a: ContextWorkspace, b: ContextWorkspace): number {
  return a.order - b.order;
}

export const CONTEXT_PRESETS = [
  { kind: 'work', name: 'Trabalho', order: 0 },
  { kind: 'studies', name: 'Estudos', order: 1 },
  { kind: 'personal', name: 'Pessoal', order: 2 }
] as const;

export function createPresetContexts(now: number = Date.now()): ContextWorkspace[] {
  return CONTEXT_PRESETS.map((preset) => ({
    id: brand.context(`${preset.kind}`),
    name: preset.name,
    kind: preset.kind,
    order: preset.order,
    notificationPolicy: 'all',
    muted: false,
    createdAt: now,
    updatedAt: now
  }));
}
