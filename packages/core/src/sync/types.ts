import type { Account, ChannelKind, MailMessage, MessageId, ProviderId } from '../domain/models';

export interface SyncPage {
  messages: MailMessage[];
  nextCursor?: string;
  removedIds: MessageId[];
  /** Indica que o provedor exige nova autorização (refresh token inválido/revogado). */
  requiresReauth?: boolean;
}

export interface SendRequest {
  to: string[];
  subject?: string;
  body: string;
  inReplyTo?: string;
}

export interface MailboxAdapter {
  readonly provider: ProviderId;
  readonly channel: ChannelKind;
  /** Leitura incremental: usa o cursor para pedir somente o delta. */
  fetchSince(account: Account, cursor?: string): Promise<SyncPage>;
  archive?(account: Account, messageIds: readonly MessageId[]): Promise<void>;
  markRead?(account: Account, messageIds: readonly MessageId[], isRead: boolean): Promise<void>;
  send?(account: Account, request: SendRequest): Promise<void>;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'network' | 'provider' | 'unknown' = 'unknown',
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
