import { useEffect } from 'react';
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
import { DEMO_MODE } from './src/config';
import { ensureNotificationPermission } from './src/notifications';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold
  });

  useEffect(() => {
    if (DEMO_MODE) return;
    void syncEngine.syncAll();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void ensureNotificationPermission();
    }
  }, []);

  if (!fontsLoaded && fontError === null) {
    return <View style={styles.root} />;
  }

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
