type MailMessage = any;
type MessageId = string;
const brand = { message: (value: string) => value, account: (value: string) => value, context: (value: string) => value, space: (value: string) => value };
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { decrypt } from './crypto.js';
import { refreshAccessToken, SyncError } from './google.js';
import type { SyncConfig } from './config.js';

interface Credential { encrypted_refresh_token: string; email: string }

export interface GmailAttachmentPayload {
  fileName: string;
  mimeType: string;
  base64: string;
}

async function accessToken(db: Db, config: SyncConfig, userId: string, accountId: string): Promise<string> {
  const row = (await db.query<Credential>('SELECT encrypted_refresh_token, email FROM atmail_credentials WHERE account_id = $1 AND user_id = $2', [accountId, userId])).rows[0];
  if (!row) throw new SyncError('conta Google não conectada', 'auth');
  return refreshAccessToken(decrypt(row.encrypted_refresh_token, config.encryptionKey), config.clientId, config.clientSecret);
}

export async function fetchChatImage(db: Db, config: SyncConfig, userId: string, accountId: string, attachmentName: string): Promise<{ mimeType: string; base64: string }> {
  const token = await accessToken(db, config, userId, accountId);
  const attachment = await googleJson(`https://chat.googleapis.com/v1/${attachmentName}`, token) as { contentType?: string; attachmentDataRef?: { resourceName?: string } };
  const mimeType = attachment.contentType?.toLowerCase();
  const resourceName = attachment.attachmentDataRef?.resourceName;
  if (!mimeType || !/^image\/(?:png|jpeg|gif|webp|bmp|avif)$/.test(mimeType) || !resourceName) throw new Error('Imagem do Chat indisponível.');
  const path = resourceName.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://chat.googleapis.com/v1/media/${path}?alt=media`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = new Error(`Google media: ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  const maxBytes = 8 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Imagem excede o limite de visualização.');
  if (!response.body) throw new Error('Imagem do Chat indisponível.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Imagem excede o limite de visualização.');
    }
    chunks.push(value);
  }
  return { mimeType, base64: Buffer.concat(chunks).toString('base64') };
}

async function googleJson(url: string, token: string): Promise<any> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const json = await response.json() as any;
  if (!response.ok) {
    const error = new Error(`Google API ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return json;
}

async function googleJsonRequest(url: string, token: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const json = await response.json() as any;
  if (!response.ok) {
    const error = new Error(`Google API ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return json;
}

function providerMessageId(id: string): string {
  return id.slice(id.lastIndexOf(':') + 1);
}

export async function setGmailThreadStarred(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  threadId: string,
  isStarred: boolean
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  await googleJsonRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    token,
    { method: 'POST', body: JSON.stringify(isStarred ? { addLabelIds: ['STARRED'] } : { removeLabelIds: ['STARRED'] }) }
  );
}

export async function markGmailMessagesRead(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  messageIds: readonly string[],
  isRead: boolean
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  await Promise.all(messageIds.map((id) => googleJsonRequest(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId(id))}/modify`,
    token,
    { method: 'POST', body: JSON.stringify(isRead ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] }) }
  )));
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@,;<>()[\]\\"]+@[^\s@,;<>()[\]\\"]+\.[^\s@,;<>()[\]\\"]+$/;

/** Validação de destinatário usada tanto na API quanto na montagem do MIME. */
export function isValidEmailAddress(value: string): boolean {
  return value.length > 0 && value.length <= 254 && EMAIL_ADDRESS_PATTERN.test(value);
}

function safeHeaderValue(value: string, label: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`cabeçalho de e-mail inválido: ${label}`);
  return value;
}

export async function sendGmail(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { to: string[]; subject?: string; body: string; bodyHtml?: string; inReplyTo?: string; providerThreadId?: string; attachments?: GmailAttachmentPayload[] }
): Promise<{ messageId: string; threadId: string; receivedAt: number; rfcMessageId: string }> {
  const token = await accessToken(db, config, userId, accountId);
  const rfcMessageId = `<${randomUUID()}@atmail.local>`;
  const raw = createGmailRawMessage({ ...input, rfcMessageId });
  const message = await googleJsonRequest('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, {
    method: 'POST',
    body: JSON.stringify({ raw, ...(input.providerThreadId ? { threadId: input.providerThreadId } : {}) })
  });
  if (typeof message.id !== 'string' || !message.id || typeof message.threadId !== 'string' || !message.threadId) {
    throw new Error('O Gmail não retornou os identificadores da mensagem enviada.');
  }
  return { messageId: message.id, threadId: message.threadId, receivedAt: Date.now(), rfcMessageId };
}

export function createGmailRawMessage(input: {
  to: string[];
  subject?: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  rfcMessageId?: string;
  attachments?: GmailAttachmentPayload[];
}): string {
  const subject = encodeMimeHeader((input.subject ?? '').replace(/[\r\n]/g, ' '));
  // Cada destinatário entra no cabeçalho To: — CR/LF aqui permitiria injetar
  // cabeçalhos extras (Bcc, Content-Type) a partir de um endereço recebido.
  const recipients = input.to.map((address) => safeHeaderValue(address.trim(), 'To'));
  for (const address of recipients) {
    if (!isValidEmailAddress(address)) throw new Error('destinatário de e-mail inválido');
  }
  if (recipients.length === 0) throw new Error('destinatário de e-mail obrigatório');
  const headers = [
    `To: ${recipients.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0'
  ];
  const inReplyTo = input.inReplyTo === undefined ? undefined : safeHeaderValue(input.inReplyTo.trim(), 'In-Reply-To');
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  if (input.rfcMessageId) headers.push(`Message-ID: ${safeHeaderValue(input.rfcMessageId.trim(), 'Message-ID')}`);

  const attachments = input.attachments ?? [];
  if (attachments.length === 0 && input.bodyHtml === undefined) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8').toString('base64url');
  }

  const boundary = `=_atmail_${randomUUID().replace(/-/g, '')}`;
  const alternativeBoundary = input.bodyHtml === undefined ? undefined : `=_atmail_${randomUUID().replace(/-/g, '')}`;
  headers.push(`Content-Type: multipart/${attachments.length > 0 ? 'mixed' : 'alternative'}; boundary="${attachments.length > 0 ? boundary : alternativeBoundary}"`);
  const parts: string[] = [];
  if (attachments.length > 0) parts.push(`--${boundary}`);
  if (alternativeBoundary !== undefined) {
    if (attachments.length > 0) parts.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, '');
    parts.push(`--${alternativeBoundary}`);
  }
  parts.push(
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(input.body, 'utf8').toString('base64'))
  );
  if (alternativeBoundary !== undefined && input.bodyHtml !== undefined) {
    parts.push(`--${alternativeBoundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrapBase64(Buffer.from(input.bodyHtml, 'utf8').toString('base64')), `--${alternativeBoundary}--`);
  }

  for (const attachment of attachments) {
    if (/[\r\n]/.test(attachment.fileName)) throw new Error('nome de anexo inválido');
    if (!/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/.test(attachment.mimeType)) throw new Error('tipo de anexo inválido');
    const fileName = attachment.fileName.replace(/["]/g, '_').slice(0, 180) || 'anexo';
    const fallbackName = fileName.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(fileName);
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType}; name="${fallbackName}"; name*=UTF-8''${encodedName}`,
      `Content-Disposition: attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(attachment.base64)
    );
  }
  if (attachments.length > 0) parts.push(`--${boundary}--`);
  parts.push('');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`, 'utf8').toString('base64url');
}

function encodeMimeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function wrapBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join('\r\n') ?? '';
}

export async function sendChat(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { recipient: string; body: string; attachments?: GmailAttachmentPayload[] }
): Promise<ChatSendReceipt> {
  const token = await accessToken(db, config, userId, accountId);
  let space: any;
  try {
    space = await googleJson(chatDirectMessageUrl(input.recipient), token);
  } catch (error) {
    if ((error as Error & { status?: number }).status !== 404) throw error;
    try {
      space = await googleJsonRequest('https://chat.googleapis.com/v1/spaces:setup', token, {
        method: 'POST',
        body: JSON.stringify(createDirectMessageSetupRequest(input.recipient, randomUUID()))
      });
    } catch (setupError) {
      const details = setupError instanceof Error ? setupError.message : '';
      if ((setupError as Error & { status?: number }).status === 404 && details.includes('Google Chat app not found')) {
        throw new Error('Não há uma conversa direta existente. Para iniciar uma nova, configure o app Google Chat e ative a API Chat no Google Cloud.');
      }
      throw setupError;
    }
  }
  const spaceName = typeof space.name === 'string' ? space.name : '';
  if (!/^spaces\/[A-Za-z0-9._-]+$/.test(spaceName)) throw new Error('O Google Chat não retornou um espaço de conversa válido.');
  const attachments = await uploadChatAttachments(token, spaceName, input.attachments ?? []);
  const message = await googleJsonRequest(`https://chat.googleapis.com/v1/${spaceName}/messages?requestId=${randomUUID()}`, token, {
    method: 'POST',
    body: JSON.stringify({ text: input.body, ...(attachments.length ? { attachment: attachments } : {}) })
  });
  return chatSendReceipt(spaceName, message);
}

export interface ChatSendReceipt {
  messageName: string;
  spaceResourceName: string;
  receivedAt: number;
}

export function chatSendReceipt(spaceResourceName: string, message: unknown): ChatSendReceipt {
  const result = message as { name?: unknown; createTime?: unknown } | null;
  const messageName = typeof result?.name === 'string' ? result.name : '';
  if (!/^spaces\/[A-Za-z0-9._-]+\/messages\/[A-Za-z0-9._-]+$/.test(messageName) || !messageName.startsWith(`${spaceResourceName}/messages/`)) {
    throw new Error('O Google Chat não retornou uma mensagem enviada válida.');
  }
  const createTime = typeof result?.createTime === 'string' ? Date.parse(result.createTime) : Number.NaN;
  return { messageName, spaceResourceName, receivedAt: Number.isFinite(createTime) ? createTime : Date.now() };
}

export function chatDirectMessageUrl(recipient: string): string {
  const url = new URL('https://chat.googleapis.com/v1/spaces:findDirectMessage');
  url.searchParams.set('name', `users/${recipient}`);
  return url.toString();
}

export function createDirectMessageSetupRequest(recipient: string, requestId: string): {
  requestId: string;
  space: { spaceType: 'DIRECT_MESSAGE'; singleUserBotDm: false };
  memberships: { member: { name: string; type: 'HUMAN' } }[];
} {
  return {
    requestId,
    space: { spaceType: 'DIRECT_MESSAGE', singleUserBotDm: false },
    memberships: [{ member: { name: `users/${recipient}`, type: 'HUMAN' } }]
  };
}

export function chatReplyRequest(body: string, threadName?: string): { text: string; thread?: { name: string } } {
  return threadName ? { text: body, thread: { name: threadName } } : { text: body };
}

export async function sendChatToSpace(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { spaceName: string; threadName?: string; body: string; attachments?: GmailAttachmentPayload[] }
): Promise<ChatSendReceipt> {
  const token = await accessToken(db, config, userId, accountId);
  const url = new URL(`https://chat.googleapis.com/v1/${input.spaceName}/messages`);
  url.searchParams.set('requestId', randomUUID());
  if (input.threadName) url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_OR_FAIL');
  const attachments = await uploadChatAttachments(token, input.spaceName, input.attachments ?? []);
  const message = await googleJsonRequest(url.toString(), token, {
    method: 'POST',
    body: JSON.stringify({ ...chatReplyRequest(input.body, input.threadName), ...(attachments.length ? { attachment: attachments } : {}) })
  });
  return chatSendReceipt(input.spaceName, message);
}

async function uploadChatAttachments(token: string, spaceName: string, attachments: GmailAttachmentPayload[]): Promise<unknown[]> {
  const uploaded: unknown[] = [];
  for (const attachment of attachments) {
    const boundary = `atmail-${randomUUID()}`;
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ filename: attachment.fileName })}\r\n--${boundary}\r\nContent-Type: ${attachment.mimeType}\r\n\r\n`),
      Buffer.from(attachment.base64, 'base64'),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const result = await googleJsonRequest(`https://chat.googleapis.com/upload/v1/${spaceName}/attachments:upload?uploadType=multipart`, token, {
      method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: payload
    });
    if (!result.attachmentDataRef?.attachmentUploadToken) throw new Error('O Google Chat não retornou o anexo enviado.');
    uploaded.push({ attachmentDataRef: result.attachmentDataRef });
  }
  return uploaded;
}

export function chatReactionRequest(emoji: string): { emoji: { unicode: string } } {
  return { emoji: { unicode: emoji } };
}

const ownReactionCache = new Map<string, { expiresAt: number; reactions: { name: string; emoji: string }[] }>();

async function ownChatReactions(token: string, accountId: string, messageName: string): Promise<{ name: string; emoji: string }[]> {
  const accountMatch = /^google:([A-Za-z0-9_-]+):chat$/.exec(accountId);
  if (!accountMatch) return [];
  const key = `${accountId}:${messageName}`;
  const cached = ownReactionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.reactions;
  const reactions: { name: string; emoji: string }[] = [];
  let pageToken = '';
  do {
    const url = new URL(`https://chat.googleapis.com/v1/${messageName}/reactions`);
    url.searchParams.set('filter', `user.name = "users/${accountMatch[1]}"`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await googleJson(url.toString(), token);
    for (const reaction of page.reactions ?? []) {
      if (typeof reaction.name === 'string' && typeof reaction.emoji?.unicode === 'string') reactions.push({ name: reaction.name, emoji: reaction.emoji.unicode });
    }
    pageToken = typeof page.nextPageToken === 'string' ? page.nextPageToken : '';
  } while (pageToken);
  if (ownReactionCache.size >= 1000) ownReactionCache.clear();
  ownReactionCache.set(key, { expiresAt: Date.now() + 30000, reactions });
  return reactions;
}

export async function createChatReaction(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { messageName: string; emoji: string; remove?: boolean }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  if (input.remove) {
    ownReactionCache.delete(`${accountId}:${input.messageName}`);
    const reactions = await ownChatReactions(token, accountId, input.messageName);
    const reaction = reactions.find((item) => item.emoji === input.emoji);
    if (reaction && reaction.name.startsWith(`${input.messageName}/reactions/`) && /^spaces\/[A-Za-z0-9._-]+\/messages\/[A-Za-z0-9._-]+\/reactions\/[A-Za-z0-9._-]+$/.test(reaction.name)) {
      await googleJsonRequest(`https://chat.googleapis.com/v1/${reaction.name}`, token, { method: 'DELETE' });
    }
  } else {
    await googleJsonRequest(`https://chat.googleapis.com/v1/${input.messageName}/reactions`, token, {
      method: 'POST',
      body: JSON.stringify(chatReactionRequest(input.emoji))
    });
  }
  ownReactionCache.delete(`${accountId}:${input.messageName}`);
}

export function chatSpaceReadStateUrl(spaceName: string): string {
  return `https://chat.googleapis.com/v1/users/me/${spaceName}/spaceReadState`;
}

export function chatThreadReadStateUrl(threadName: string): string {
  return `https://chat.googleapis.com/v1/users/me/${threadName}/threadReadState`;
}

export function chatSpaceReadStateRequest(spaceName: string, lastReadTime: number): { name: string; lastReadTime: string } {
  return {
    name: `users/me/${spaceName}/spaceReadState`,
    lastReadTime: new Date(lastReadTime).toISOString()
  };
}

export function isChatMessageRead(receivedAt: number, lastReadTime: number, readStateAvailable: boolean, threadLastReadTime?: number): boolean {
  if (threadLastReadTime !== undefined) return receivedAt <= threadLastReadTime;
  return readStateAvailable && receivedAt <= lastReadTime;
}

export async function markChatSpaceRead(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  spaceName: string,
  lastReadTime: number
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const url = new URL(chatSpaceReadStateUrl(spaceName));
  url.searchParams.set('updateMask', 'lastReadTime');
  await googleJsonRequest(url.toString(), token, {
    method: 'PATCH',
    body: JSON.stringify(chatSpaceReadStateRequest(spaceName, lastReadTime))
  });
}

export async function markChatThreadRead(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  spaceName: string,
  threadName: string,
  lastReadTime: number
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const url = new URL(chatThreadReadStateUrl(threadName));
  url.searchParams.set('updateMask', 'lastReadTime');
  const timestamp = new Date(lastReadTime).toISOString();
  await googleJsonRequest(url.toString(), token, {
    method: 'PATCH',
    body: JSON.stringify({ name: `users/me/${threadName}/threadReadState`, lastReadTime: timestamp })
  });
  await db.query(
    'INSERT INTO atmail_chat_thread_read_states (user_id, account_id, space_id, thread_name, last_read_time, updated_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT(user_id, account_id, thread_name) DO UPDATE SET last_read_time = excluded.last_read_time, updated_at = excluded.updated_at',
    [userId, accountId, spaceName, threadName, lastReadTime, Date.now()]
  );
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function findBodyPart(payload: any, mimeType: string): string | undefined {
  if (!payload || payload.filename) return undefined;
  const disposition = payload.headers?.find((item: any) => item?.name?.toLowerCase() === 'content-disposition')?.value;
  if (typeof disposition === 'string' && /^attachment\b/i.test(disposition)) return undefined;
  if (payload.mimeType?.toLowerCase() === mimeType && payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const body = findBodyPart(part, mimeType);
    if (body !== undefined) return body;
  }
  return undefined;
}

export function extractGmailBodies(payload: any): { bodyText: string; bodyHtml?: string } {
  const bodyHtml = findBodyPart(payload, 'text/html');
  const plainText = findBodyPart(payload, 'text/plain');
  const bodyText = plainText || (bodyHtml ? htmlToText(bodyHtml) : '');
  return bodyHtml === undefined ? { bodyText } : { bodyText, bodyHtml };
}

function htmlToText(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, '$2 ($1)')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => decodeCodePoint(Number.parseInt(code, 16)))
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeCodePoint(value: number): string {
  return value <= 0x10ffff ? String.fromCodePoint(value) : '\uFFFD';
}

export function gmailMessagesUrl(): string {
  return 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50';
}

export function gmailHistoryUrl(startHistoryId: string, pageToken?: string): string {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history');
  url.searchParams.set('startHistoryId', startHistoryId);
  for (const type of ['messageAdded', 'labelAdded', 'labelRemoved']) url.searchParams.append('historyTypes', type);
  if (pageToken) url.searchParams.set('pageToken', pageToken);
  return url.toString();
}

export function gmailAddedMessageIds(history: any): string[] {
  const ids = new Set<string>();
  for (const record of history.history ?? []) {
    for (const addition of record.messagesAdded ?? []) {
      const id = addition.message?.id;
      if (typeof id === 'string') ids.add(id);
    }
    for (const change of [...(record.labelsAdded ?? []), ...(record.labelsRemoved ?? [])]) {
      const id = change.message?.id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

function newerHistoryId(current: string, candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) return current;
  if (current.length === 0) return candidate;
  try {
    return BigInt(candidate) > BigInt(current) ? candidate : current;
  } catch {
    return current;
  }
}

async function mapWithConcurrency<T, R>(values: readonly T[], concurrency: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await map(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export async function fetchGmail(db: Db, config: SyncConfig, userId: string, accountId: string, contextId: string, cursor?: string): Promise<{ messages: MailMessage[]; cursor: string; removedIds: MessageId[] }> {
  const token = await accessToken(db, config, userId, accountId);
  let messageIds: string[] | undefined;
  let nextCursor = '';

  if (cursor) {
    try {
      const addedIds = new Set<string>();
      let pageToken: string | undefined;
      do {
        const history = await googleJson(gmailHistoryUrl(cursor, pageToken), token);
        nextCursor = newerHistoryId(nextCursor, history.historyId);
        for (const id of gmailAddedMessageIds(history)) addedIds.add(id);
        pageToken = history.nextPageToken;
      } while (pageToken);
      messageIds = [...addedIds];
      if (messageIds.length === 0) return { messages: [], cursor: nextCursor || cursor, removedIds: [] };
    } catch (error) {
      if ((error as Error & { status?: number }).status !== 404) throw error;
      messageIds = undefined;
      nextCursor = '';
    }
  }

  if (messageIds === undefined) {
    const profile = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', token);
    nextCursor = typeof profile.historyId === 'string' ? profile.historyId : '';
    const list = await googleJson(gmailMessagesUrl(), token);
    const ids = new Set<string>((list.messages ?? []).map((item: any) => item.id).filter((id: unknown): id is string => typeof id === 'string'));
    let pageToken: string | undefined;
    do {
      const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('q', 'is:starred');
      url.searchParams.set('maxResults', '500');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const starred = await googleJson(url.toString(), token);
      for (const item of starred.messages ?? []) if (typeof item.id === 'string') ids.add(item.id);
      pageToken = starred.nextPageToken;
    } while (pageToken);
    messageIds = [...ids];
  }

  const messages = await mapWithConcurrency(messageIds ?? [], 8, async (id) => {
    const message = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, token);
    const payload = message.payload ?? {};
    const headers = payload.headers ?? [];
    const from = header(headers, 'From') || 'Google Gmail';
    const to = header(headers, 'To');
    const subject = header(headers, 'Subject') || '(sem assunto)';
    const date = Date.parse(header(headers, 'Date')) || Date.now();
    const labels: string[] = message.labelIds ?? [];
    const folder = labels.includes('TRASH') ? 'trash' : labels.includes('SPAM') ? 'spam' : labels.includes('SENT') ? 'sent' : labels.includes('INBOX') ? 'inbox' : 'archived';
    const bodies = extractGmailBodies(payload);
    return { id: brand.message(`gmail:${accountId}:${message.id}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'email' as const, participants: [{ name: from, email: from.match(/<([^>]+)>/)?.[1] ?? from }].concat(to ? [{ name: to, email: to }] : []), snippet: message.snippet ?? '', ...bodies, receivedAt: date, isRead: !labels.includes('UNREAD'), isStarred: labels.includes('STARRED'), isMentioned: false, labels, subject, providerThreadId: message.threadId ?? message.id, rfcMessageId: header(headers, 'Message-ID'), references: [], folder, attachments: [] };
  });

  return { messages, cursor: nextCursor, removedIds: [] };
}

export function resolveChatSpaceName(
  space: { name?: string; displayName?: string; spaceType?: string },
  messages: readonly { sender?: { name?: string; displayName?: string } }[],
  userId: string,
  currentUserName?: string | null
): string {
  const displayName = space.displayName?.trim();
  if (displayName) return displayName;

  const ownName = currentUserName?.trim().toLocaleLowerCase();
  const participantNames = new Set<string>();
  for (const message of messages) {
    const sender = message.sender;
    const name = sender?.displayName?.trim();
    if (!name || sender?.name === 'users/me' || sender?.name === `users/${userId}`) continue;
    if (ownName && name.toLocaleLowerCase() === ownName) continue;
    participantNames.add(name);
  }

  if (participantNames.size > 0) {
    return space.spaceType === 'DIRECT_MESSAGE'
      ? participantNames.values().next().value ?? space.name ?? 'Chat'
      : [...participantNames].join(', ');
  }
  return space.name ?? 'Chat';
}

export function chatMessagesUrl(spaceName: string): string {
  const url = new URL(`https://chat.googleapis.com/v1/${spaceName}/messages`);
  url.searchParams.set('pageSize', '100');
  url.searchParams.set('orderBy', 'createTime desc');
  url.searchParams.set('fields', 'messages(name,text,createTime,threadReply,sender(name,displayName,email,avatarUrl),thread(name),attachment(name,contentName,contentType,thumbnailUri,downloadUri),emojiReactionSummaries(emoji(unicode),reactionCount)),nextPageToken');
  return url.toString();
}

export async function fetchChat(db: Db, config: SyncConfig, userId: string, accountId: string, contextId: string, options: { cursor?: string; spaceId?: string } = {}): Promise<{ messages: MailMessage[]; removedIds: MessageId[]; cursor: string; hasMore: boolean }> {
  const token = await accessToken(db, config, userId, accountId);
  const currentUser = (await db.query<{ name: string | null }>('SELECT name FROM atmail_users WHERE id = $1', [userId])).rows[0];
  const savedThreadStates = (await db.query<{ thread_name: string; last_read_time: string }>(
    'SELECT thread_name, last_read_time FROM atmail_chat_thread_read_states WHERE user_id = $1 AND account_id = $2',
    [userId, accountId]
  )).rows;
  const threadReadTimes = new Map(savedThreadStates.map((state) => [state.thread_name, Number(state.last_read_time)]));
  const spacesUrl = new URL('https://chat.googleapis.com/v1/spaces');
  spacesUrl.searchParams.set('pageSize', '5');
  if (options.cursor) spacesUrl.searchParams.set('pageToken', options.cursor);
  const spaces = options.spaceId
    ? { spaces: [await googleJson(`https://chat.googleapis.com/v1/${options.spaceId}`, token)] }
    : await googleJson(spacesUrl.toString(), token);
  const spaceList = (spaces.spaces ?? []).filter((space: any) => typeof space?.name === 'string');
  const pages = new Array<any>(spaceList.length);
  let nextIndex = 0;
  const fetchWorker = async (): Promise<void> => {
    while (nextIndex < spaceList.length) {
      const index = nextIndex;
      nextIndex += 1;
      const space = spaceList[index];
      if (space === undefined) continue;
      const messagePage = await googleJson(chatMessagesUrl(space.name), token);
      let lastReadTime = 0;
      let readStateAvailable = true;
      try {
        const readState = await googleJson(chatSpaceReadStateUrl(space.name), token);
        lastReadTime = Date.parse(readState.lastReadTime ?? '') || 0;
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (status === 403) readStateAvailable = false;
        else if (status !== 404) throw error;
      }
      const items = (messagePage.messages ?? []).filter((item: any) => item.emojiReactionSummaries?.length > 0 && typeof item.name === 'string');
      const ownReactions = new Map<string, { name: string; emoji: string }[]>();
      let reactionIndex = 0;
      await Promise.all(Array.from({ length: Math.min(5, items.length) }, async () => {
        while (reactionIndex < items.length) {
          const item = items[reactionIndex++];
          ownReactions.set(item.name, await ownChatReactions(token, accountId, item.name));
        }
      }));
      pages[index] = { messagePage, lastReadTime, readStateAvailable, ownReactions };
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, spaceList.length) }, fetchWorker));
  const messages: MailMessage[] = [];
  for (let index = 0; index < spaceList.length; index += 1) {
    const space = spaceList[index];
    const result = pages[index];
    if (space === undefined || result === undefined) continue;
    const page = result.messagePage;
    const spaceName = resolveChatSpaceName(space, page.messages ?? [], userId, currentUser?.name);
    for (const item of page.messages ?? []) {
      const sender = item.sender?.displayName ?? 'Google Chat';
      const receivedAt = Date.parse(item.createTime ?? '') || Date.now();
      const participant = {
        name: sender,
        email: item.sender?.email ?? sender,
        ...(typeof item.sender?.avatarUrl === 'string' ? { avatarUrl: item.sender.avatarUrl } : {})
      };
      const reactions = (item.emojiReactionSummaries ?? []).flatMap((reaction: any) => {
        const emoji = reaction.emoji?.unicode;
        return typeof emoji === 'string' && emoji.length > 0
          ? [{ emoji, count: Number(reaction.reactionCount) || 0, own: result.ownReactions.get(item.name)?.some((own: { emoji: string }) => own.emoji === emoji) === true }]
          : [];
      });
      const threadName = typeof item.thread?.name === 'string' ? item.thread.name : undefined;
      const attachments = (item.attachment ?? []).flatMap((attachment: any) => {
        if (typeof attachment.name !== 'string') return [];
        const downloadUrl = typeof attachment.downloadUri === 'string' && attachment.downloadUri.startsWith('https://') ? attachment.downloadUri : undefined;
        const thumbnailUrl = typeof attachment.thumbnailUri === 'string' && attachment.thumbnailUri.startsWith('https://') ? attachment.thumbnailUri : undefined;
        return [{ id: attachment.name, fileName: attachment.contentName ?? 'Arquivo', mimeType: attachment.contentType ?? 'application/octet-stream', ...(downloadUrl ? { downloadUrl } : {}), ...(thumbnailUrl ? { thumbnailUrl } : {}) }];
      });
      const lastReadTime = threadName === undefined ? undefined : threadReadTimes.get(threadName);
      const isRead = item.sender?.name === 'users/me' || isChatMessageRead(receivedAt, result.lastReadTime, result.readStateAvailable, lastReadTime);
      messages.push({ id: brand.message(`chat:${accountId}:${item.name}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'chat', participants: [participant], snippet: item.text ?? '', bodyText: item.text ?? '', receivedAt, isRead, isStarred: false, isMentioned: (item.text ?? '').includes('@'), labels: [], spaceId: brand.space(space.name), spaceName, senderName: sender, isDirectMessage: space.spaceType === 'DIRECT_MESSAGE', ...(threadName ? { threadName, isThreadReply: item.threadReply === true } : {}), reactions, attachments });
    }
  }
  return { messages, removedIds: [], cursor: spaces.nextPageToken ?? '', hasMore: Boolean(spaces.nextPageToken) };
}
