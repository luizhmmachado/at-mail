import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
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
import { sendChatMessage, sendEmail, updateAccountContexts } from './src/adapters/sync-client';
import { LandingScreen } from './src/LandingScreen';
import type { AccountId, ContextId, UnifiedThread } from '@mail/core';

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
    setAuthenticated(true);
    void syncEngine.syncAll();
  }, []);

  async function handleSend(thread: UnifiedThread, body: string): Promise<void> {
    if (thread.channel === 'chat') throw new Error('Envio pelo Google Chat ainda não está disponível.');
    const messages = store.getThreadMessages(thread.id);
    const last = messages[messages.length - 1];
    const recipient = last?.participants.find((participant) => participant.email.length > 0)?.email;
    if (!last || !recipient) throw new Error('Não encontrei um destinatário para responder.');
    await sendEmail(last.accountId, {
      to: [recipient],
      subject: thread.subject.startsWith('Re:') ? thread.subject : `Re: ${thread.subject}`,
      body,
      inReplyTo: last.channel === 'email' ? last.rfcMessageId : undefined
    });
    void syncEngine.syncAll();
  }

  async function moveAccountsToContext(accountIds: AccountId[], contextId: ContextId): Promise<void> {
    if (!DEMO_MODE) await updateAccountContexts(accountIds, contextId);
    for (const accountId of accountIds) store.actions.moveAccountToContext(accountId, contextId);
  }

  async function sendNewMessage(message: NewMessageSubmission): Promise<void> {
    if (DEMO_MODE) return;
    if (message.channel === 'email') {
      await sendEmail(message.accountId, { to: message.recipients, subject: message.subject, body: message.body, attachments: message.attachments });
    } else {
      const recipient = message.recipients[0];
      if (!recipient) throw new Error('Informe o destinatário do Chat.');
      await sendChatMessage(message.accountId, recipient, message.body);
    }
    void syncEngine.syncAll();
  }

  async function beginAddAccount(): Promise<void> {
    try {
      const state = await beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, 'add');
      await awaitGoogleLogin(state);
      store.actions.replaceAccounts(await fetchAccounts());
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
          setShowWebApp(true);
          return;
        }
        // Um login iniciado antes de o app ser fechado pode já ter sido concluído no navegador.
        const pending = await pendingLoginState();
        if (pending !== null) {
          try {
            await awaitGoogleLogin(pending, { timeoutMs: 8000 });
            await activateSession();
            setShowWebApp(true);
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
    void syncEngine.syncAll();
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
                onAddAccount={() => void beginAddAccount()}
                onMoveAccounts={moveAccountsToContext}
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
