import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { decideNotification } from '@mail/core';
import type { ContextFilter, ContextWorkspace, MailMessage } from '@mail/core';
import { isTauriRuntime } from './auth';
import { apiFetch } from './auth';

let initialized = false;
let registeredPushToken: string | undefined;
const EXPO_PROJECT_ID = 'ae3fd8e1-4744-4fcf-8623-a1a63cb6646d';

export async function ensureNotificationPermission(): Promise<boolean> {
  if (isTauriRuntime()) {
    try {
      const notification = await import('@tauri-apps/plugin-notification');
      if (await notification.isPermissionGranted()) return true;
      return (await notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  if (Platform.OS === 'web') {
    const NotificationApi = globalThis.Notification;
    if (NotificationApi === undefined) return false;
    if (NotificationApi.permission === 'granted') return true;
    if (NotificationApi.permission === 'denied') return false;
    return (await NotificationApi.requestPermission()) === 'granted';
  }
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
  notificationsEnabled?: boolean;
}

export async function registerPushNotifications(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const permission = await ensureNotificationPermission();
  if (!permission) return;
  const result = await Notifications.getExpoPushTokenAsync({ projectId: EXPO_PROJECT_ID });
  if (registeredPushToken === result.data) return;
  const response = await apiFetch('/accounts/push-token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: result.data, platform: Platform.OS })
  });
  if (!response.ok) throw new Error(`Não foi possível registrar notificações (${response.status})`);
  registeredPushToken = result.data;
}

/**
 * Push de mensagem nova respeitando o contexto (Trabalho/Estudos/Pessoal).
 * Um contexto silenciado nunca gera notificação, mesmo com push habilitado.
 */
export async function presentMessageNotification(
  message: MailMessage,
  options: PresentOptions
): Promise<void> {
  if (options.notificationsEnabled === false) return;

  const context = options.contexts.find((item) => item.id === message.contextId);
  const decision = decideNotification(context, message, options.activeContext as ContextFilter);
  if (!decision.notify) return;

  const title = message.channel === 'chat' ? message.spaceName : message.subject;
  if (isTauriRuntime()) {
    const notification = await import('@tauri-apps/plugin-notification');
    if (await notification.isPermissionGranted()) notification.sendNotification({ title, body: message.snippet });
    return;
  }
  if (Platform.OS === 'web') {
    const NotificationApi = globalThis.Notification;
    if (NotificationApi?.permission === 'granted') new NotificationApi(title, { body: message.snippet, tag: message.id });
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: message.snippet,
      data: { messageId: message.id, contextId: message.contextId },
      sound: false
    },
    trigger: null
  });
}
