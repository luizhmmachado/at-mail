type MailMessage = any;
type MessageId = string;
const brand = { message: (value: string) => value, account: (value: string) => value, context: (value: string) => value, space: (value: string) => value };
import type { Db } from './db.js';
import { decrypt } from './crypto.js';
import { refreshAccessToken } from './google.js';
import type { SyncConfig } from './config.js';

interface Credential { encrypted_refresh_token: string; email: string }

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
  input: { to: string[]; subject?: string; body: string; inReplyTo?: string }
): Promise<void> {
  const token = await accessToken(db, config, userId, accountId);
  const headers = [
    `To: ${input.to.join(', ')}`,
    `Subject: ${input.subject ?? ''}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`, `References: ${input.inReplyTo}`] : [])
  ];
  const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${input.body}`, 'utf8').toString('base64url');
  await googleJsonRequest('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', token, {
    method: 'POST',
    body: JSON.stringify({ raw })
  });
}

function decodeBase64Url(value: string | undefined): string {
  if (!value) return '';
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function header(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function bodyFromPayload(payload: any): string {
  const plainPart = (payload?.parts ?? []).find((part: any) => part?.mimeType === 'text/plain');
  if (plainPart) {
    const text = bodyFromPayload(plainPart);
    if (text) return text;
  }
  if (payload?.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === 'text/html' ? htmlToText(decoded) : decoded;
  }
  for (const part of payload?.parts ?? []) {
    const text = bodyFromPayload(part);
    if (text) return text;
  }
  return '';
}

function htmlToText(value: string): string {
  return value
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, '$2 ($1)')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function fetchGmail(db: Db, config: SyncConfig, userId: string, accountId: string, contextId: string, cursor?: string): Promise<{ messages: MailMessage[]; cursor?: string; removedIds: MessageId[] }> {
  const token = await accessToken(db, config, userId, accountId);
  const list = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`, token);
  const messages: MailMessage[] = [];
  for (const item of list.messages ?? []) {
    const message = await googleJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`, token);
    const payload = message.payload ?? {};
    const headers = payload.headers ?? [];
    const from = header(headers, 'From') || 'Google Gmail';
    const to = header(headers, 'To');
    const subject = header(headers, 'Subject') || '(sem assunto)';
    const date = Date.parse(header(headers, 'Date')) || Date.now();
    const labels: string[] = message.labelIds ?? [];
    const folder = labels.includes('TRASH') ? 'trash' : labels.includes('SPAM') ? 'spam' : labels.includes('SENT') ? 'sent' : labels.includes('INBOX') ? 'inbox' : 'archived';
    messages.push({ id: brand.message(`gmail:${accountId}:${message.id}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'email', participants: [{ name: from, email: from.match(/<([^>]+)>/)?.[1] ?? from }].concat(to ? [{ name: to, email: to }] : []), snippet: message.snippet ?? '', bodyText: bodyFromPayload(payload), receivedAt: date, isRead: !labels.includes('UNREAD'), isStarred: labels.includes('STARRED'), isMentioned: false, labels, subject, providerThreadId: message.threadId ?? message.id, rfcMessageId: header(headers, 'Message-ID'), references: [], folder, attachments: [] });
  }
  return { messages, cursor: list.nextPageToken, removedIds: [] };
}

export async function fetchChat(db: Db, config: SyncConfig, userId: string, accountId: string, contextId: string): Promise<{ messages: MailMessage[]; removedIds: MessageId[] }> {
  const token = await accessToken(db, config, userId, accountId);
  const spaces = await googleJson('https://chat.googleapis.com/v1/spaces?pageSize=100', token);
  const messages: MailMessage[] = [];
  for (const space of spaces.spaces ?? []) {
    const page = await googleJson(`https://chat.googleapis.com/v1/${space.name}/messages?pageSize=100`, token);
    for (const item of page.messages ?? []) {
      const sender = item.sender?.displayName ?? 'Google Chat';
      messages.push({ id: brand.message(`chat:${accountId}:${item.name}`), accountId: brand.account(accountId), contextId: brand.context(contextId), channel: 'chat', participants: [{ name: sender, email: item.sender?.email ?? sender }], snippet: item.text ?? '', bodyText: item.text ?? '', receivedAt: Date.parse(item.createTime ?? '') || Date.now(), isRead: true, isStarred: false, isMentioned: (item.text ?? '').includes('@'), labels: [], spaceId: brand.space(space.name), spaceName: space.displayName ?? space.name, senderName: sender, isDirectMessage: space.spaceType === 'DIRECT_MESSAGE' });
    }
  }
  return { messages, removedIds: [] };
}
