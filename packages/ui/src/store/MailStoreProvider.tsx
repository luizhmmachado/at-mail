import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode
} from 'react';
import type { AppSnapshot, AppStore, FeedResult } from '@mail/core';

const StoreContext = createContext<AppStore | null>(null);

export interface MailStoreProviderProps {
  store: AppStore;
  children: ReactNode;
}

export function MailStoreProvider({ store, children }: MailStoreProviderProps): ReactElement {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) {
    throw new Error('useAppStore deve ser usado dentro de <MailStoreProvider>.');
  }
  return store;
}

export function useMailSnapshot(): AppSnapshot {
  const store = useAppStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export interface FeedBinding {
  feed: FeedResult;
  snapshot: AppSnapshot;
}

/** Feed derivado + ações. Memoizado por referência de mensagens/view. */
export function useFeed(): FeedBinding {
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const feed = useMemo(() => store.getFeed(), [store, snapshot.messages, snapshot.view]);
  return { feed, snapshot };
}

export function useMailActions() {
  return useAppStore().actions;
}

export function useSelectedThreadMessages() {
  const store = useAppStore();
  const snapshot = useMailSnapshot();
  const threadId = snapshot.view.selectedThreadId;
  return useMemo(() => (threadId === undefined ? [] : store.getThreadMessages(threadId)), [store, threadId, snapshot.messages]);
}

export function useThreadSelectionHandler() {
  const { actions } = useAppStore();
  return useCallback(
    (threadId: Parameters<typeof actions.selectThread>[0]) => {
      actions.selectThread(threadId);
      if (threadId !== undefined) actions.markThreadRead(threadId);
    },
    [actions]
  );
}
