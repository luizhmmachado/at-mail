import { Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SYNC_API_URL } from './config';
import { codeChallenge, randomHex } from './pkce';
import type { Account } from '@mail/core';

const TOKEN_KEY = 'atmail.session.token';
const STATE_KEY = 'atmail.oauth.state';
const VERIFIER_KEY = 'atmail.oauth.verifier';
const MODE_KEY = 'atmail.oauth.mode';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export type LoginMode = 'login' | 'add';

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Acesso negado pelo Google. Se a conta não estiver liberada, adicione-a como usuário de teste no Google Cloud ou publique o app.',
  invalid_client: 'Client ID inválido para este app.',
  redirect_uri_mismatch: 'A URL de retorno não está autorizada no Google Cloud.',
  disallowed_useragent: 'O Google bloqueia login dentro de WebViews; use o navegador do sistema.',
  admin_policy_enforced: 'A política da sua organização bloqueia este app.'
};

export function describeOAuthError(code: string): string {
  return OAUTH_ERRORS[code] ?? `O Google recusou o login (${code}).`;
}

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return (await SecureStore.getItemAsync(key)) ?? null;
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

async function storageDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key);
  else await SecureStore.deleteItemAsync(key);
}

export async function sessionToken(): Promise<string | null> {
  return storageGet(TOKEN_KEY);
}

/** Identificador do login em andamento, se o app foi fechado antes de concluir. */
export async function pendingLoginState(): Promise<string | null> {
  return storageGet(STATE_KEY);
}

/**
 * O Google só aceita `redirect_uri` HTTPS para clients do tipo "Web application";
 * `atmail://auth/google/callback` era recusado no APK e no desktop. O callback
 * agora é servido pelo backend de sync, que guarda o `code` e o entrega ao app
 * via `/auth/google/code` (polling). O mesmo fluxo vale para web, APK e desktop.
 */
export function redirectUri(): string {
  return `${SYNC_API_URL}/auth/google/callback`;
}

export function isTauriRuntime(): boolean {
  return typeof globalThis === 'object' && globalThis !== null && '__TAURI_INTERNALS__' in globalThis;
}

/** WebView do desktop não abre aba do sistema sozinha: usa o plugin opener do Tauri. */
async function openExternal(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const opener = await import('@tauri-apps/plugin-opener');
      await opener.openUrl(url);
      return;
    } catch {
      // Sem o plugin, cai no comportamento padrão da WebView.
    }
  }
  await Linking.openURL(url);
}

function queryString(params: ReadonlyArray<readonly [string, string]>): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

/**
 * O `state` é gerado pelo backend e só ele aceita o callback do Google: um
 * state desconhecido é descartado, o que mantém a rota pública protegida.
 */
async function startLogin(): Promise<string> {
  const platform = isTauriRuntime() ? 'tauri' : Platform.OS;
  const response = await fetch(`${SYNC_API_URL}/auth/google/start?platform=${encodeURIComponent(platform)}`, { method: 'POST' });
  if (response.status === 429) throw new Error('Muitas tentativas de login. Aguarde alguns minutos e tente de novo.');
  if (!response.ok) throw new Error(`Não foi possível iniciar o login (${response.status}).`);
  const result = (await response.json()) as { state?: string };
  if (typeof result.state !== 'string' || result.state.length === 0) throw new Error('O servidor não devolveu o estado do login.');
  return result.state;
}

/**
 * Abre o consentimento do Google no navegador e devolve o `state` do login.
 * Use {@link awaitGoogleLogin} em seguida para esperar a conclusão.
 */
export async function beginGoogleLogin(clientId: string, scopes: readonly string[], mode: LoginMode = 'login'): Promise<string> {
  if (clientId.length === 0) throw new Error('Client ID do Google não configurado nesta build.');
  const state = await startLogin();
  const verifier = await randomHex(32);
  await storageSet(STATE_KEY, state);
  await storageSet(VERIFIER_KEY, verifier);
  await storageSet(MODE_KEY, mode);
  const query = queryString([
    ['client_id', clientId],
    ['redirect_uri', redirectUri()],
    ['response_type', 'code'],
    ['scope', scopes.join(' ')],
    ['state', state],
    ['access_type', 'offline'],
    ['prompt', 'consent'],
    ['code_challenge', codeChallenge(verifier)],
    ['code_challenge_method', 'S256']
  ]);
  await openExternal(`${GOOGLE_AUTH_URL}?${query}`);
  return state;
}

export interface GoogleLoginOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 1500;

/** Espera o navegador concluir o consentimento e troca o `code` por uma sessão. */
export async function awaitGoogleLogin(state: string, options: GoogleLoginOptions = {}): Promise<void> {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? LOGIN_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const response = await fetch(`${SYNC_API_URL}/auth/google/code?state=${encodeURIComponent(state)}`);
    if (response.ok) {
      const result = (await response.json()) as { code?: string; error?: string };
      if (typeof result.error === 'string' && result.error.length > 0) throw new Error(describeOAuthError(result.error));
      if (typeof result.code === 'string' && result.code.length > 0) {
        await exchangeGoogleCode(state, result.code);
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('O login não foi concluído no navegador. Tente novamente.');
}

async function exchangeGoogleCode(state: string, code: string): Promise<void> {
  const expected = await storageGet(STATE_KEY);
  if (expected !== state) throw new Error('Estado OAuth inválido. Recomece o login.');
  const mode = ((await storageGet(MODE_KEY)) ?? 'login') as LoginMode;
  const payload = JSON.stringify({
    code,
    codeVerifier: (await storageGet(VERIFIER_KEY)) ?? undefined,
    redirectUri: redirectUri()
  });
  const path = mode === 'add' ? '/auth/google/add' : '/auth/google/exchange';
  const response = mode === 'add'
    ? await apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload })
    : await fetch(`${SYNC_API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
  if (!response.ok) throw new Error((await response.text()).slice(0, 240));
  const result = (await response.json()) as { sessionToken?: string };
  if (mode !== 'add') {
    if (!result.sessionToken) throw new Error('o servidor não devolveu uma sessão');
    await storageSet(TOKEN_KEY, result.sessionToken);
  }
  await storageDelete(STATE_KEY);
  await storageDelete(VERIFIER_KEY);
  await storageSet(MODE_KEY, 'login');
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await sessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return fetch(`${SYNC_API_URL}${path}`, { ...init, headers, credentials: 'include' });
}

export async function fetchAccounts(): Promise<Account[]> {
  const response = await apiFetch('/accounts');
  if (!response.ok) throw new Error(`contas: ${response.status}`);
  const result = await response.json() as { accounts: Account[] };
  return result.accounts;
}
