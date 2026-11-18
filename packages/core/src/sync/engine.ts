import type { Account, AccountId } from '../domain/models';
import type { AppStore } from '../state/store';
import { SyncError, type MailboxAdapter } from './types';

export interface SyncEngineOptions {
  store: AppStore;
  adapters?: MailboxAdapter[];
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
  private running?: Promise<SyncOutcome[]>;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.concurrency = Math.max(1, options.concurrency ?? 3);
    this.now = options.now ?? Date.now;
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

  syncAccount(accountId: AccountId): Promise<SyncOutcome> {
    const account = this.store.accountFor(accountId);
    if (account === undefined) {
      return Promise.resolve({ accountId, newMessages: 0, ok: false, error: 'conta inexistente' });
    }
    return this.runAccount(account);
  }

  /** Evita sincronizações concorrentes duplicadas na mesma sessão. */
  syncAll(): Promise<SyncOutcome[]> {
    if (this.running !== undefined) return this.running;
    this.running = this.runAll().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async runAll(): Promise<SyncOutcome[]> {
    const accounts = this.store
      .getSnapshot()
      .accounts.filter((account) => account.status !== 'reauth-required' && account.status !== 'paused');

    this.store.actions.setSyncState({ status: 'syncing', inFlightAccounts: accounts.map((a) => a.id) });

    const results: SyncOutcome[] = [];
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < accounts.length) {
        const account = accounts[cursor];
        cursor += 1;
        if (account === undefined) break;
        results.push(await this.runAccount(account));
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.concurrency, accounts.length) }, worker));

    const failed = results.filter((result) => !result.ok);
    this.store.actions.setSyncState({
      status: failed.length > 0 ? 'error' : 'idle',
      inFlightAccounts: [],
      lastSyncedAt: this.now(),
      lastError: failed[0]?.error
    });

    return results;
  }

  private async runAccount(account: Account): Promise<SyncOutcome> {
    const adapter = this.adapterFor(account);
    if (adapter === undefined) {
      this.markAccount(account.id, { status: 'error', lastError: 'adaptador não registrado' });
      return { accountId: account.id, newMessages: 0, ok: false, error: 'adaptador não registrado' };
    }

    this.markAccount(account.id, { status: 'syncing' });

    try {
      const page = await adapter.fetchSince(account, account.syncCursor);
      this.store.actions.removeMessages(page.removedIds);
      this.store.actions.upsertMessages(page.messages);
      this.markAccount(account.id, {
        status: page.requiresReauth === true ? 'reauth-required' : 'connected',
        syncCursor: page.nextCursor ?? account.syncCursor,
        lastSyncedAt: page.requiresReauth === true ? account.lastSyncedAt : this.now(),
        lastError: undefined
      });
      return { accountId: account.id, newMessages: page.messages.length, ok: true };
    } catch (error) {
      const isAuth = error instanceof SyncError && error.kind === 'auth';
      const message = error instanceof Error ? error.message : 'falha desconhecida';
      this.markAccount(account.id, { status: isAuth ? 'reauth-required' : 'error', lastError: message });
      return { accountId: account.id, newMessages: 0, ok: false, error: message };
    }
  }

  private markAccount(
    accountId: AccountId,
    patch: Partial<Pick<Account, 'status' | 'lastError' | 'lastSyncedAt' | 'syncCursor'>>
  ): void {
    const account = this.store.accountFor(accountId);
    if (account === undefined) return;
    this.store.actions.registerAccount({
      ...account,
      ...patch,
      lastError: patch.lastError,
      updatedAt: this.now()
    });
  }
}
