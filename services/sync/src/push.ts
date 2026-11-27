import type { MailMessage } from '@mail/core';
import type { SyncConfig } from './config.js';
import type { Db } from './db.js';
import { fetchChat, fetchGmail } from './providers.js';

interface PushAccount {
  id: string;
  user_id: string;
  provider: string;
  channel: 'email' | 'chat';
  context_id: string;
}

interface PushState {
  cursor: string | null;
  initialized: boolean;
}

export async function runMobilePushPoll(db: Db, config: SyncConfig): Promise<{ accounts: number; notifications: number; failures: number }> {
  const accounts = (await db.query<PushAccount>(`
    SELECT A.id, A.user_id, A.provider, A.channel, A.context_id
    FROM atmail_accounts A
    LEFT JOIN atmail_notification_preferences P ON P.user_id = A.user_id AND P.account_id = A.id
    WHERE COALESCE(P.enabled, TRUE) = TRUE
      AND EXISTS (SELECT 1 FROM atmail_push_tokens T WHERE T.user_id = A.user_id)
      AND (A.provider = 'gmail' OR A.provider = 'google-chat')
  `)).rows;
  let notifications = 0;
  let failures = 0;
  let next = 0;
  const workers = Array.from({ length: Math.min(4, accounts.length) }, async () => {
    while (next < accounts.length) {
      const account = accounts[next];
      next += 1;
      if (account === undefined) continue;
      try {
        notifications += await pollAccount(db, config, account);
      } catch (error) {
        failures += 1;
        console.error('Falha ao processar notificações push.', error);
      }
    }
  });
  await Promise.all(workers);
  return { accounts: accounts.length, notifications, failures };
}

async function pollAccount(db: Db, config: SyncConfig, account: PushAccount): Promise<number> {
  const state = (await db.query<PushState>(
    'SELECT cursor, initialized FROM atmail_push_sync_state WHERE account_id = $1 AND user_id = $2',
    [account.id, account.user_id]
  )).rows[0] ?? { cursor: null, initialized: false };
  let messages: MailMessage[];
  let cursor = state.cursor ?? '';
  if (account.provider === 'gmail') {
    messages = [];
    let gmailCursor = state.initialized ? cursor : undefined;
    let gmailReset = !state.initialized;
    do {
      const page = await fetchGmail(db, config, account.user_id, account.id, account.context_id, gmailCursor);
      messages.push(...page.messages);
      gmailCursor = page.cursor;
      cursor = page.cursor;
      gmailReset ||= page.historyReset;
      if (!page.hasMore) break;
    } while (true);
    if (!state.initialized || gmailReset) {
      await db.query(
        'INSERT INTO atmail_push_sync_state (account_id, user_id, provider, channel, cursor, initialized, updated_at) VALUES ($1, $2, $3, $4, $5, TRUE, $6) ON CONFLICT(account_id) DO UPDATE SET cursor = excluded.cursor, initialized = TRUE, updated_at = excluded.updated_at',
        [account.id, account.user_id, account.provider, account.channel, cursor, Date.now()]
      );
      await rememberMessages(db, account, messages.filter((message) => !message.isRead));
      return 0;
    }
  } else {
    messages = [];
    let chatCursor: string | undefined;
    let pages = 0;
    do {
      const page = await fetchChat(db, config, account.user_id, account.id, account.context_id, { cursor: chatCursor });
      messages.push(...page.messages);
      chatCursor = page.hasMore ? page.cursor : undefined;
      pages += 1;
    } while (chatCursor && pages < 100);
  }
  await db.query(
    'INSERT INTO atmail_push_sync_state (account_id, user_id, provider, channel, cursor, initialized, updated_at) VALUES ($1, $2, $3, $4, $5, TRUE, $6) ON CONFLICT(account_id) DO UPDATE SET cursor = excluded.cursor, initialized = TRUE, updated_at = excluded.updated_at',
    [account.id, account.user_id, account.provider, account.channel, cursor, Date.now()]
  );
  if (!state.initialized) {
    await rememberMessages(db, account, messages.filter((message) => !message.isRead));
    return 0;
  }
  return sendNewMessages(db, account, messages);
}

async function sendNewMessages(db: Db, account: PushAccount, messages: readonly MailMessage[]): Promise<number> {
  const pending: MailMessage[] = [];
  for (const message of messages) {
    if (message.isRead) continue;
    if (message.channel === 'email' && message.folder !== 'inbox') continue;
    const delivered = (await db.query(
      'SELECT 1 FROM atmail_push_deliveries WHERE user_id = $1 AND account_id = $2 AND message_id = $3',
      [account.user_id, account.id, message.id]
    )).rows[0];
    if (delivered === undefined) pending.push(message);
  }
  if (pending.length === 0) return 0;
  const tokens = (await db.query<{ token: string }>(
    'SELECT token FROM atmail_push_tokens WHERE user_id = $1',
    [account.user_id]
  )).rows.map((row) => row.token);
  if (tokens.length === 0) return 0;
  const payloads = pending.map((message) => ({
    to: tokens,
    title: message.channel === 'email' ? message.subject : message.spaceName,
    body: message.snippet,
    sound: 'default',
    channelId: 'atmail-messages',
    data: { messageId: message.id, accountId: message.accountId, channel: message.channel }
  }));
  await sendExpoPush(payloads);
  for (const message of pending) {
    await db.query(
      'INSERT INTO atmail_push_deliveries (user_id, account_id, message_id, delivered_at) VALUES ($1, $2, $3, $4) ON CONFLICT(user_id, account_id, message_id) DO NOTHING',
      [account.user_id, account.id, message.id, Date.now()]
    );
  }
  return pending.length;
}

async function rememberMessages(db: Db, account: PushAccount, messages: readonly MailMessage[]): Promise<void> {
  for (const message of messages) {
    await db.query(
      'INSERT INTO atmail_push_deliveries (user_id, account_id, message_id, delivered_at) VALUES ($1, $2, $3, $4) ON CONFLICT(user_id, account_id, message_id) DO NOTHING',
      [account.user_id, account.id, message.id, Date.now()]
    );
  }
}

async function sendExpoPush(payloads: readonly unknown[]): Promise<void> {
  for (let index = 0; index < payloads.length; index += 100) {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payloads.slice(index, index + 100))
    });
    if (!response.ok) throw new Error(`Expo Push respondeu ${response.status}`);
    const result = await response.json() as { data?: { status: string; message?: string }[] };
    const failure = result.data?.find((ticket) => ticket.status === 'error');
    if (failure !== undefined) throw new Error(failure.message ?? 'Expo Push rejeitou a notificação');
  }
}
