import { createAppStore, createPresetContexts, createSeedData, SyncEngine } from '@mail/core';
import type { MailboxAdapter, SyncPage } from '@mail/core';
import { DEMO_MODE } from './config';
import { createHttpAdapter } from './adapters/sync-client';

const seed = createSeedData();

export const store = createAppStore({
  contexts: DEMO_MODE ? seed.contexts : createPresetContexts(),
  accounts: DEMO_MODE ? seed.accounts : [],
  messages: DEMO_MODE ? seed.messages : []
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
