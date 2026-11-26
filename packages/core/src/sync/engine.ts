import type { Account, AccountId, ChannelKind } from '../domain/models';
import type { AppStore } from '../state/store';
import { SyncError, type MailboxAdapter, type SyncPage } from './types';

export interface SyncEngineOptions {
  store: AppStore;
  adapters?: MailboxAdapter[];
  onNewMessages?: (account: Account, messages: readonly import('../domain/models').MailMessage[]) => void;
  /** Máximo de contas sincronizadas em paralelo (protege CPU e quota de API). */
  concurrency?: number;
  now?: () => number;
}

interface SyncOutcome {
  accountId: AccountId;
  newMessages: number;
  ok: boolean;
  error?: string;
}

/**
 * Orquestra a sincronização das contas registradas.
 *
 * - Sincronização incremental por cursor, conta a conta.
 * - Erros de autenticação pausam a conta em vez de martelar a API.
 * - `syncAll` roda em paralelo limitado e sempre conclui o `sync.status`.
 */
export class SyncEngine {
  private readonly store: AppStore;
  private readonly adapters = new Map<string, MailboxAdapter>();
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly onNewMessages?: SyncEngineOptions['onNewMessages'];
  private readonly runningAccounts = new Map<AccountId, Promise<SyncOutcome>>();
  private readonly runningSpaces = new Map<string, Promise<SyncOutcome>>();
  private readonly runningOlderAccounts = new Map<AccountId, Promise<SyncOutcome>>();
  private readonly accountSyncVersions = new Map<AccountId, number>();
  private activeSyncRuns = 0;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.now = options.now ?? Date.now;
    this.onNewMessages = options.onNewMessages;
    for (const adapter of options.adapters ?? []) this.register(adapter);
  }

  register(adapter: MailboxAdapter): void {
    this.adapters.set(`${adapter.provider}:${adapter.channel}`, adapter);
  }

  adapterFor(account: Account): MailboxAdapter | undefined {
    const direct = this.adapters.get(`${account.provider}:${account.channel}`);
    if (direct !== undefined) return direct;
    return this.adapters.get(`${account.provider}:${account.channel === 'email' ? 'email' : 'chat'}`);
  }

  async syncAccount(accountId: AccountId, options: { afterCurrent?: boolean } = {}): Promise<SyncOutcome> {
    if (options.afterCurrent) await this.runningAccounts.get(accountId);
    const account = this.store.accountFor(accountId);
    if (account === undefined) {
      return { accountId, newMessages: 0, ok: false, error: 'conta inexistente' };
    }
    return this.runAccountOnce(account);
  }

  syncAll(): Promise<SyncOutcome[]> {
    return this.runAll();
  }

  syncSpace(accountId: AccountId, spaceId: string): Promise<SyncOutcome> {
    const key = JSON.stringify([accountId, spaceId]);
    const running = this.runningSpaces.get(key);
    if (running !== undefined) return running;
    const account = this.store.accountFor(accountId);
    if (account === undefined) {
      return Promise.resolve({ accountId, newMessages: 0, ok: false, error: 'conta inexistente' });
    }
    const request = this.runAccount(account, spaceId).finally(() => this.runningSpaces.delete(key));
    this.runningSpaces.set(key, request);
    return request;
  }

  syncChannel(channel: ChannelKind): Promise<SyncOutcome[]> {
    return this.runAll(channel);
  }

  syncOlder(accountId: AccountId): Promise<SyncOutcome> {
    const running = this.runningOlderAccounts.get(accountId);
    if (running !== undefined) return running;
    const account = this.store.accountFor(accountId);
    if (account === undefined || account.olderSyncCursor === undefined) {
      return Promise.resolve({ accountId, newMessages: 0, ok: true });
    }
    const adapter = this.adapterFor(account);
    if (adapter?.fetchOlder === undefined) {
      return Promise.resolve({ accountId, newMessages: 0, ok: false, error: 'adaptador não suporta páginas anteriores' });
    }
    const request = adapter.fetchOlder(account, account.olderSyncCursor)
      .then((page) => {
        this.store.actions.upsertMessages(page.messages);
        this.markAccount(accountId, {
          ...(page.olderCursor ? { olderSyncCursor: page.olderCursor } : { olderSyncCursor: undefined }),
          lastError: undefined
        });
        return { accountId, newMessages: page.messages.length, ok: true };
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'falha desconhecida';
        this.markAccount(accountId, { lastError: message });
        return { accountId, newMessages: 0, ok: false, error: message };
      })
      .finally(() => this.runningOlderAccounts.delete(accountId));
    this.runningOlderAccounts.set(accountId, request);
    return request;
  }

  private async runAll(channel?: ChannelKind): Promise<SyncOutcome[]> {
    this.activeSyncRuns += 1;
    const accounts = this.store
      .getSnapshot()
      .accounts.filter((account) => account.status !== 'reauth-required' && account.status !== 'paused' && (channel === undefined || account.channel === channel));

    this.store.actions.setSyncState({ status: 'syncing', inFlightAccounts: accounts.map((a) => a.id) });

    const syncVersions = new Map(accounts.map((account) => [account.id, this.accountSyncVersions.get(account.id) ?? 0]));
    const results: SyncOutcome[] = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < accounts.length) {
        const account = accounts[cursor];
        cursor += 1;
        if (account === undefined) break;
        if ((this.accountSyncVersions.get(account.id) ?? 0) !== syncVersions.get(account.id)) continue;
        results.push(await this.runAccountOnce(account));
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.concurrency, accounts.length) }, worker));

    const failed = results.filter((result) => !result.ok);
    this.activeSyncRuns -= 1;
    this.store.actions.setSyncState({
      status: this.activeSyncRuns > 0 || this.runningAccounts.size > 0 ? 'syncing' : failed.length > 0 ? 'error' : 'idle',
      inFlightAccounts: Array.from(this.runningAccounts.keys()),
      lastSyncedAt: this.now(),
      lastError: failed[0]?.error
    });

    return results;
  }

  private runAccountOnce(account: Account): Promise<SyncOutcome> {
    const running = this.runningAccounts.get(account.id);
    if (running !== undefined) return running;
    const request = this.runAccount(account).finally(() => {
      this.runningAccounts.delete(account.id);
      this.accountSyncVersions.set(account.id, (this.accountSyncVersions.get(account.id) ?? 0) + 1);
      if (this.activeSyncRuns > 0) {
        this.store.actions.setSyncState({ status: 'syncing', inFlightAccounts: Array.from(this.runningAccounts.keys()) });
      }
    });
    this.runningAccounts.set(account.id, request);
    return request;
  }

  private async runAccount(account: Account, spaceId?: string): Promise<SyncOutcome> {
    const adapter = this.adapterFor(account);
    if (adapter === undefined) {
      this.markAccount(account.id, { status: 'error', lastError: 'adaptador não registrado' });
      return { accountId: account.id, newMessages: 0, ok: false, error: 'adaptador não registrado' };
    }

    if (spaceId === undefined) this.markAccount(account.id, { status: 'syncing' });

    try {
      const startedAt = this.now();
      let cursor = account.syncCursor;
      let received = 0;
      const visitedCursors = new Set([cursor]);
      for (;;) {
        let page: SyncPage;
        if (spaceId === undefined) {
          page = await adapter.fetchSince(account, cursor);
        } else {
          if (adapter.fetchSpace === undefined) throw new SyncError('adaptador não suporta sincronização por espaço');
          page = await adapter.fetchSpace(account, spaceId);
        }
        if (this.store.accountFor(account.id) === undefined) {
          return { accountId: account.id, newMessages: received, ok: true };
        }
        const hasMore = spaceId === undefined && page.hasMore === true && page.requiresReauth !== true;
        if (hasMore && (!page.nextCursor || visitedCursors.has(page.nextCursor))) throw new SyncError('cursor de sincronização não avançou');
        const knownIds = new Set(this.store.getSnapshot().messages.map((message) => message.id));
        const newMessages = page.messages.filter((message) => !knownIds.has(message.id));
        this.store.actions.removeMessages(page.removedIds);
        this.store.actions.upsertMessages(page.messages);
        received += page.messages.length;
        if (account.lastSyncedAt !== undefined && newMessages.length > 0) {
          try {
            this.onNewMessages?.(account, newMessages.filter((message) => message.receivedAt > (account.lastSyncedAt ?? 0)));
          } catch {}
        }
        cursor = page.nextCursor ?? cursor;
        visitedCursors.add(cursor);
        this.markAccount(account.id, {
          status: page.requiresReauth === true ? 'reauth-required' : 'connected',
          ...(page.olderCursor ? { olderSyncCursor: page.olderCursor } : {}),
          ...(spaceId === undefined ? {
            syncCursor: cursor,
            lastSyncedAt: hasMore || page.requiresReauth === true ? account.lastSyncedAt : startedAt
          } : {}),
          lastError: undefined
        });
        if (!hasMore) break;
      }
      return { accountId: account.id, newMessages: received, ok: true };
    } catch (error) {
      const isAuth = error instanceof SyncError && error.kind === 'auth';
      const isRateLimited = error instanceof SyncError && error.kind === 'rate-limit';
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      this.markAccount(account.id, {
        status: isAuth ? 'reauth-required' : isRateLimited ? 'connected' : 'error', lastError: message,
        ...(error instanceof SyncError && error.kind === 'cursor' ? { syncCursor: '' } : {})
      });
      return { accountId: account.id, newMessages: 0, ok: false, error: message };
    }
  }

  private markAccount(
    accountId: AccountId,
    patch: Partial<Pick<Account, 'status' | 'lastError' | 'lastSyncedAt' | 'syncCursor' | 'olderSyncCursor'>>
  ): void {
    const account = this.store.accountFor(accountId);
    if (account === undefined) return;
    if (account.status === 'reauth-required' && patch.status !== 'reauth-required') return;
    this.store.actions.registerAccount({
      ...account,
      ...patch,
      lastError: patch.lastError,
      updatedAt: this.now()
    });
  }
}
