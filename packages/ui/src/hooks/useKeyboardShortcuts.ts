import { useEffect } from 'react';
import {
  normalizeEvent,
  resolveShortcut,
  shouldIgnoreInEditableTarget,
  type ShortcutAction
} from '@mail/core';
import { useAppStore } from '../store/MailStoreProvider';

export interface KeyboardShortcutsOptions {
  enabled?: boolean;
  onArchive?: (threadId: string) => void;
}

/**
 * Atalhos de teclado do Desktop/Web.
 *
 * J/K navegam, E arquiva, R responde, C escreve, S favorita,
 * ⌘/Ctrl+K abre a busca, ⌥1..4 alterna contexto, ⌘/Ctrl+1/2 alterna canal.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}): void {
  const store = useAppStore();
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditable =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      const action = resolveShortcut(normalizeEvent(event));
      if (shouldIgnoreInEditableTarget(action, isEditable)) return;
      if (action === undefined) return;

      const snapshot = store.getSnapshot();
      const threadId = snapshot.view.selectedThreadId;

      if (handleGlobal(action, store, options)) {
        event.preventDefault();
        return;
      }

      switch (action) {
        case 'next-thread':
          event.preventDefault();
          store.actions.moveSelection(1);
          break;
        case 'prev-thread':
          event.preventDefault();
          store.actions.moveSelection(-1);
          break;
        case 'archive':
          if (threadId !== undefined) {
            event.preventDefault();
            options.onArchive?.(threadId);
            store.actions.archiveThread(threadId);
          }
          break;
        case 'reply':
        case 'compose':
          event.preventDefault();
          store.actions.toggleCompose(true);
          break;
        case 'toggle-unread':
          event.preventDefault();
          store.actions.setUnreadOnly(!snapshot.view.unreadOnly);
          break;
        case 'star': {
          if (threadId === undefined) break;
          const thread = store.getThread(threadId);
          if (thread?.channel === 'email') {
            event.preventDefault();
            void store.actions.toggleThreadStar(thread.id);
          }
          break;
        }
        case 'close':
          store.actions.toggleCommandPalette(false);
          store.actions.toggleCompose(false);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, options, store]);
}

function handleGlobal(
  action: ShortcutAction,
  store: ReturnType<typeof useAppStore>,
  _options: KeyboardShortcutsOptions
): boolean {
  const contexts = store.getSnapshot().contexts;

  switch (action) {
    case 'search':
      store.actions.toggleCommandPalette();
      return true;
    case 'context-all':
      store.actions.setContext('all');
      return true;
    case 'context-work':
    case 'context-studies':
    case 'context-personal': {
      const kind = action.replace('context-', '');
      const context = contexts.find((item) => item.kind === kind);
      if (context !== undefined) {
        store.actions.setContext(context.id);
        return true;
      }
      return false;
    }
    case 'channel-email':
      store.actions.setChannel('email');
      return true;
    case 'channel-chat':
      store.actions.setChannel('chat');
      return true;
    default:
      return false;
  }
}
