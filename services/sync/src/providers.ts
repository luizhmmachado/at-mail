type MailMessage = any;
type MessageId = string;
const brand = { message: (value: string) => value, account: (value: string) => value, context: (value: string) => value, space: (value: string) => value };
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { decrypt } from './crypto.js';
import { refreshAccessToken } from './google.js';
import type { SyncConfig } from './config.js';

interface Credential { encrypted_refresh_token: string; email: string }

export interface GmailAttachmentPayload {
  fileName: string;
  mimeType: string;
  base64: string;
}

async function accessToken(db: Db, config: SyncConfig, userId: string, accountId: string): Promise<string> {
  const row = (await db.query<Credential>('SELECT encrypted_refresh_token, email FROM atmail_credentials WHERE account_id = $1 AND user_id = $2', [accountId, userId])).rows[0];
  if (!row) throw new Error('conta Google não conectada');
  return refreshAccessToken(decrypt(row.encrypted_refresh_token, config.encryptionKey), config.clientId, config.clientSecret);
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
  if (!response.ok) throw new Error(`Google API ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  return json;
}

function providerMessageId(id: string): string {
  return id.slice(id.lastIndexOf(':') + 1);
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

export async function sendGmail(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { to: string[]; subject?: string; body: string; inReplyTo?: string; attachments?: GmailAttachmentPayload[] }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const raw = createGmailRawMessage(input);
  await googleJsonRequest('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, {
    method: 'POST',
    body: JSON.stringify({ raw })
  });
}

export function createGmailRawMessage(input: {
  to: string[];
  subject?: string;
  body: string;
  inReplyTo?: string;
  attachments?: GmailAttachmentPayload[];
}): string {
  const subject = encodeMimeHeader((input.subject ?? '').replace(/[\r\n]/g, ' '));
  const headers = [
    `To: ${input.to.join(', ')}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0'
  ];
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`);

  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8').toString('base64url');
  }

  const boundary = `=_atmail_${randomUUID().replace(/-/g, '')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(input.body, 'utf8').toString('base64'))
  ];

  for (const attachment of attachments) {
    const fileName = attachment.fileName.replace(/[\r\n"]/g, '_').slice(0, 180) || 'anexo';
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
  parts.push(`--${boundary}--`, '');
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
  input: { recipient: string; body: string }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const requestId = randomUUID();
  const space = await googleJsonRequest('https://chat.googleapis.com/v1/spaces:setup', token, {
    method: 'POST',
    body: JSON.stringify(createDirectMessageSetupRequest(input.recipient, requestId))
  });
  const spaceName = typeof space.name === 'string' ? space.name : '';
  if (!/^spaces\/[A-Za-z0-9._-]+$/.test(spaceName)) throw new Error('O Google Chat não retornou um espaço de conversa válido.');
  await googleJsonRequest(`https://chat.googleapis.com/v1/${spaceName}/messages?requestId=${randomUUID()}`, token, {
    method: 'POST',
    body: JSON.stringify({ text: input.body })
  });
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
  input: { spaceName: string; threadName?: string; body: string }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const url = new URL(`https://chat.googleapis.com/v1/${input.spaceName}/messages`);
  url.searchParams.set('requestId', randomUUID());
  if (input.threadName) url.searchParams.set('messageReplyOption', 'REPLY_MESSAGE_OR_FAIL');
  await googleJsonRequest(url.toString(), token, {
    method: 'POST',
    body: JSON.stringify(chatReplyRequest(input.body, input.threadName))
  });
}

export function chatReactionRequest(emoji: string): { emoji: { unicode: string } } {
  return { emoji: { unicode: emoji } };
}

export async function createChatReaction(
  db: Db,
  config: SyncConfig,
  userId: string,
  accountId: string,
  input: { messageName: string; emoji: string }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  await googleJsonRequest(`https://chat.googleapis.com/v1/${input.messageName}/reactions`, token, {
    method: 'POST',
    body: JSON.stringify(chatReactionRequest(input.emoji))
  });
}

export function chatSpaceReadStateUrl(spaceName: string): string {
  return `https://chat.googleapis.com/v1/users/me/${spaceName}/spaceReadState`;
}

export function chatSpaceReadStateRequest(spaceName: string, lastReadTime: number): { name: string; lastReadTime: string } {
  return {
    name: `users/me/${spaceName}/spaceReadState`,
    lastReadTime: new Date(lastReadTime).toISOString()
  };
}

export function isChatMessageRead(receivedAt: number, lastReadTime: number, readStateAvailable: boolean): boolean {
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
  url.searchParams.set('historyTypes', 'messageAdded');
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
    const list = await googleJson(gmailMessagesUrl(), token);
    messageIds = (list.messages ?? []).map((item: any) => item.id).filter((id: unknown): id is string => typeof id === 'string');
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
    nextCursor = newerHistoryId(nextCursor, message.historyId);
    return { id: brand.message(`gmail:${accountId}:${message.id}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'email' as const, participants: [{ name: from, email: from.match(/<([^>]+)>/)?.[1] ?? from }].concat(to ? [{ name: to, email: to }] : []), snippet: message.snippet ?? '', ...bodies, receivedAt: date, isRead: !labels.includes('UNREAD'), isStarred: labels.includes('STARRED'), isMentioned: false, labels, subject, providerThreadId: message.threadId ?? message.id, rfcMessageId: header(headers, 'Message-ID'), references: [], folder, attachments: [] };
  });

  if (nextCursor.length === 0) {
    const profile = await googleJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', token);
    nextCursor = typeof profile.historyId === 'string' ? profile.historyId : '';
  }
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
  url.searchParams.set('fields', 'messages(name,text,createTime,sender(name,displayName,email,avatarUrl),thread(name),emojiReactionSummaries(emoji(unicode),reactionCount)),nextPageToken');
  return url.toString();
}

export async function fetchChat(db: Db, config: SyncConfig, userId: string, accountId: string, contextId: string): Promise<{ messages: MailMessage[]; removedIds: MessageId[] }> {
  const token = await accessToken(db, config, userId, accountId);
  const currentUser = (await db.query<{ name: string | null }>('SELECT name FROM atmail_users WHERE id = $1', [userId])).rows[0];
  const spaces = await googleJson('https://chat.googleapis.com/v1/spaces?pageSize=100', token);
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
      pages[index] = { messagePage, lastReadTime, readStateAvailable };
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
          ? [{ emoji, count: Number(reaction.reactionCount) || 0 }]
          : [];
      });
      messages.push({ id: brand.message(`chat:${accountId}:${item.name}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'chat', participants: [participant], snippet: item.text ?? '', bodyText: item.text ?? '', receivedAt, isRead: item.sender?.name === 'users/me' || isChatMessageRead(receivedAt, result.lastReadTime, result.readStateAvailable), isStarred: false, isMentioned: (item.text ?? '').includes('@'), labels: [], spaceId: brand.space(space.name), spaceName, senderName: sender, isDirectMessage: space.spaceType === 'DIRECT_MESSAGE', ...(item.thread?.name ? { threadName: item.thread.name } : {}), reactions });
    }
  }
  return { messages, removedIds: [] };
}
