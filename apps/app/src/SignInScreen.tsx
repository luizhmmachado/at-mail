import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config';
import { awaitGoogleLogin, beginGoogleLogin } from './auth';

export interface SignInScreenProps {
  error?: string;
  onSignedIn: () => Promise<void>;
}

export function SignInScreen({ error, onSignedIn }: SignInScreenProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>();

  async function signIn(): Promise<void> {
    setBusy(true);
    setStatus('Abrindo o Google no navegador…');
    try {
      const state = await beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES);
      setStatus('Conclua o login no navegador e volte para cá.');
      await awaitGoogleLogin(state);
      setStatus('Entrando…');
      await onSignedIn();
    } catch (failure) {
      setStatus(failure instanceof Error ? failure.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || !GOOGLE_CLIENT_ID;

  return <View style={styles.root}>
    <Text style={styles.logo}>@mail</Text>
    <Text style={styles.title}>Seu e-mail, em contexto.</Text>
    <Text style={styles.subtitle}>Conecte uma conta Google para começar a unificar Gmail e Chat.</Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continuar com Google"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
      onPress={() => void signIn()}
    >
      {busy ? <ActivityIndicator size="small" color="#FFF" /> : null}
      <Text style={styles.buttonText}>{GOOGLE_CLIENT_ID ? 'Continuar com Google' : 'Configure o Client ID'}</Text>
    </Pressable>
    {status ? <Text style={styles.status}>{status}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#FBFBFA' }, logo: { fontSize: 20, fontWeight: '600', color: '#1A1A19', marginBottom: 48 }, title: { fontSize: 28, fontWeight: '600', color: '#1A1A19', textAlign: 'center' }, subtitle: { maxWidth: 360, marginTop: 12, marginBottom: 28, fontSize: 15, lineHeight: 22, color: '#61615C', textAlign: 'center' }, button: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 6, backgroundColor: '#3B3B6D' }, disabled: { opacity: 0.5 }, buttonText: { color: '#FFF', fontSize: 14, fontWeight: '600' }, status: { maxWidth: 360, marginTop: 18, color: '#61615C', textAlign: 'center' }, error: { maxWidth: 360, marginTop: 18, color: '#B42318', textAlign: 'center' } });
