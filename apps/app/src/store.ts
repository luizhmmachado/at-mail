import { createAppStore, createPresetContexts, createSeedData, SyncEngine } from '@mail/core';
import type { MailboxAdapter, SyncPage } from '@mail/core';
import { DEMO_MODE } from './config';
import { createHttpAdapter, markMessagesRead } from './adapters/sync-client';
import { readThemeModeSync, writeThemeMode } from './theme-preference';

const seed = createSeedData();

export const store = createAppStore({
  contexts: DEMO_MODE ? seed.contexts : createPresetContexts(),
  accounts: DEMO_MODE ? seed.accounts : [],
  messages: DEMO_MODE ? seed.messages : [],
  themeMode: readThemeModeSync() ?? 'light',
  onMarkMessagesRead: DEMO_MODE ? undefined : markMessagesRead
});

/** O tema escolhido sobrevive a reinícios do site/app. */
let persistedTheme = store.getSnapshot().ui.themeMode;
store.subscribe(() => {
  const mode = store.getSnapshot().ui.themeMode;
  if (mode === persistedTheme) return;
  persistedTheme = mode;
  writeThemeMode(mode);
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

export const syncEngine = new SyncEngine({ store, adapters, concurrency: 3 });
