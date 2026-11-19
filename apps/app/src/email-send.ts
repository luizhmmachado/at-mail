import { brand } from '@mail/core';
import type { Account, EmailMessage, SendRequest } from '@mail/core';
import type { EmailAttachmentPayload } from './adapters/sync-client';

export interface EmailSendReceipt {
  messageId: string;
  threadId: string;
  receivedAt: number;
  rfcMessageId?: string;
}

export type EmailSendRequest = SendRequest & { attachments?: EmailAttachmentPayload[] };

export function parseEmailSendReceipt(value: unknown): EmailSendReceipt | undefined {
  if (typeof value !== 'object' || value === null) throw new Error('Resposta de envio do Gmail inválida.');
  const result = value as Record<string, unknown>;
  if (result.sent === true && result.messageId === undefined && result.threadId === undefined && result.receivedAt === undefined) return undefined;
  if (
    typeof result.messageId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.messageId) ||
    typeof result.threadId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(result.threadId) ||
    typeof result.receivedAt !== 'number' || !Number.isFinite(result.receivedAt) ||
    (result.rfcMessageId !== undefined && (typeof result.rfcMessageId !== 'string' || !/^<[^<>\s]+>$/.test(result.rfcMessageId)))
  ) throw new Error('O Gmail não retornou os dados da mensagem enviada.');
  return { messageId: result.messageId, threadId: result.threadId, receivedAt: result.receivedAt,
    ...(typeof result.rfcMessageId === 'string' ? { rfcMessageId: result.rfcMessageId } : {}) };
}

export function createLocalEmailMessage(account: Account, input: EmailSendRequest, receipt: EmailSendReceipt): EmailMessage {
  return {
    id: brand.message(`gmail:${account.id}:${receipt.messageId}`),
    accountId: account.id,
    contextId: account.contextId,
    channel: 'email',
    participants: [
      { name: account.displayName || account.email, email: account.email },
      ...input.to.map((email) => ({ name: email, email }))
    ],
    snippet: input.body,
    bodyText: input.body,
    receivedAt: receipt.receivedAt,
    isRead: true,
    isStarred: false,
    isMentioned: false,
    labels: ['SENT'],
    subject: input.subject || '(sem assunto)',
    providerThreadId: receipt.threadId,
    rfcMessageId: receipt.rfcMessageId,
    inReplyTo: input.inReplyTo,
    references: input.inReplyTo ? [input.inReplyTo] : [],
    folder: 'sent',
    attachments: (input.attachments ?? []).map(({ fileName, mimeType, sizeInBytes }, index) => ({
      id: `local-${index}`, fileName, mimeType, sizeInBytes
    }))
  };
}
