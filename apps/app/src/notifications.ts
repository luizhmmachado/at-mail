import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { decideNotification } from '@mail/core';
import type { ContextFilter, ContextWorkspace, MailMessage } from '@mail/core';

let initialized = false;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (initialized) return true;

  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }

  if (granted) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true
      })
    });
    initialized = true;
  }

  return granted;
}

export interface PresentOptions {
  contexts: readonly ContextWorkspace[];
  activeContext: string | 'all';
}

/**
 * Push de mensagem nova respeitando o contexto (Trabalho/Estudos/Pessoal).
 * Um contexto silenciado nunca gera notificação, mesmo com push habilitado.
 */
export async function presentMessageNotification(
  message: MailMessage,
  options: PresentOptions
): Promise<void> {
  if (Platform.OS === 'web') return;

  const context = options.contexts.find((item) => item.id === message.contextId);
  const decision = decideNotification(context, message, options.activeContext as ContextFilter);
  if (!decision.notify) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: message.channel === 'chat' ? `${options.contexts.find((c) => c.id === message.contextId)?.name ?? 'Chat'}` : message.subject,
      body: message.snippet,
      data: { messageId: message.id, contextId: message.contextId },
      sound: false
    },
    trigger: null
  });
}
