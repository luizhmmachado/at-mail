import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES } from './config';
import { beginGoogleLogin } from './auth';

export function SignInScreen({ error }: { error?: string }) {
  return <View style={styles.root}>
    <Text style={styles.logo}>@mail</Text>
    <Text style={styles.title}>Seu e-mail, em contexto.</Text>
    <Text style={styles.subtitle}>Conecte uma conta Google para começar a unificar Gmail e Chat.</Text>
    <Pressable disabled={!GOOGLE_CLIENT_ID} style={[styles.button, !GOOGLE_CLIENT_ID && styles.disabled]} onPress={() => void beginGoogleLogin(GOOGLE_CLIENT_ID, GOOGLE_SCOPES)}>
      <Text style={styles.buttonText}>{GOOGLE_CLIENT_ID ? 'Continuar com Google' : 'Configure o Client ID'}</Text>
    </Pressable>
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#FBFBFA' }, logo: { fontSize: 20, fontWeight: '600', color: '#1A1A19', marginBottom: 48 }, title: { fontSize: 28, fontWeight: '600', color: '#1A1A19', textAlign: 'center' }, subtitle: { maxWidth: 360, marginTop: 12, marginBottom: 28, fontSize: 15, lineHeight: 22, color: '#61615C', textAlign: 'center' }, button: { paddingHorizontal: 22, paddingVertical: 13, borderRadius: 6, backgroundColor: '#3B3B6D' }, disabled: { opacity: 0.5 }, buttonText: { color: '#FFF', fontSize: 14, fontWeight: '600' }, error: { marginTop: 18, color: '#B42318', textAlign: 'center' } });
