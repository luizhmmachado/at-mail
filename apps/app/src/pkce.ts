import * as Crypto from 'expo-crypto';
import { sha256Base64Url } from './sha256';

/**
 * PKCE sem `crypto.subtle`.
 *
 * Hermes (APK/iOS) não implementa `crypto.subtle`, então o `beginGoogleLogin`
 * antigo quebrava silenciosamente no Android. A entropia vem do `expo-crypto`
 * (que usa o SecureRandom nativo) e o SHA-256 vive em `./sha256`, em JavaScript
 * puro — sem depender de `TextEncoder` nem de contexto seguro no WebView.
 */

/** 32 bytes aleatórios do sistema, em hexadecimal (usado em `state` e `verifier`). */
export async function randomHex(byteCount: number): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(byteCount);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function codeChallenge(verifier: string): string {
  return sha256Base64Url(verifier);
}
