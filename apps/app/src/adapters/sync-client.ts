import { brand } from '@mail/core';
import type { ChatMessage, EmailMessage, MailMessage, MailboxAdapter, SyncPage } from '@mail/core';
import { apiFetch } from '../auth';

export interface SyncEnvelopeDto {
  messages: RawMessageDto[];
  cursor?: string;
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
  folder?: EmailMessage['folder'];
  attachments?: { id: string; fileName: string; mimeType: string; sizeInBytes: number }[];
  spaceId?: string;
  spaceName?: string;
  senderName?: string;
  isDirectMessage?: boolean;
}

export interface SyncRequest {
  accountId: string;
  cursor?: string;
  limit?: number;
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
    const detail = await response.text().catch(() => '');
    throw new Error(`sync ${provider} falhou (${response.status}): ${detail.slice(0, 200)}`);
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
    return chat;
  }

  const email: EmailMessage = {
    ...base,
    channel: 'email',
    subject: dto.subject ?? '(sem assunto)',
    providerThreadId: dto.providerThreadId ?? dto.id,
    references: [],
    folder: dto.folder ?? 'inbox',
    attachments: dto.attachments ?? []
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
    }
  };
}
