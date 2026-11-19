import process from 'node:process';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export interface SyncConfig {
  port: number;
  databaseUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
  publicOrigins: string[];
  webAppOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  // A chave de cifra precisa ser dedicada: reaproveitar SESSION_SECRET impede
  // rotacionar o material de sessão sem perder as credenciais já cifradas.
  const encryption = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!encryption) throw new Error('Defina TOKEN_ENCRYPTION_KEY (32 bytes em base64)');
  const encryptionKey = Buffer.from(encryption, 'base64');
  if (encryptionKey.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY deve decodificar para 32 bytes');
  const port = Number(env.PORT ?? 8790);
  return {
    port,
    databaseUrl: requiredFrom(env, 'DATABASE_URL'),
    clientId: requiredFrom(env, 'GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: requiredFrom(env, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    // O callback é servido por este backend: web, APK e desktop usam o mesmo HTTPS.
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
    encryptionKey,
    publicOrigins: (env.PUBLIC_ORIGINS ?? env.PUBLIC_ORIGIN ?? 'http://localhost:8081')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    webAppOrigin: env.WEB_APP_ORIGIN ?? 'http://localhost:8081'
  };
}

function requiredFrom(env: NodeJS.ProcessEnv, name: string, must = true): string {
  const value = env[name]?.trim() ?? '';
  if (must && !value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}
