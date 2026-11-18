import { Platform } from 'react-native';

const productionSyncApiUrl = 'https://at-mail-sync-legacy.vercel.app';
const fallbackHost = Platform.select({
  android: productionSyncApiUrl,
  default: productionSyncApiUrl
});

/** Backend de sincronização (guarda refresh tokens; o cliente nunca os vê). */
export const SYNC_API_URL = process.env.EXPO_PUBLIC_SYNC_API_URL ?? fallbackHost;

export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '77051752731-cp96clb7i04rk96asvdl0et37n00hnm3.apps.googleusercontent.com';

/** Demo só é ativado explicitamente; builds de produção nunca caem silenciosamente nos mocks. */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === 'true';

/**
 * Escopos OAuth2 solicitados no consentimento.
 *
 * `gmail.modify` permite ler, arquivar e marcar como lido — sem `send` o app
 * não pode enviar e-mail em nome do usuário sem novo consentimento.
 * Para envio, adicione `https://www.googleapis.com/auth/gmail.send`.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly'
] as const;
