import { brand, SyncError } from '@mail/core';
import type { AccountId, ChatMessage, ContextId, EmailMessage, MailMessage, MailboxAdapter, SendRequest, SyncPage } from '@mail/core';
import { apiFetch } from '../auth';
import { parseChatSendReceipt } from '../chat-send-receipt';
import type { ChatSendReceipt } from '../chat-send-receipt';
import { parseEmailSendReceipt } from '../email-send';
import type { EmailSendReceipt } from '../email-send';

export interface SyncEnvelopeDto {
  messages: RawMessageDto[];
  cursor?: string;
  hasMore?: boolean;
  removedIds?: string[];
  requiresReauth?: boolean;
}

export interface RawMessageDto {
  id: string;
  accountId: string;
  contextId: string;
  channel: 'email' | 'chat';
  participants: { name: string; email: string; avatarUrl?: string }[];
  snippet: string;
  bodyText: string;
  bodyHtml?: string;
  receivedAt: number;
  isRead: boolean;
  isStarred?: boolean;
  isMentioned?: boolean;
  labels?: string[];
  subject?: string;
  providerThreadId?: string;
  rfcMessageId?: string;
  folder?: EmailMessage['folder'];
  attachments?: { id: string; fileName: string; mimeType: string; sizeInBytes?: number; thumbnailUrl?: string; downloadUrl?: string }[];
  spaceId?: string;
  spaceName?: string;
  senderName?: string;
  isDirectMessage?: boolean;
  threadName?: string;
  isThreadReply?: boolean;
  reactions?: { emoji: string; count: number; own?: boolean }[];
}

export interface SyncRequest {
  accountId: string;
  cursor?: string;
  spaceId?: string;
  limit?: number;
}

export interface EmailAttachmentPayload {
  fileName: string;
  mimeType: string;
  sizeInBytes: number;
  base64: string;
}

export async function setThreadStarred(message: EmailMessage, isStarred: boolean): Promise<void> {
  const response = await apiFetch('/messages/star', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: message.accountId, threadId: message.providerThreadId, isStarred })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
}

export async function markMessagesRead(messages: readonly MailMessage[], isRead: boolean): Promise<void> {
  const emailMessages = messages.filter((message): message is EmailMessage => message.channel === 'email');
  const chatMessages = messages.filter((message): message is ChatMessage => message.channel === 'chat');
  const byAccount = new Map<string, string[]>();
  for (const message of emailMessages) {
    const ids = byAccount.get(message.accountId) ?? [];
    ids.push(message.id);
    byAccount.set(message.accountId, ids);
  }
  const requests = Array.from(byAccount, ([accountId, messageIds]) => apiFetch('/messages/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, messageIds, isRead })
  }).then(async (response) => {
    if (!response.ok) throw new Error(`marcar leitura falhou (${response.status})`);
  }));
  const bySpace = new Map<string, { accountId: string; spaceId: string; threadName?: string; messages: ChatMessage[] }>();
  for (const message of chatMessages) {
    const key = `${message.accountId}:${message.spaceId}:${message.threadName ?? 'space'}`;
    const group = bySpace.get(key) ?? { accountId: message.accountId, spaceId: message.spaceId, ...(message.threadName ? { threadName: message.threadName } : {}), messages: [] };
    group.messages.push(message);
    bySpace.set(key, group);
  }
  for (const group of bySpace.values()) {
    const readTimes = group.messages.map((message) => message.receivedAt);
    const lastReadTime = isRead ? Math.max(...readTimes) : Math.max(0, Math.min(...readTimes) - 1);
    requests.push(apiFetch('/messages/read-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountId: group.accountId, spaceId: group.spaceId, threadName: group.threadName, lastReadTime })
    }).then(async (response) => {
      if (!response.ok) throw new Error(`marcar Chat como lido falhou (${response.status})`);
    }));
  }
  await Promise.all(requests);
}

export async function sendEmail(accountId: string, request: SendRequest & { attachments?: EmailAttachmentPayload[] }): Promise<EmailSendReceipt | undefined> {
  const response = await apiFetch('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, ...request })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
  return parseEmailSendReceipt(await response.json());
}

export async function sendChatMessage(accountId: string, recipient: string, body: string, attachments: EmailAttachmentPayload[] = []): Promise<ChatSendReceipt | undefined> {
  const response = await apiFetch('/messages/send-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, recipient, body, attachments })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
  return readChatSendReceipt(response);
}

export async function sendChatReply(accountId: string, spaceId: string, threadName: string | undefined, body: string, attachments: EmailAttachmentPayload[] = []): Promise<ChatSendReceipt | undefined> {
  const response = await apiFetch('/messages/send-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, spaceId, threadName, body, attachments })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
  return readChatSendReceipt(response);
}

async function readChatSendReceipt(response: Response): Promise<ChatSendReceipt | undefined> {
  const result = await response.json().catch(() => undefined);
  return parseChatSendReceipt(result);
}

export async function addChatReaction(accountId: string, messageId: string, emoji: string, remove = false): Promise<void> {
  const response = await apiFetch('/messages/react-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, messageId, emoji, remove })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
}

export async function loadChatImage(accountId: string, attachmentName: string): Promise<string> {
  const response = await apiFetch('/messages/chat-image', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, attachmentName })
  });
  if (!response.ok) throw new Error(await messageResponseError(response));
  const image = await response.json() as { mimeType: string; base64: string };
  return `data:${image.mimeType};base64,${image.base64}`;
}

async function messageResponseError(response: Response): Promise<string> {
  const result = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  return typeof result?.error === 'string' ? result.error : `Não foi possível completar a operação (${response.status}).`;
}

export async function updateAccountContexts(accountIds: readonly AccountId[], contextId: ContextId): Promise<void> {
  const response = await apiFetch('/accounts/context', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountIds, contextId })
  });
  if (!response.ok) throw new Error(`Não foi possível salvar o contexto das contas (${response.status}).`);
}

export async function setAccountNotifications(accountId: string, enabled: boolean): Promise<void> {
  const response = await apiFetch('/accounts/notifications', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, enabled })
  });
  if (!response.ok) throw new Error(`Não foi possível salvar as notificações (${response.status}).`);
}

export async function removeAccount(accountId: string): Promise<void> {
  const response = await apiFetch(`/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Não foi possível remover a conta (${response.status}).`);
}

/**
 * Cliente do backend de sincronização (`/sync/{provider}`).
 *
 * O backend é quem fala com Gmail/Chat API e detém os refresh tokens. No
 * desktop/mobile os tokens podem ficar no Keychain e o adapter pode falar
 * direto com a API do Google; na web o backend é obrigatório.
 */
export async function requestSync(provider: string, request: SyncRequest): Promise<SyncEnvelopeDto> {
  const response = await apiFetch(`/sync/${provider}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const error = response.status === 401
      ? await response.clone().json().catch(() => undefined) as { errorCode?: string } | undefined
      : undefined;
    const detail = await response.text().catch(() => '');
    if (error?.errorCode === 'GOOGLE_AUTH_REVOKED') {
      throw new SyncError('A autorização da conta Google expirou. Faça login novamente.', 'auth');
    }
    const message = `sync ${provider} falhou (${response.status}): ${detail.slice(0, 200)}`;
    if (provider === 'google-chat' && request.cursor && response.status === 400) throw new SyncError(message, 'cursor');
    throw new Error(message);
  }

  return (await response.json()) as SyncEnvelopeDto;
}

export function toSyncPage(envelope: SyncEnvelopeDto, accountId: string): SyncPage {
  const messages = envelope.messages.map((dto) => toMailMessage(dto, accountId));
  const page: SyncPage = {
    messages,
    removedIds: (envelope.removedIds ?? []).map((id) => brand.message(id))
  };
  if (envelope.cursor !== undefined) page.nextCursor = envelope.cursor;
  if (envelope.hasMore === true) page.hasMore = true;
  if (envelope.requiresReauth === true) page.requiresReauth = true;
  return page;
}

export function toMailMessage(dto: RawMessageDto, accountId: string): MailMessage {
  const base = {
    id: brand.message(dto.id),
    accountId: brand.account(dto.accountId || accountId),
    contextId: brand.context(dto.contextId),
    participants: dto.participants,
    snippet: dto.snippet,
    bodyText: dto.bodyText,
    bodyHtml: dto.bodyHtml,
    receivedAt: dto.receivedAt,
    isRead: dto.isRead,
    isStarred: dto.isStarred === true,
    isMentioned: dto.isMentioned === true,
    labels: dto.labels ?? []
  };

  if (dto.channel === 'chat') {
    const chat: ChatMessage = {
      ...base,
      channel: 'chat',
      spaceId: brand.space(dto.spaceId ?? 'desconhecido'),
      spaceName: dto.spaceName ?? 'Chat',
      senderName: dto.senderName ?? dto.participants[0]?.name ?? 'Alguém',
      isDirectMessage: dto.isDirectMessage === true
    };
    if (dto.threadName !== undefined) chat.threadName = dto.threadName;
    if (dto.isThreadReply !== undefined) chat.isThreadReply = dto.isThreadReply;
    if (dto.reactions !== undefined) chat.reactions = dto.reactions;
    if (dto.attachments !== undefined) chat.attachments = dto.attachments;
    return chat;
  }

  const email: EmailMessage = {
    ...base,
    channel: 'email',
    subject: dto.subject ?? '(sem assunto)',
    providerThreadId: dto.providerThreadId ?? dto.id,
    rfcMessageId: dto.rfcMessageId,
    references: [],
    folder: dto.folder ?? 'inbox',
    attachments: (dto.attachments ?? []).map((attachment) => ({ ...attachment, sizeInBytes: attachment.sizeInBytes ?? 0 }))
  };
  return email;
}

export function createHttpAdapter(provider: string, channel: 'email' | 'chat'): MailboxAdapter {
  return {
    provider: provider as MailboxAdapter['provider'],
    channel,
    async fetchSince(account, cursor) {
      const envelope = await requestSync(provider, {
        accountId: account.id,
        cursor,
        limit: 60
      });
      return toSyncPage(envelope, account.id);
    },
    fetchSpace: channel === 'chat' ? async (account, spaceId) => {
      const envelope = await requestSync(provider, { accountId: account.id, spaceId });
      return toSyncPage(envelope, account.id);
    } : undefined
  };
}
