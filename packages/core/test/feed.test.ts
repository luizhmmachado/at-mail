import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  brand,
  buildUnifiedThreads,
  createSeedData,
  formatRelativeTime,
  formatThreadTime,
  groupByDate,
  matchesQuery,
  parseQuery,
  selectFeed
} from '../src/index.ts';
import type { MailMessage } from '../src/index.ts';

const NOW = 1_770_000_000_000;

function fixture(): MailMessage[] {
  const work = brand.context('work');
  const studies = brand.context('studies');

  const base = {
    participants: [{ name: 'Bruno Salles', email: 'bruno@empresa.com' }],
    bodyText: 'corpo',
    isRead: false,
    isStarred: false,
    isMentioned: false,
    labels: [],
    references: [],
    folder: 'inbox' as const
  };

  return [
    {
      ...base,
      id: brand.message('m1'),
      accountId: brand.account('a1'),
      contextId: work,
      channel: 'email',
      snippet: 'primeira',
      receivedAt: NOW - 10_000,
      subject: 'RFC de sync',
      providerThreadId: 't1',
      attachments: []
    },
    {
      ...base,
      id: brand.message('m2'),
      accountId: brand.account('a1'),
      contextId: work,
      channel: 'email',
      snippet: 'segunda',
      receivedAt: NOW - 5_000,
      subject: 'Re: RFC de sync',
      providerThreadId: 't1',
      isRead: true,
      attachments: []
    },
    {
      ...base,
      id: brand.message('m3'),
      accountId: brand.account('a2'),
      contextId: studies,
      channel: 'email',
      snippet: 'prazo da lista',
      receivedAt: NOW - 20_000,
      subject: 'Lista 4',
      providerThreadId: 't2',
      attachments: []
    },
    {
      ...base,
      id: brand.message('m4'),
      accountId: brand.account('a3'),
      contextId: work,
      channel: 'chat',
      snippet: 'subi o preview',
      receivedAt: NOW - 1_000,
      spaceId: brand.space('s1'),
      spaceName: 'Engenharia',
      senderName: 'Bruno',
      isDirectMessage: false,
      isMentioned: true
    }
  ];
}

describe('construção do feed unificado', () => {
  it('agrupa respostas de e-mail na mesma thread do provedor', () => {
    const threads = buildUnifiedThreads(fixture());
    const emailThread = threads.find((thread) => thread.channel === 'email' && thread.subject.includes('RFC'));

    assert.ok(emailThread !== undefined);
    assert.equal(emailThread.messageIds.length, 2);
    assert.equal(emailThread.unreadCount, 1);
    assert.equal(emailThread.snippet, 'segunda', 'usa a mensagem mais recente');
  });

  it('agrupa chat por espaço e mantém canais separados', () => {
    const threads = buildUnifiedThreads(fixture());
    const chat = threads.filter((thread) => thread.channel === 'chat');
    assert.equal(chat.length, 1);
    assert.equal(chat[0]?.subject, 'Engenharia');
    assert.equal(chat[0]?.flags.isMentioned, true);
  });

  it('ordena por atividade mais recente', () => {
    const threads = buildUnifiedThreads(fixture());
    const timestamps = threads.map((thread) => thread.lastActivityAt);
    const sorted = [...timestamps].sort((a, b) => b - a);
    assert.deepEqual(timestamps, sorted);
    assert.equal(threads[0]?.channel, 'chat');
  });
});

describe('filtros de contexto e canal', () => {
  it('separa contexto de trabalho de estudos', () => {
    const work = selectFeed(fixture(), { contextId: brand.context('work'), channel: 'all', query: '' });
    const studies = selectFeed(fixture(), { contextId: brand.context('studies'), channel: 'all', query: '' });

    assert.equal(work.threads.length, 2);
    assert.equal(studies.threads.length, 1);
    assert.equal(work.totalUnread, 2);
  });

  it('filtra apenas chat', () => {
    const chat = selectFeed(fixture(), { contextId: 'all', channel: 'chat', query: '' });
    assert.ok(chat.threads.every((thread) => thread.channel === 'chat'));
    assert.equal(chat.unreadByChannel.chat, 1);
  });

  it('conta threads por contexto', () => {
    const feed = selectFeed(fixture(), { contextId: 'all', channel: 'all', query: '' });
    assert.equal(feed.threadCountByContext.work, 2);
    assert.equal(feed.threadCountByContext.studies, 1);
  });
});

describe('busca com operadores', () => {
  it('interpreta from:, in: e is:unread', () => {
    const clauses = parseQuery('from:bruno in:chat is:unread');
    assert.deepEqual(clauses, [
      { field: 'from', value: 'bruno' },
      { field: 'channel', value: 'chat' },
      { field: 'unread', value: 'unread' }
    ]);
  });

  it('aplica busca textual em assunto, participantes e snippet', () => {
    const threads = buildUnifiedThreads(fixture());
    const chatThread = threads.find((thread) => thread.channel === 'chat');
    const emailThread = threads.find((thread) => thread.channel === 'email');
    assert.ok(chatThread !== undefined);
    assert.ok(emailThread !== undefined);

    assert.equal(matchesQuery(chatThread, 'preview'), true);
    assert.equal(matchesQuery(emailThread, 'bruno'), true);
    assert.equal(matchesQuery(emailThread, 'inexistente'), false);
  });

  it('esconde threads arquivadas por padrão', () => {
    const archived = fixture().map((message) =>
      message.channel === 'email' ? { ...message, folder: 'archived' as const } : message
    );
    const hidden = selectFeed(archived, { contextId: 'all', channel: 'email', query: '' });
    assert.equal(hidden.threads.length, 0);

    const shown = selectFeed(archived, {
      contextId: 'all',
      channel: 'email',
      query: '',
      includeArchived: true
    });
    assert.equal(shown.threads.length, 2);
  });
});

describe('agrupamento por data', () => {
  it('usa hoje/ontem/últimos 7 dias', () => {
    const seeds = createSeedData(NOW);
    const threads = buildUnifiedThreads(seeds.messages);
    const sections = groupByDate(threads, NOW);
    assert.ok(sections.some((section) => section.bucket === 'hoje'));
    const last = sections[sections.length - 1];
    assert.ok(last !== undefined);
    assert.equal(last.bucket, 'ultimos7');
  });

  it('formata tempo relativo em português', () => {
    assert.equal(formatRelativeTime(NOW - 30_000, NOW), 'agora');
    assert.equal(formatRelativeTime(NOW - 5 * 60_000, NOW), '5 min');
    assert.equal(formatRelativeTime(NOW - 2 * 3_600_000, NOW), '2 h');
  });

  it('formata a hora da lista como relógio no dia atual', () => {
    const today = new Date(2026, 0, 15, 10, 42, 0).getTime();
    assert.equal(formatThreadTime(today, today + 60_000), '10:42');

    const yesterday = new Date(2026, 0, 14, 18, 0, 0).getTime();
    assert.equal(formatThreadTime(yesterday, today), 'ontem');

    const older = new Date(2026, 0, 2, 9, 0, 0).getTime();
    assert.equal(formatThreadTime(older, today), '02/01');
  });
});
