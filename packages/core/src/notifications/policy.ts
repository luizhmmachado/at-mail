import type { ContextWorkspace, MailMessage } from '../domain/models';
import type { ContextFilter } from '../state/feed';

export interface NotificationDecision {
  notify: boolean;
  reason: 'muted' | 'policy-none' | 'policy-mentions' | 'allowed';
}

/**
 * Regra única de notificação, usada por mobile (push local) e desktop.
 *
 * - Contexto silenciado nunca notifica.
 * - Política `mentions` só notifica menções diretas.
 * - Política `none` só alimenta o badge.
 */
export function decideNotification(
  context: ContextWorkspace | undefined,
  message: Pick<MailMessage, 'isMentioned' | 'contextId'>,
  activeContext: ContextFilter
): NotificationDecision {
  if (context === undefined) return { notify: true, reason: 'allowed' };
  if (context.muted) return { notify: false, reason: 'muted' };
  if (context.notificationPolicy === 'none') return { notify: false, reason: 'policy-none' };
  if (context.notificationPolicy === 'mentions' && !message.isMentioned) {
    return { notify: false, reason: 'policy-mentions' };
  }
  /** Contexto em foco não gera push: o usuário já está olhando para ele. */
  if (activeContext !== 'all' && activeContext === message.contextId) {
    return { notify: false, reason: 'policy-none' };
  }
  return { notify: true, reason: 'allowed' };
}
