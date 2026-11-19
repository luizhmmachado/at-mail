import { createAppStore, createPresetContexts, createSeedData, SyncEngine } from '@mail/core';
import type { MailboxAdapter, SyncPage } from '@mail/core';
import { DEMO_MODE } from './config';
import { createHttpAdapter, markMessagesRead } from './adapters/sync-client';
import { readThemePreferenceSync, writeThemePreference } from './theme-preference';
import { presentMessageNotification } from './notifications';
import { Appearance } from 'react-native';

const seed = createSeedData();
const themePreference = readThemePreferenceSync() ?? 'system';

export const store = createAppStore({
  contexts: DEMO_MODE ? seed.contexts : createPresetContexts(),
  accounts: DEMO_MODE ? seed.accounts : [],
  messages: DEMO_MODE ? seed.messages : [],
  themePreference,
  themeMode: themePreference === 'system' ? Appearance.getColorScheme() ?? 'light' : themePreference,
  onMarkMessagesRead: DEMO_MODE ? undefined : markMessagesRead
});

/** O tema escolhido sobrevive a reinícios do site/app. */
let persistedTheme = store.getSnapshot().ui.themePreference;
store.subscribe(() => {
  const mode = store.getSnapshot().ui.themePreference;
  if (mode === persistedTheme) return;
  persistedTheme = mode;
  writeThemePreference(mode);
});

/** Em modo demo nada sai para a rede: a UI é explorada com dados locais. */
function demoAdapter(provider: string, channel: 'email' | 'chat'): MailboxAdapter {
  return {
    provider: provider as MailboxAdapter['provider'],
    channel,
    async fetchSince(): Promise<SyncPage> {
      return { messages: [], removedIds: [], nextCursor: undefined };
    }
  };
}

const adapters: MailboxAdapter[] = DEMO_MODE
  ? [demoAdapter('gmail', 'email'), demoAdapter('google-chat', 'chat'), demoAdapter('icloud', 'email')]
  : [
      createHttpAdapter('gmail', 'email'),
      createHttpAdapter('google-chat', 'chat'),
      createHttpAdapter('microsoft-graph', 'email'),
      createHttpAdapter('imap', 'email')
    ];

export const syncEngine = new SyncEngine({
  store,
  adapters,
  concurrency: 3,
  onNewMessages(account, messages) {
    if (account.notificationsEnabled === false) return;
    const snapshot = store.getSnapshot();
    for (const message of messages) {
      if (message.isRead) continue;
      void presentMessageNotification(message, {
        contexts: snapshot.contexts,
        activeContext: snapshot.view.contextId,
        notificationsEnabled: account.notificationsEnabled
      }).catch(() => undefined);
    }
  }
});
