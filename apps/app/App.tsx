import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { AppShell, MailStoreProvider } from '@mail/ui';
import { store, syncEngine } from './src/store';
import { DEMO_MODE } from './src/config';
import { ensureNotificationPermission } from './src/notifications';

export default function App() {
  useEffect(() => {
    if (DEMO_MODE) return;
    void syncEngine.syncAll();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void ensureNotificationPermission();
    }
  }, []);

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
    minHeight: '100%' as unknown as number
  }
});
