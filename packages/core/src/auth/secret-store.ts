import type { SecretRef } from '../domain/ids';

/**
 * Contrato de armazenamento de credenciais.
 *
 * Nenhum token/refresh token é persistido em estado de aplicação, AsyncStorage
 * ou localStorage. Cada plataforma fornece a implementação:
 *
 * - Desktop (Tauri): plugin `stronghold` (Argon2 + cofre criptografado) ou
 *   `keyring` do SO (Keychain no macOS, Credential Manager no Windows,
 *   libsecret no Linux).
 * - Mobile (Expo): `expo-secure-store` (iOS Keychain / Android Keystore).
 * - Web: cookie `HttpOnly; Secure; SameSite=Lax` emitido pelo backend de
 *   sincronização. O front-end nunca enxerga o refresh token; recebe apenas
 *   access tokens de curta duração em memória.
 */
export interface SecretStore {
  get(ref: SecretRef): Promise<string | undefined>;
  set(ref: SecretRef, value: string): Promise<void>;
  remove(ref: SecretRef): Promise<void>;
}

export function createMemorySecretStore(initial: Record<string, string> = {}): SecretStore {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    async get(ref) {
      return values.get(ref);
    },
    async set(ref, value) {
      values.set(ref, value);
    },
    async remove(ref) {
      values.delete(ref);
    }
  };
}

export function secretRefFor(accountId: string, kind: 'oauth' | 'imap' = 'oauth'): SecretRef {
  return `account:${accountId}:${kind}` as SecretRef;
}
