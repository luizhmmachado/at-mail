import { Linking, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SYNC_API_URL } from './config';
import type { Account } from '@mail/core';

const TOKEN_KEY = 'atmail.session.token';
const STATE_KEY = 'atmail.oauth.state';
const VERIFIER_KEY = 'atmail.oauth.verifier';
const MODE_KEY = 'atmail.oauth.mode';

async function storageGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return (await SecureStore.getItemAsync(key)) ?? null;
}

async function storageSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value);
  else await SecureStore.setItemAsync(key, value);
}

export async function sessionToken(): Promise<string | null> { return storageGet(TOKEN_KEY); }

export function redirectUri(): string {
  return Platform.OS === 'web' ? `${globalThis.location.origin}/auth/google/callback` : 'atmail://auth/google/callback';
}

function randomText(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto?.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function codeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function beginGoogleLogin(clientId: string, scopes: readonly string[], mode: 'login' | 'add' = 'login'): Promise<void> {
  const state = randomText();
  const verifier = randomText();
  await storageSet(STATE_KEY, state);
  await storageSet(VERIFIER_KEY, verifier);
  await storageSet(MODE_KEY, mode);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'code', scope: scopes.join(' '), state, access_type: 'offline', prompt: 'consent', code_challenge: await codeChallenge(verifier), code_challenge_method: 'S256' });
  await Linking.openURL(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

export async function finishGoogleLogin(url: string): Promise<boolean> {
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('/auth/google/callback')) return false;
  const expected = await storageGet(STATE_KEY);
  if (!expected || parsed.searchParams.get('state') !== expected) throw new Error('estado OAuth inválido');
  const code = parsed.searchParams.get('code');
  if (!code) throw new Error(parsed.searchParams.get('error') ?? 'login Google cancelado');
  const mode = await storageGet(MODE_KEY);
  const payload = { code, codeVerifier: await storageGet(VERIFIER_KEY), redirectUri: redirectUri() };
  const response = mode === 'add'
    ? await apiFetch('/auth/google/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    : await fetch(`${SYNC_API_URL}/auth/google/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error((await response.text()).slice(0, 240));
  const result = await response.json() as { sessionToken?: string };
  if (mode !== 'add') {
    if (!result.sessionToken) throw new Error('servidor não devolveu uma sessão');
    await storageSet(TOKEN_KEY, result.sessionToken);
  }
  await storageSet(MODE_KEY, 'login');
  return true;
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
