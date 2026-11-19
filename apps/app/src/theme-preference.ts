import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { ThemePreference } from '@mail/core';

const THEME_KEY = 'atmail.ui.theme';

function normalize(value: string | null | undefined): ThemePreference | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined;
}

/** Leitura síncrona (web/desktop), para o tema já nascer certo no primeiro render. */
export function readThemePreferenceSync(): ThemePreference | undefined {
  if (Platform.OS !== 'web') return undefined;
  try {
    return normalize(globalThis.localStorage?.getItem(THEME_KEY));
  } catch {
    return undefined;
  }
}

/** No mobile o SecureStore é assíncrono, então a restauração acontece ao montar o app. */
export async function restoreThemePreference(): Promise<ThemePreference | undefined> {
  const sync = readThemePreferenceSync();
  if (sync !== undefined) return sync;
  if (Platform.OS === 'web') return undefined;
  try {
    return normalize(await SecureStore.getItemAsync(THEME_KEY));
  } catch {
    return undefined;
  }
}

export function writeThemePreference(mode: ThemePreference): void {
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(THEME_KEY, mode);
      return;
    }
    void SecureStore.setItemAsync(THEME_KEY, mode).catch(() => undefined);
  } catch {
    // Armazenamento indisponível: o tema vale só para esta sessão.
  }
}
