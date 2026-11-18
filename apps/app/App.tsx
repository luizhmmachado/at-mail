import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts
} from '@expo-google-fonts/inter';
import { AppShell, MailStoreProvider } from '@mail/ui';
import { store, syncEngine } from './src/store';
import { DEMO_MODE, GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';
import { ensureNotificationPermission } from './src/notifications';
import { awaitGoogleLogin, beginGoogleLogin, fetchAccounts, pendingLoginState, sessionToken } from './src/auth';
import { restoreThemeMode } from './src/theme-preference';
import { SignInScreen } from './src/SignInScreen';
import { sendEmail } from './src/adapters/sync-client';
import { LandingScreen } from './src/LandingScreen';
import type { UnifiedThread } from '@mail/core';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const [showWebApp, setShowWebApp] = useState(Platform.OS !== 'web');
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
    void syncEngine.syncAll();
  }, [authenticated]);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void ensureNotificationPermission();
    }
  }, []);

  if (Platform.OS === 'web' && !showWebApp) {
    return <LandingScreen onOpenApp={() => setShowWebApp(true)} />;
  }

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.root} />;
  }

  if (!DEMO_MODE && (!GOOGLE_CLIENT_ID || !authenticated)) {
    return <SignInScreen error={authError} onSignedIn={activateSession} />;
  }

  return (
    <View style={styles.root}>
      <MailStoreProvider store={store}>
        <AppShell onSend={handleSend} onAddAccount={() => void beginAddAccount()} />
      </MailStoreProvider>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
    minHeight: '100%'
  }
});
