import type { AccountId, ContextId, MessageId, SecretRef, SpaceId, ThreadId } from './ids';

export type { AccountId, ContextId, MessageId, SecretRef, SpaceId, ThreadId };

export type ProviderId = 'gmail' | 'google-chat' | 'microsoft-graph' | 'imap' | 'icloud';
export type ChannelKind = 'email' | 'chat';
export type TransportKind = 'oauth2-google' | 'oauth2-microsoft' | 'imap-smtp';

export type ConnectionStatus = 'connected' | 'syncing' | 'reauth-required' | 'error' | 'paused';

export interface Account {
  id: AccountId;
  provider: ProviderId;
  channel: ChannelKind;
  transport: TransportKind;
  email: string;
  displayName: string;
  contextId: ContextId;
  status: ConnectionStatus;
  notificationsEnabled?: boolean;
  /** Cursor incremental do provedor (historyId, deltaLink, UIDVALIDITY+UID). */
  syncCursor?: string;
  olderSyncCursor?: string;
  lastSyncedAt?: number;
  lastError?: string;
  secretRef: SecretRef;
  createdAt: number;
  updatedAt: number;
}

export type ContextPresetKind = 'work' | 'studies' | 'personal' | 'custom';

export type NotificationPolicy = 'all' | 'mentions' | 'none';

export interface ContextWorkspace {
  id: ContextId;
  name: string;
  kind: ContextPresetKind;
  /** Ordem de exibição no alternador de contextos. */
  order: number;
  notificationPolicy: NotificationPolicy;
  /** Silencia o contexto inteiro (badge oculto, sem som). */
  muted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Participant {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
}

interface BaseMessage {
  id: MessageId;
  accountId: AccountId;
  contextId: ContextId;
  channel: ChannelKind;
  participants: Participant[];
  snippet: string;
  bodyText: string;
  bodyHtml?: string;
  receivedAt: number;
  isRead: boolean;
  isStarred: boolean;
  isMentioned: boolean;
  labels: string[];
}

export type EmailFolder = 'inbox' | 'sent' | 'draft' | 'archived' | 'trash' | 'spam';

export interface EmailMessage extends BaseMessage {
  channel: 'email';
  subject: string;
  /** Identificador de conversa do provedor (Gmail threadId, Message-Id raiz no IMAP). */
  providerThreadId: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references: string[];
  folder: EmailFolder;
  attachments: Attachment[];
}

export interface ChatReactionSummary {
  emoji: string;
  count: number;
  own?: boolean;
}

export interface ChatMessage extends BaseMessage {
  channel: 'chat';
  spaceId: SpaceId;
  spaceName: string;
  senderName: string;
  isDirectMessage: boolean;
  /** Nome da thread dentro do espaço (quando a mensagem é resposta). */
  threadName?: string;
  /** Resposta na thread, em vez da mensagem que a iniciou. */
  isThreadReply?: boolean;
  reactions?: ChatReactionSummary[];
  attachments?: { id: string; fileName: string; mimeType: string; thumbnailUrl?: string; downloadUrl?: string }[];
}

export type MailMessage = EmailMessage | ChatMessage;

export interface ThreadFlags {
  isStarred: boolean;
  hasAttachments: boolean;
  hasSent: boolean;
  isMentioned: boolean;
  hasUnread: boolean;
}

/**
 * Visão agregada consumida pela lista unificada. É sempre derivada — nunca
 * persistida — para não duplicar estado entre contas e contextos.
 */
export interface UnifiedThread {
  id: ThreadId;
  channel: ChannelKind | 'mixed';
  subject: string;
  snippet: string;
  lastActivityAt: number;
  messageIds: MessageId[];
  accountIds: AccountId[];
  contextIds: ContextId[];
  participants: Participant[];
  unreadCount: number;
  flags: ThreadFlags;
  /** Somente e-mail. */
  emailFolder?: EmailFolder;
  /** Somente chat. */
  spaceId?: SpaceId;
}

export function isEmailMessage(message: MailMessage): message is EmailMessage {
  return message.channel === 'email';
}

export function isChatMessage(message: MailMessage): message is ChatMessage {
  return message.channel === 'chat';
}
