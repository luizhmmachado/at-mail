import { brand } from '../domain/ids';
import type {
  AccountId,
  ChatMessage,
  ContextId,
  EmailFolder,
  EmailMessage,
  MailMessage,
  Participant,
  ThreadId,
  UnifiedThread
} from '../domain/models';

export interface ChatMessageThread {
  id: string;
  root?: ChatMessage;
  threadName?: string;
  replies: ChatMessage[];
}

export function groupChatMessageThreads(messages: readonly MailMessage[]): ChatMessageThread[] {
  const groups = new Map<string, ChatMessage[]>();
  const sorted = messages.filter((message): message is ChatMessage => message.channel === 'chat')
    .sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id));
  for (const message of sorted) {
    const key = JSON.stringify([message.accountId, message.spaceId, message.threadName ?? message.id]);
    const group = groups.get(key) ?? [];
    group.push(message);
    groups.set(key, group);
  }
  return Array.from(groups, ([id, group]) => {
    const first = group[0]!;
    // Older persisted messages have no reply flag; use chronological order only for those.
    const root = group.find((message) => message.isThreadReply === false)
      ?? group.find((message) => message.isThreadReply !== true);
    return { id, root, threadName: first.threadName, replies: group.filter((message) => message !== root) };
  }).sort((a, b) =>
    (a.root ?? a.replies[0]!).receivedAt - (b.root ?? b.replies[0]!).receivedAt || a.id.localeCompare(b.id)
  );
}

export type ChannelFilter = 'all' | 'email' | 'chat';
export type ContextFilter = ContextId | 'all';

export interface FeedQuery {
  contextId: ContextFilter;
  channel: ChannelFilter;
  query: string;
  includeArchived?: boolean;
  includeSent?: boolean;
  includeTrashed?: boolean;
  sentOnly?: boolean;
  unreadOnly?: boolean;
  starredOnly?: boolean;
}

export interface FeedResult {
  threads: UnifiedThread[];
  totalUnread: number;
  unreadByChannel: Record<'email' | 'chat', number>;
  threadCountByContext: Record<string, number>;
}

const ARCHIVED_FOLDER: EmailFolder = 'archived';

export function groupingKey(message: MailMessage): ThreadId {
  if (message.channel === 'email') {
    const providerThread = message.providerThreadId || message.id;
    return brand.thread(`email:${message.accountId}:${providerThread}`);
  }
  return brand.thread(`chat:${message.accountId}:${message.spaceId}`);
}

function mergeParticipants(existing: Participant[], incoming: Participant[]): Participant[] {
  if (incoming.length === 0) return existing;
  const merged = existing.slice();
  for (const participant of incoming) {
    const key = participant.email.toLowerCase();
    const existingIndex = merged.findIndex((current) => current.email.toLowerCase() === key);
    if (existingIndex < 0) {
      merged.push(participant);
      continue;
    }
    const current = merged[existingIndex];
    if (current !== undefined && current.avatarUrl === undefined && participant.avatarUrl !== undefined) {
      merged[existingIndex] = { ...current, avatarUrl: participant.avatarUrl };
    }
  }
  return merged;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isSentMessage(message: MailMessage): boolean {
  return (
    message.channel === 'email' &&
    message.folder !== 'trash' &&
    message.folder !== 'spam' &&
    (message.folder === 'sent' || message.labels.includes('SENT'))
  );
}

/**
 * Converte mensagens brutas (e-mail + chat, várias contas) em threads unificadas.
 * Determinístico: mesma entrada, mesma ordem de saída.
 */
export function buildUnifiedThreads(messages: readonly MailMessage[]): UnifiedThread[] {
  const threads = new Map<ThreadId, UnifiedThread>();
  const inboxThreadIds = new Set<ThreadId>();

  for (const message of messages) {
    const id = groupingKey(message);
    if (message.channel === 'email' && message.folder === 'inbox') inboxThreadIds.add(id);
    const existing = threads.get(id);

    if (existing === undefined) {
      threads.set(id, createThread(id, message));
      continue;
    }

    existing.messageIds.push(message.id);
    existing.accountIds = unique([...existing.accountIds, message.accountId]);
    existing.contextIds = unique([...existing.contextIds, message.contextId]);
    existing.participants = mergeParticipants(existing.participants, message.participants);
    existing.unreadCount += message.isRead ? 0 : 1;
    existing.flags = {
      isStarred: existing.flags.isStarred || message.isStarred,
      hasAttachments:
        existing.flags.hasAttachments || (message.channel === 'email' && message.attachments.length > 0),
      hasSent: existing.flags.hasSent || isSentMessage(message),
      isMentioned: existing.flags.isMentioned || message.isMentioned,
      hasUnread: existing.unreadCount > 0
    };

    if (message.receivedAt >= existing.lastActivityAt) {
      existing.lastActivityAt = message.receivedAt;
      existing.snippet = message.snippet;
      if (message.channel === 'email') {
        existing.subject = message.subject;
        existing.emailFolder = message.folder;
      } else if (existing.channel === 'chat') {
        existing.subject = message.spaceName;
      }
    }
  }

  for (const id of inboxThreadIds) {
    const thread = threads.get(id);
    if (thread?.emailFolder === 'sent') thread.emailFolder = 'inbox';
  }
  return Array.from(threads.values()).sort(compareThreads);
}

function createThread(id: ThreadId, message: MailMessage): UnifiedThread {
  const unreadCount = message.isRead ? 0 : 1;
  const thread: UnifiedThread = {
    id,
    channel: message.channel,
    subject: message.channel === 'email' ? message.subject : message.spaceName,
    snippet: message.snippet,
    lastActivityAt: message.receivedAt,
    messageIds: [message.id],
    accountIds: [message.accountId],
    contextIds: [message.contextId],
    participants: message.participants.slice(),
    unreadCount,
    flags: {
      isStarred: message.isStarred,
      hasAttachments: message.channel === 'email' && message.attachments.length > 0,
      hasSent: isSentMessage(message),
      isMentioned: message.isMentioned,
      hasUnread: unreadCount > 0
    }
  };

  if (message.channel === 'email') {
    thread.emailFolder = message.folder;
  } else {
    thread.spaceId = message.spaceId;
  }

  return thread;
}

function compareThreads(a: UnifiedThread, b: UnifiedThread): number {
  if (a.lastActivityAt !== b.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface SearchClause {
  field: 'text' | 'from' | 'context' | 'channel' | 'unread' | 'starred' | 'attachment' | 'folder';
  value: string;
}

const SEARCH_PREFIXES: Record<string, SearchClause['field']> = {
  from: 'from',
  de: 'from',
  context: 'context',
  contexto: 'context',
  in: 'channel',
  channel: 'channel',
  canal: 'channel',
  is: 'unread',
  folder: 'folder',
  has: 'attachment'
};

export function parseQuery(raw: string): SearchClause[] {
  const clauses: SearchClause[] = [];
  const terms = raw.trim().split(/\s+/).filter(Boolean);

  for (const term of terms) {
    const separator = term.indexOf(':');
    if (separator > 0) {
      const prefix = term.slice(0, separator).toLowerCase();
      const value = term.slice(separator + 1).toLowerCase();
      const field = SEARCH_PREFIXES[prefix];
      if (field !== undefined && value.length > 0) {
        if (field === 'unread' && value !== 'unread' && value !== 'nao-lido') {
          clauses.push({ field: 'starred', value });
          continue;
        }
        if (field === 'attachment') {
          clauses.push({ field: value === 'attachment' || value === 'anexo' ? 'attachment' : 'text', value });
          continue;
        }
        clauses.push({ field, value });
        continue;
      }
    }
    clauses.push({ field: 'text', value: term.toLowerCase() });
  }

  return clauses;
}

function threadHaystack(thread: UnifiedThread): string {
  if (thread.channel === 'chat') return thread.subject.toLowerCase();
  const parts = [thread.subject, thread.snippet, ...thread.participants.map((p) => `${p.name} ${p.email}`)];
  return parts.join(' ').toLowerCase();
}

function matchesClause(thread: UnifiedThread, clause: SearchClause): boolean {
  switch (clause.field) {
    case 'text':
      return threadHaystack(thread).includes(clause.value);
    case 'from':
      if (thread.channel === 'chat') return thread.subject.toLowerCase().includes(clause.value);
      return thread.participants.some(
        (participant) =>
          participant.email.toLowerCase().includes(clause.value) ||
          participant.name.toLowerCase().includes(clause.value)
      );
    case 'context':
      return thread.contextIds.some((contextId) => contextId.toLowerCase().includes(clause.value));
    case 'channel':
      return thread.channel === clause.value || (thread.channel === 'mixed' && clause.value !== 'all');
    case 'unread':
      return thread.unreadCount > 0;
    case 'starred':
      return thread.flags.isStarred;
    case 'attachment':
      return thread.flags.hasAttachments;
    case 'folder':
      return thread.emailFolder === clause.value;
    default:
      return true;
  }
}

export function matchesQuery(thread: UnifiedThread, rawQuery: string): boolean {
  if (rawQuery.trim().length === 0) return true;
  return parseQuery(rawQuery).every((clause) => matchesClause(thread, clause));
}

function isVisible(thread: UnifiedThread, query: FeedQuery): boolean {
  if (query.contextId !== 'all' && !thread.contextIds.includes(query.contextId)) return false;
  if (query.channel !== 'all' && thread.channel !== query.channel && thread.channel !== 'mixed') return false;
  if (query.unreadOnly === true && thread.unreadCount === 0) return false;
  if (query.starredOnly === true && (thread.channel !== 'email' || !thread.flags.isStarred)) return false;
  if (query.query.trim().length > 0 && !matchesQuery(thread, query.query)) return false;

  if (query.sentOnly === true) {
    if (!thread.flags.hasSent) return false;
  } else {
    const isArchived = thread.emailFolder === ARCHIVED_FOLDER;
    if (isArchived && query.includeArchived !== true && query.starredOnly !== true) return false;
    if (thread.emailFolder === 'sent' && query.includeSent !== true && query.starredOnly !== true) return false;
    if (thread.emailFolder === 'trash' && query.includeTrashed !== true) return false;
  }

  return true;
}

/** Pipeline completo: agrupa, filtra por contexto/canal/busca e ordena. */
export function selectFeed(messages: readonly MailMessage[], query: FeedQuery): FeedResult {
  const threads = buildUnifiedThreads(messages);
  const visible = threads.filter((thread) => isVisible(thread, query));

  const unreadByChannel = { email: 0, chat: 0 };
  const threadCountByContext: Record<string, number> = {};
  let totalUnread = 0;

  for (const thread of visible) {
    totalUnread += thread.unreadCount;
    for (const contextId of thread.contextIds) {
      threadCountByContext[contextId] = (threadCountByContext[contextId] ?? 0) + 1;
    }
    if (thread.unreadCount > 0) {
      if (thread.channel === 'chat') unreadByChannel.chat += thread.unreadCount;
      else if (thread.channel === 'email') unreadByChannel.email += thread.unreadCount;
    }
  }

  return { threads: visible, totalUnread, unreadByChannel, threadCountByContext };
}

export type DateBucket = 'hoje' | 'ontem' | 'ultimos7' | 'ultimos30' | 'antigos';

export const DATE_BUCKET_LABEL: Record<DateBucket, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  ultimos7: 'Últimos 7 dias',
  ultimos30: 'Últimos 30 dias',
  antigos: 'Mais antigos'
};

export function bucketFor(timestamp: number, now: number = Date.now()): DateBucket {
  const dayMs = 86_400_000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();

  if (timestamp >= todayStart) return 'hoje';
  if (timestamp >= todayStart - dayMs) return 'ontem';
  if (timestamp >= todayStart - 7 * dayMs) return 'ultimos7';
  if (timestamp >= todayStart - 30 * dayMs) return 'ultimos30';
  return 'antigos';
}

export interface ThreadSection {
  bucket: DateBucket;
  label: string;
  threads: UnifiedThread[];
}

export function groupByDate(
  threads: readonly UnifiedThread[],
  now: number = Date.now()
): ThreadSection[] {
  const buckets = new Map<DateBucket, UnifiedThread[]>();
  for (const thread of threads) {
    const bucket = bucketFor(thread.lastActivityAt, now);
    const list = buckets.get(bucket) ?? [];
    list.push(thread);
    buckets.set(bucket, list);
  }

  const ordered: DateBucket[] = ['hoje', 'ontem', 'ultimos7', 'ultimos30', 'antigos'];
  return ordered
    .filter((bucket) => buckets.has(bucket))
    .map((bucket) => ({ bucket, label: DATE_BUCKET_LABEL[bucket], threads: buckets.get(bucket) ?? [] }));
}

export function threadParticipantsLabel(thread: UnifiedThread, max = 2): string {
  const names = thread.participants.map((participant) => participant.name || participant.email);
  if (names.length === 0) return thread.subject;
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const deltaMinutes = Math.floor((now - timestamp) / 60_000);
  if (deltaMinutes < 1) return 'agora';
  if (deltaMinutes < 60) return `${deltaMinutes} min`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  const bucket = bucketFor(timestamp, now);
  if (bucket === 'hoje') return `${deltaHours} h`;
  if (bucket === 'ontem') return 'ontem';
  const date = new Date(timestamp);
  if (bucket === 'ultimos7' || bucket === 'ultimos30') {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/**
 * Hora no formato da lista (Figma: `10:42`).
 *
 * Hoje mostra o relógio, ontem mostra o rótulo e datas anteriores mostram dia/mês —
 * a mesma progressão de detalhe usada no frame `@mail · Desktop`.
 */
export function formatThreadTime(timestamp: number, now: number = Date.now()): string {
  const bucket = bucketFor(timestamp, now);
  const date = new Date(timestamp);
  if (bucket === 'hoje') {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (bucket === 'ontem') return 'ontem';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function collectAccountIds(threads: readonly UnifiedThread[]): AccountId[] {
  return unique(threads.flatMap((thread) => thread.accountIds));
}

export type { ChatMessage, EmailMessage };
