import { useCallback, useEffect, useState } from 'react';
import { Appearance, AppState, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts
} from '@expo-google-fonts/inter';
import { AppShell, MailStoreProvider } from '@mail/ui';
import type { NewMessageAttachment, NewMessageSubmission } from '@mail/ui';
import { store, syncEngine } from './src/store';
import { DEMO_MODE, GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';
import { ensureNotificationPermission } from './src/notifications';
import { awaitGoogleLogin, beginGoogleLogin, fetchAccounts, isTauriRuntime, pendingLoginState, sessionToken, setGoogleAuthRevokedHandler } from './src/auth';
import { restoreThemePreference } from './src/theme-preference';
import { SignInScreen } from './src/SignInScreen';
import { addChatReaction, loadChatImage, removeAccount, sendChatMessage, sendChatReply, sendEmail, setAccountNotifications, updateAccountContexts } from './src/adapters/sync-client';
import { LandingScreen } from './src/LandingScreen';
import { brand, isChatMessage } from '@mail/core';
import type { Account, AccountId, ChatMessage, ContextId, MessageId, UnifiedThread } from '@mail/core';
import { createLocalEmailMessage, formattedEmailBody } from './src/email-send';
import type { EmailSendRequest } from './src/email-send';

const EMAIL_SYNC_INTERVAL_MS = 5 * 1000;
const CHAT_SYNC_INTERVAL_MS = 5 * 1000;
const OPEN_CHAT_SYNC_INTERVAL_MS = 3 * 1000;

let optimisticMessageSequence = 0;
const legacySends = new Map<MessageId, { accountId: AccountId; confirmedAt: number }>();

function nextOptimisticMessageName(): string {
  optimisticMessageSequence += 1;
  return `optimistic:${Date.now()}:${optimisticMessageSequence}`;
}

function createLocalChatMessage(
  account: Account,
  messageName: string,
  spaceResourceName: string,
  spaceName: string,
  isDirectMessage: boolean,
  body: string,
  receivedAt: number,
  threadName?: string,
  attachments: NewMessageAttachment[] = []
): ChatMessage {
  const senderName = account.displayName.trim() || account.email;
  return {
    id: brand.message(`chat:${account.id}:${messageName}`),
    accountId: account.id,
    contextId: account.contextId,
    channel: 'chat',
    participants: [{ name: senderName, email: account.email }],
    snippet: body,
    bodyText: body,
    receivedAt,
    isRead: true,
    isStarred: false,
    isMentioned: body.includes('@'),
    labels: [],
    spaceId: brand.space(spaceResourceName),
    spaceName,
    senderName,
    isDirectMessage,
    ...(threadName ? { threadName, isThreadReply: true } : {}),
    reactions: [],
    attachments: attachments.map((attachment, index) => ({
      id: `local:${index}`,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      ...(attachment.mimeType.startsWith('image/') ? { thumbnailUrl: `data:${attachment.mimeType};base64,${attachment.base64}` } : {})
    }))
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const isPublicWeb = Platform.OS === 'web' && !isTauriRuntime();
  const [showWebApp, setShowWebApp] = useState(!isPublicWeb);
  const [authenticated, setAuthenticated] = useState(DEMO_MODE);
  const [authError, setAuthError] = useState<string>();

  const activateSession = useCallback(async (): Promise<void> => {
    const accounts = await fetchAccounts();
    store.actions.replaceAccounts(accounts);
    setAuthenticated(accounts.length > 0);
    setShowWebApp(!isPublicWeb || accounts.length > 0);
    if (accounts.length === 0) return;
    void syncEngine.syncAll();
  }, [isPublicWeb]);

  function reconcileLegacySend(accountId: AccountId, optimisticId: MessageId): void {
    legacySends.set(optimisticId, { accountId, confirmedAt: Date.now() });
    void syncEngine.syncAccount(accountId, { afterCurrent: true });
  }

  async function sendEmailOptimistically(accountId: AccountId, request: EmailSendRequest): Promise<void> {
    const account = store.accountFor(accountId);
    if (!account) throw new Error('A conta desta conversa não está disponível.');
    const messageId = nextOptimisticMessageName();
    const optimistic = createLocalEmailMessage(account, request, {
      messageId, threadId: request.providerThreadId ?? messageId, receivedAt: Date.now()
    });
    store.actions.upsertMessages([optimistic]);
    try {
      const receipt = await sendEmail(accountId, request);
      if (receipt !== undefined) {
        store.actions.upsertMessages([createLocalEmailMessage(account, request, receipt)]);
        store.actions.removeMessages([optimistic.id]);
      } else {
        reconcileLegacySend(accountId, optimistic.id);
      }
    } catch (error) {
      store.actions.removeMessages([optimistic.id]);
      throw error;
    }
    void syncEngine.syncChannel('email');
  }

  async function handleSend(thread: UnifiedThread, body: string, chatThreadName?: string, attachments: NewMessageAttachment[] = [], formatted = false): Promise<void> {
    const messages = store.getThreadMessages(thread.id);
    const last = messages[messages.length - 1];
    if (!last) throw new Error('Não encontrei uma mensagem para responder.');
    if (!last) throw new Error('Não encontrei a última mensagem desta conversa.');
    if (isChatMessage(last)) {
      const account = store.accountFor(last.accountId);
      if (!account) throw new Error('A conta desta conversa não está disponível.');
      const optimisticName = nextOptimisticMessageName();
      const optimisticMessage = createLocalChatMessage(account, optimisticName, last.spaceId, last.spaceName, last.isDirectMessage, body, Date.now(), chatThreadName, attachments);
      store.actions.upsertMessages([optimisticMessage]);
      try {
        const receipt = await sendChatReply(last.accountId, last.spaceId, chatThreadName, body, attachments);
        if (receipt !== undefined) {
          store.actions.upsertMessages([createLocalChatMessage(account, receipt.messageName, receipt.spaceResourceName, last.spaceName, last.isDirectMessage, body, receipt.receivedAt, chatThreadName, attachments)]);
          store.actions.removeMessages([optimisticMessage.id]);
        } else {
          reconcileLegacySend(last.accountId, optimisticMessage.id);
        }
      } catch (error) {
        store.actions.removeMessages([optimisticMessage.id]);
        throw error;
      }
      void syncEngine.syncSpace(last.accountId, last.spaceId);
      return;
    }
    const account = store.accountFor(last.accountId);
    const recipient = last.participants.find((participant) => participant.email.length > 0 && participant.email.toLowerCase() !== account?.email.toLowerCase())?.email;
    if (!recipient) throw new Error('Não encontrei um destinatário para responder.');
    await sendEmailOptimistically(last.accountId, {
      to: [recipient],
      subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
      body,
      ...(formatted ? { bodyHtml: formattedEmailBody(body) } : {}),
      attachments,
      inReplyTo: last.rfcMessageId,
      providerThreadId: last.providerThreadId.startsWith('optimistic:') ? undefined : last.providerThreadId
    });
  }

  async function handleReactChat(message: ChatMessage, emoji: string): Promise<void> {
    if (DEMO_MODE) return;
    const reactions = message.reactions ?? [];
    const existing = reactions.find((reaction) => reaction.emoji === emoji);
    const remove = existing?.own === true;
    const optimisticReactions = existing === undefined
      ? [...reactions, { emoji, count: 1, own: true }]
      : reactions.flatMap((reaction) => reaction.emoji !== emoji ? [reaction] : remove && reaction.count <= 1 ? [] : [{ ...reaction, count: reaction.count + (remove ? -1 : 1), own: !remove }]);
    store.actions.upsertMessages([{ ...message, reactions: optimisticReactions }]);
    try {
      await addChatReaction(message.accountId, message.id, emoji, remove);
    } catch (error) {
      store.actions.upsertMessages([message]);
      throw error;
    }
    void syncEngine.syncSpace(message.accountId, message.spaceId);
  }

  async function moveAccountsToContext(accountIds: AccountId[], contextId: ContextId): Promise<void> {
    if (!DEMO_MODE) await updateAccountContexts(accountIds, contextId);
    for (const accountId of accountIds) store.actions.moveAccountToContext(accountId, contextId);
  }

  async function removeConnectedAccount(accountId: AccountId): Promise<void> {
    if (!DEMO_MODE) await removeAccount(accountId);
    store.actions.removeAccount(accountId);
    if (store.getSnapshot().accounts.length === 0) {
      setAuthenticated(false);
      setShowWebApp(!isPublicWeb);
    }
  }

  async function setNotificationsForAccount(accountId: AccountId, enabled: boolean): Promise<void> {
    if (enabled && !(await ensureNotificationPermission())) {
      throw new Error('Permita notificações no dispositivo para ativá-las.');
    }
    if (!DEMO_MODE) await setAccountNotifications(accountId, enabled);
    const account = store.accountFor(accountId);
    if (account !== undefined) store.actions.registerAccount({ ...account, notificationsEnabled: enabled });
  }

  async function sendNewMessage(message: NewMessageSubmission): Promise<void> {
    if (DEMO_MODE) return;
    if (message.channel === 'email') {
      await sendEmailOptimistically(message.accountId, { to: message.recipients, subject: message.subject, body: message.body, attachments: message.attachments });
      return;
    } else {
      const recipient = message.recipients[0];
      if (!recipient) throw new Error('Informe o destinatário do Chat.');
      const account = store.accountFor(message.accountId);
      if (!account) throw new Error('A conta desta conversa não está disponível.');
      const optimisticName = nextOptimisticMessageName();
      const optimisticSpaceName = `spaces/pending-${Date.now()}-${optimisticMessageSequence}`;
      const optimisticMessage = createLocalChatMessage(account, optimisticName, optimisticSpaceName, recipient, true, message.body, Date.now(), undefined, message.attachments);
      store.actions.upsertMessages([optimisticMessage]);
      try {
        const receipt = await sendChatMessage(message.accountId, recipient, message.body, message.attachments);
        if (receipt !== undefined) {
          store.actions.upsertMessages([createLocalChatMessage(account, receipt.messageName, receipt.spaceResourceName, recipient, true, message.body, receipt.receivedAt, undefined, message.attachments)]);
          store.actions.removeMessages([optimisticMessage.id]);
          void syncEngine.syncSpace(account.id, receipt.spaceResourceName);
        } else {
          reconcileLegacySend(account.id, optimisticMessage.id);
        }
      } catch (error) {
        store.actions.removeMessages([optimisticMessage.id]);
        throw error;
      }
    }
    void syncEngine.syncChannel(message.channel);
  }

  async function beginAddAccount(): Promise<void> {
    try {
      const state = await beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, 'add');
      await awaitGoogleLogin(state);
      const accounts = await fetchAccounts();
      store.actions.replaceAccounts(accounts);
      setAuthenticated(accounts.length > 0);
      setShowWebApp(!isPublicWeb || accounts.length > 0);
      void syncEngine.syncAll();
    } catch (error) {
      setAuthError(messageOf(error, 'Falha ao adicionar a conta'));
    }
  }

  async function reconnectAccount(account: Account): Promise<void> {
    setAuthError(undefined);
    const state = await beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, 'add', account);
    await awaitGoogleLogin(state);
    await activateSession();
  }

  useEffect(() => {
    setGoogleAuthRevokedHandler((accountId) => {
      const account = store.accountFor(brand.account(accountId));
      if (account) store.actions.registerAccount({ ...account, status: 'reauth-required', lastError: 'A autorização da conta Google expirou. Faça login novamente.' });
    });
    return () => setGoogleAuthRevokedHandler(undefined);
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold
  });

  useEffect(() => {
    const applySystemTheme = (): void => store.actions.applySystemTheme(Appearance.getColorScheme() ?? 'light');
    let preference = store.getSnapshot().ui.themePreference;
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot().ui.themePreference;
      if (next === preference) return;
      preference = next;
      if (next === 'system') applySystemTheme();
    });
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      store.actions.applySystemTheme(colorScheme ?? 'light');
    });
    applySystemTheme();
    void restoreThemePreference()
      .then((mode) => {
        if (mode !== undefined) store.actions.setThemePreference(mode);
      })
      .catch((error) => console.error('Falha ao restaurar a preferência de tema.', error));
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
    void (async () => {
      try {
        // Um login iniciado antes de o app ser fechado pode já ter sido concluído no navegador.
        const pending = await pendingLoginState();
        if (pending !== null) {
          try {
            await awaitGoogleLogin(pending, { timeoutMs: 8000 });
            await activateSession();
            return;
          } catch (error) {
            setAuthError(messageOf(error, 'Não foi possível concluir o login.'));
          }
        }
        if ((await sessionToken()) !== null) {
          await activateSession();
          return;
        }
        setAuthenticated(false);
      } catch (error) {
        setAuthError(messageOf(error, 'Falha ao carregar a sessão'));
        setAuthenticated(false);
      }
    })();
  }, [activateSession]);

  useEffect(() => {
    if (DEMO_MODE || !authenticated) return;
    const syncIfActive = (): void => {
      if (isTauriRuntime() || AppState.currentState === 'active') void syncEngine.syncAll();
    };
    const syncEmailIfActive = (): void => {
      if (isTauriRuntime() || AppState.currentState === 'active') void syncEngine.syncChannel('email');
    };
    const syncChatIfActive = (): void => {
      if (isTauriRuntime() || AppState.currentState === 'active') void syncEngine.syncChannel('chat');
    };
    const syncOpenChatIfActive = (): void => {
      if (!isTauriRuntime() && AppState.currentState !== 'active') return;
      const threadId = store.getSnapshot().view.selectedThreadId;
      if (threadId === undefined) return;
      const message = store.getThreadMessages(threadId).find((item) => isChatMessage(item) && !item.id.includes(':optimistic:'));
      if (message === undefined || !isChatMessage(message)) return;
      const account = store.accountFor(message.accountId);
      if (!account || account.status === 'paused' || account.status === 'reauth-required') return;
      void syncEngine.syncSpace(account.id, message.spaceId);
    };
    syncIfActive();
    syncOpenChatIfActive();
    const emailInterval = setInterval(syncEmailIfActive, EMAIL_SYNC_INTERVAL_MS);
    const chatInterval = setInterval(syncChatIfActive, CHAT_SYNC_INTERVAL_MS);
    const openChatInterval = setInterval(syncOpenChatIfActive, OPEN_CHAT_SYNC_INTERVAL_MS);
    let selectedThreadId = store.getSnapshot().view.selectedThreadId;
    const unsubscribe = store.subscribe(() => {
      // Sem recibo, só um sync completo iniciado após a confirmação pode substituir a mensagem local.
      for (const [id, pending] of legacySends) {
        const account = store.accountFor(pending.accountId);
        if (!account || (account.lastSyncedAt !== undefined && account.lastSyncedAt >= pending.confirmedAt)) {
          legacySends.delete(id);
          store.actions.removeMessages([id]);
        }
      }
      const nextThreadId = store.getSnapshot().view.selectedThreadId;
      if (nextThreadId === selectedThreadId) return;
      selectedThreadId = nextThreadId;
      syncOpenChatIfActive();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncIfActive();
        syncOpenChatIfActive();
      }
    });
    return () => {
      clearInterval(emailInterval);
      clearInterval(chatInterval);
      clearInterval(openChatInterval);
      unsubscribe();
      subscription?.remove();
    };
  }, [authenticated]);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void ensureNotificationPermission();
    }
  }, []);

  const content = isPublicWeb && !showWebApp
    ? <LandingScreen onOpenApp={() => setShowWebApp(true)} />
    : !fontsLoaded && fontError === null
      ? <View style={styles.root} />
      : !DEMO_MODE && (!GOOGLE_CLIENT_ID || !authenticated)
        ? <SignInScreen error={authError} onSignedIn={activateSession} />
        : (
            <MailStoreProvider store={store}>
              <AppShell
                appIcon={require('./assets/icon.png')}
                onSend={handleSend}
                onReactChat={handleReactChat}
                onLoadChatImage={loadChatImage}
                onAddAccount={() => void beginAddAccount()}
                onReconnectAccount={reconnectAccount}
                reconnectError={authError}
                onMoveAccounts={moveAccountsToContext}
                onRemoveAccount={removeConnectedAccount}
                onSetAccountNotifications={setNotificationsForAccount}
                onSendNewMessage={sendNewMessage}
              />
            </MailStoreProvider>
          );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {content}
      </SafeAreaView>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%'
  }
});
