import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts
} from '@expo-google-fonts/inter';
import { AppShell, MailStoreProvider } from '@mail/ui';
import { store, syncEngine } from './src/store';
import { DEMO_MODE } from './src/config';
import { ensureNotificationPermission } from './src/notifications';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './src/config';
import { beginGoogleLogin, fetchAccounts, finishGoogleLogin, sessionToken } from './src/auth';
import { SignInScreen } from './src/SignInScreen';
import { sendEmail } from './src/adapters/sync-client';
import type { UnifiedThread } from '@mail/core';

export default function App() {
  const [authenticated, setAuthenticated] = useState(DEMO_MODE);
  const [authError, setAuthError] = useState<string>();

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
    await beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES, 'add');
  }

  async function activateSession(): Promise<void> {
    const accounts = await fetchAccounts();
    store.actions.replaceAccounts(accounts);
    setAuthenticated(true);
    void syncEngine.syncAll();
  }
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold
  });

  useEffect(() => {
    if (DEMO_MODE) return;
    void sessionToken().then(async (token) => {
      if (token !== null) await activateSession();
      else setAuthenticated(false);
    }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha ao carregar a sessão'));
    const complete = () => finishGoogleLogin(globalThis.location?.href ?? '').then(async (done) => { if (done) await activateSession(); }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha no login'));
    const listener = ({ url }: { url: string }) => void finishGoogleLogin(url).then(async () => { await activateSession(); }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha no login'));
    const subscription = Linking.addEventListener('url', listener);
    if (Platform.OS === 'web' && globalThis.location?.pathname.endsWith('/auth/google/callback')) void complete();
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (DEMO_MODE || !authenticated) return;
    void syncEngine.syncAll();
  }, [authenticated]);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void ensureNotificationPermission();
    }
  }, []);

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.root} />;
  }

  if (!DEMO_MODE && (!GOOGLE_CLIENT_ID || !authenticated)) return <SignInScreen error={authError} />;

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
