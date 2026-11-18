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
import { GOOGLE_CLIENT_ID } from './src/config';
import { fetchAccounts, finishGoogleLogin, sessionToken } from './src/auth';
import { SignInScreen } from './src/SignInScreen';

export default function App() {
  const [authenticated, setAuthenticated] = useState(DEMO_MODE);
  const [authError, setAuthError] = useState<string>();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold
  });

  useEffect(() => {
    if (DEMO_MODE) return;
    void sessionToken().then(async (token) => {
      if (token !== null) store.actions.replaceAccounts(await fetchAccounts());
      setAuthenticated(token !== null);
    }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha ao carregar a sessão'));
    const complete = () => finishGoogleLogin(globalThis.location?.href ?? '').then(async (done) => { if (done) { const accounts = await fetchAccounts(); store.actions.replaceAccounts(accounts); setAuthenticated(true); } }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha no login'));
    const listener = ({ url }: { url: string }) => void finishGoogleLogin(url).then(async () => { const accounts = await fetchAccounts(); store.actions.replaceAccounts(accounts); setAuthenticated(true); }).catch((error: unknown) => setAuthError(error instanceof Error ? error.message : 'Falha no login'));
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
        <AppShell />
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
