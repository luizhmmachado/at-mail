export type PlatformKind = 'web' | 'macos' | 'windows' | 'linux' | 'ios' | 'android';

export type ShortcutAction =
  | 'search'
  | 'next-thread'
  | 'prev-thread'
  | 'archive'
  | 'reply'
  | 'compose'
  | 'toggle-unread'
  | 'star'
  | 'context-all'
  | 'context-work'
  | 'context-studies'
  | 'context-personal'
  | 'channel-all'
  | 'channel-email'
  | 'channel-chat'
  | 'close';

export interface KeyStroke {
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const SHORTCUTS: Record<ShortcutAction, KeyStroke> = {
  search: { key: 'k', meta: true },
  'next-thread': { key: 'j' },
  'prev-thread': { key: 'k' },
  archive: { key: 'e' },
  reply: { key: 'r' },
  compose: { key: 'c' },
  'toggle-unread': { key: 'u' },
  star: { key: 's' },
  'context-all': { key: '1', alt: true },
  'context-work': { key: '2', alt: true },
  'context-studies': { key: '3', alt: true },
  'context-personal': { key: '4', alt: true },
  'channel-all': { key: '0', meta: true },
  'channel-email': { key: '1', meta: true },
  'channel-chat': { key: '2', meta: true },
  close: { key: 'Escape' }
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  search: 'Busca global',
  'next-thread': 'Próxima conversa',
  'prev-thread': 'Conversa anterior',
  archive: 'Arquivar',
  reply: 'Responder',
  compose: 'Escrever',
  'toggle-unread': 'Alternar não lidos',
  star: 'Favoritar',
  'context-all': 'Contexto: tudo',
  'context-work': 'Contexto: trabalho',
  'context-studies': 'Contexto: estudos',
  'context-personal': 'Contexto: pessoal',
  'channel-all': 'Canal: tudo',
  'channel-email': 'Canal: e-mail',
  'channel-chat': 'Canal: chat',
  close: 'Fechar / cancelar'
};

const ACTION_ORDER: ShortcutAction[] = [
  'search',
  'compose',
  'reply',
  'archive',
  'toggle-unread',
  'star',
  'next-thread',
  'prev-thread',
  'context-all',
  'context-work',
  'context-studies',
  'context-personal',
  'channel-all',
  'channel-email',
  'channel-chat',
  'close'
];

export interface NormalizedKeyEvent {
  key: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export function normalizeEvent(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): NormalizedKeyEvent {
  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    meta: event.metaKey === true || event.ctrlKey === true,
    shift: event.shiftKey === true,
    alt: event.altKey === true
  };
}

function matches(event: NormalizedKeyEvent, stroke: KeyStroke): boolean {
  return (
    event.key === stroke.key &&
    event.meta === (stroke.meta === true) &&
    event.alt === (stroke.alt === true) &&
    event.shift === (stroke.shift === true)
  );
}

export function resolveShortcut(event: NormalizedKeyEvent): ShortcutAction | undefined {
  for (const action of ACTION_ORDER) {
    if (matches(event, SHORTCUTS[action])) return action;
  }
  return undefined;
}

/** Atalhos sem modificador não devem disparar enquanto o usuário digita. */
export function shouldIgnoreInEditableTarget(
  action: ShortcutAction | undefined,
  isEditableTarget: boolean
): boolean {
  if (action === undefined) return true;
  if (!isEditableTarget) return false;
  return action !== 'close' && action !== 'search';
}

export function formatShortcut(action: ShortcutAction, platform: PlatformKind): string {
  const stroke = SHORTCUTS[action];
  const isApple = platform === 'macos' || platform === 'ios';
  const parts: string[] = [];
  if (stroke.meta === true) parts.push(isApple ? '⌘' : 'Ctrl');
  if (stroke.alt === true) parts.push(isApple ? '⌥' : 'Alt');
  if (stroke.shift === true) parts.push(isApple ? '⇧' : 'Shift');
  const key = stroke.key === 'Escape' ? 'Esc' : stroke.key.toUpperCase();
  parts.push(key);
  return isApple ? parts.join('') : parts.join('+');
}

export function detectPlatform(userAgent: string): PlatformKind {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/mac os x|macintosh/.test(ua)) return 'macos';
  if (/windows/.test(ua)) return 'windows';
  if (/linux|x11/.test(ua)) return 'linux';
  return 'web';
}
