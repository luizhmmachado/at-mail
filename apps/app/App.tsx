import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts
} from '@expo-google-fonts/inter';
import { AppShell, MailStoreProvider } from '@mail/ui';
import type { NewMessageSubmission } from '@mail/ui';
import { store, syncEngine } from './src/store';
import { DEMO_MODE, GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';
import { ensureNotificationPermission } from './src/notifications';
import { awaitGoogleLogin, beginGoogleLogin, fetchAccounts, isTauriRuntime, pendingLoginState, sessionToken } from './src/auth';
import { restoreThemeMode } from './src/theme-preference';
import { SignInScreen } from './src/SignInScreen';
import { addChatReaction, removeAccount, sendChatMessage, sendChatReply, sendEmail, setAccountNotifications, updateAccountContexts } from './src/adapters/sync-client';
import { LandingScreen } from './src/LandingScreen';
import { brand, isChatMessage } from '@mail/core';
import type { Account, AccountId, ChatMessage, ContextId, UnifiedThread } from '@mail/core';

const EMAIL_SYNC_INTERVAL_MS = 30 * 1000;
const CHAT_SYNC_INTERVAL_MS = 5 * 1000;

let optimisticChatMessageSequence = 0;

function nextOptimisticChatMessageName(): string {
  optimisticChatMessageSequence += 1;
  return `optimistic:${Date.now()}:${optimisticChatMessageSequence}`;
}

function createLocalChatMessage(
  account: Account,
  messageName: string,
  spaceResourceName: string,
  spaceName: string,
  isDirectMessage: boolean,
  body: string,
  receivedAt: number
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
    reactions: []
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

  async function handleSend(thread: UnifiedThread, body: string): Promise<void> {
    const messages = store.getThreadMessages(thread.id);
    const last = messages[messages.length - 1];
    if (!last) throw new Error('Não encontrei a última mensagem desta conversa.');
    if (isChatMessage(last)) {
      const account = store.accountFor(last.accountId);
      if (!account) throw new Error('A conta desta conversa não está disponível.');
      const optimisticName = nextOptimisticChatMessageName();
      const optimisticMessage = createLocalChatMessage(account, optimisticName, last.spaceId, last.spaceName, last.isDirectMessage, body, Date.now());
      store.actions.upsertMessages([optimisticMessage]);
      try {
        const receipt = await sendChatReply(last.accountId, last.spaceId, undefined, body);
        store.actions.removeMessages([optimisticMessage.id]);
        store.actions.upsertMessages([createLocalChatMessage(account, receipt.messageName, receipt.spaceResourceName, last.spaceName, last.isDirectMessage, body, receipt.receivedAt)]);
      } catch (error) {
        store.actions.removeMessages([optimisticMessage.id]);
        throw error;
      }
      void syncEngine.syncChannel('chat');
      return;
    }
    const recipient = last?.participants.find((participant) => participant.email.length > 0)?.email;
    if (!last || !recipient) throw new Error('Não encontrei um destinatário para responder.');
    await sendEmail(last.accountId, {
      to: [recipient],
      subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
      body,
      inReplyTo: last.channel === 'email' ? last.rfcMessageId : undefined
    });
    void syncEngine.syncChannel('email');
  }

  async function handleReactChat(message: ChatMessage, emoji: string): Promise<void> {
    if (DEMO_MODE) return;
    const reactions = message.reactions ?? [];
    const existing = reactions.find((reaction) => reaction.emoji === emoji);
    const optimisticReactions = existing === undefined
      ? [...reactions, { emoji, count: 1 }]
      : reactions.map((reaction) => reaction.emoji === emoji ? { ...reaction, count: reaction.count + 1 } : reaction);
    store.actions.upsertMessages([{ ...message, reactions: optimisticReactions }]);
    try {
      await addChatReaction(message.accountId, message.id, emoji);
    } catch (error) {
      store.actions.upsertMessages([message]);
      throw error;
    }
    void syncEngine.syncChannel('chat');
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
      await sendEmail(message.accountId, { to: message.recipients, subject: message.subject, body: message.body, attachments: message.attachments });
    } else {
      const recipient = message.recipients[0];
      if (!recipient) throw new Error('Informe o destinatário do Chat.');
      const account = store.accountFor(message.accountId);
      if (!account) throw new Error('A conta desta conversa não está disponível.');
      const optimisticName = nextOptimisticChatMessageName();
      const optimisticSpaceName = `spaces/pending-${Date.now()}-${optimisticChatMessageSequence}`;
      const optimisticMessage = createLocalChatMessage(account, optimisticName, optimisticSpaceName, recipient, true, message.body, Date.now());
      store.actions.upsertMessages([optimisticMessage]);
      try {
        const receipt = await sendChatMessage(message.accountId, recipient, message.body);
        store.actions.removeMessages([optimisticMessage.id]);
        store.actions.upsertMessages([createLocalChatMessage(account, receipt.messageName, receipt.spaceResourceName, recipient, true, message.body, receipt.receivedAt)]);
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

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold
  });

  useEffect(() => {
    void restoreThemeMode()
      .then((mode) => {
        if (mode !== undefined) store.actions.setThemeMode(mode);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (DEMO_MODE) return;
    void (async () => {
      try {
        if ((await sessionToken()) !== null) {
          await activateSession();
          return;
        }
        // Um login iniciado antes de o app ser fechado pode já ter sido concluído no navegador.
        const pending = await pendingLoginState();
        if (pending !== null) {
          try {
            await awaitGoogleLogin(pending, { timeoutMs: 8000 });
            await activateSession();
            return;
          } catch {
            // Sem code pendente: segue para a tela de login.
          }
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
    syncIfActive();
    const emailInterval = setInterval(syncEmailIfActive, EMAIL_SYNC_INTERVAL_MS);
    const chatInterval = setInterval(syncChatIfActive, CHAT_SYNC_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncIfActive();
    });
    return () => {
      clearInterval(emailInterval);
      clearInterval(chatInterval);
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
                onSend={handleSend}
                onReactChat={handleReactChat}
                onAddAccount={() => void beginAddAccount()}
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
