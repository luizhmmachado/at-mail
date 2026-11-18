#!/usr/bin/env node
/**
 * Converte o JSON de cliente OAuth do Google no `.env` do projeto.
 *
 * Uso:
 *   node scripts/env-from-oauth-json.mjs ~/Downloads/client_secret_123-abc.apps.googleusercontent.com.json
 *   node scripts/env-from-oauth-json.mjs <arquivo.json> --out /tmp/teste.env
 *
 * Só dois campos do JSON viram variável:
 *   client_id     → GOOGLE_OAUTH_CLIENT_ID
 *   client_secret → GOOGLE_OAUTH_CLIENT_SECRET
 *
 * Qualquer outro campo (auth_uri, token_uri, project_id, auth_provider_x509_cert_url,
 * javascript_origins) NÃO entra no .env: são metadados/informação de endpoint.
 * redirect_uris é usado apenas como sugestão de GOOGLE_OAUTH_REDIRECT_URI.
 *
 * O segredo nunca é impresso na tela.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_REDIRECT = 'http://localhost:8081/auth/google/callback';

const args = process.argv.slice(2);
const jsonPath = args.find((arg) => !arg.startsWith('--'));
const outFlagIndex = args.indexOf('--out');
const outPath = resolve(outFlagIndex >= 0 ? (args[outFlagIndex + 1] ?? '.env') : '.env');

if (jsonPath === undefined) {
  console.error(
    [
      'Uso: node scripts/env-from-oauth-json.mjs <client_secret_....json> [--out .env]',
      '',
      'O arquivo é o que o Console do Google baixa em:',
      '  Google Auth Platform → Clientes → seu cliente → Baixar JSON'
    ].join('\n')
  );
  process.exit(1);
}

if (!existsSync(jsonPath)) {
  console.error(`Arquivo não encontrado: ${jsonPath}`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (error) {
  console.error(`Não é um JSON válido (${error.message}).`);
  process.exit(1);
}

const root = parsed.web ?? parsed.installed;
if (root === undefined || typeof root.client_id !== 'string') {
  console.error(
    'JSON não parece ser de um cliente OAuth. Esperado um objeto "web" ou "installed" com "client_id".'
  );
  process.exit(1);
}

const kind = parsed.web !== undefined ? 'web' : 'installed';
const clientId = root.client_id;
const clientSecret = typeof root.client_secret === 'string' ? root.client_secret : '';
const redirectUris = Array.isArray(root.redirect_uris) ? root.redirect_uris : [];
const javascriptOrigins = Array.isArray(root.javascript_origins) ? root.javascript_origins : [];

if (!clientId.endsWith('.apps.googleusercontent.com')) {
  console.error(`client_id inesperado (não termina em .apps.googleusercontent.com): ${clientId}`);
  process.exit(1);
}

if (clientSecret.length === 0) {
  console.error(
    'Este cliente não tem client_secret (normal em iOS/Android). Crie um cliente do tipo "Web" para o fluxo com backend.'
  );
  process.exit(1);
}

const redirect = redirectUris[0] ?? DEFAULT_REDIRECT;

const managed = {
  GOOGLE_CLOUD_PROJECT: 'at-mail-515112',
  GOOGLE_OAUTH_CLIENT_ID: clientId,
  GOOGLE_OAUTH_CLIENT_SECRET: clientSecret,
  GOOGLE_OAUTH_REDIRECT_URI: redirect
};

const existing = existsSync(outPath) ? readFileSync(outPath, 'utf8').split('\n') : readFileSync('.env.example', 'utf8').split('\n');
const seen = new Set();
const lines = existing.map((line) => {
  const match = /^([A-Z0-9_]+)=/.exec(line);
  if (match === null) return line;
  const key = match[1];
  if (!(key in managed)) return line;
  seen.add(key);
  return `${key}=${managed[key]}`;
});

for (const [key, value] of Object.entries(managed)) {
  if (!seen.has(key)) lines.push(`${key}=${value}`);
}

/** Mantém EXPO_PUBLIC_SYNC_API_URL comentado por padrão (modo demo). */
if (!lines.some((line) => line.startsWith('EXPO_PUBLIC_SYNC_API_URL=') || line.startsWith('# EXPO_PUBLIC_SYNC_API_URL='))) {
  lines.push('# EXPO_PUBLIC_SYNC_API_URL=http://localhost:8790');
}

writeFileSync(outPath, `${lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n').trimEnd()}\n`, {
  mode: 0o600
});
chmodSync(outPath, 0o600);

const masked = `${clientSecret.slice(0, 7)}${'*'.repeat(Math.max(0, clientSecret.length - 11))}${clientSecret.slice(-4)}`;

console.log(`\n@mail · credenciais gravadas em ${outPath} (permissão 600)`);
console.log(`  tipo do cliente : ${kind}`);
console.log(`  project_id json : ${root.project_id ?? '(ausente)'}`);
console.log(`  client_id       : ${clientId}`);
console.log(`  client_secret   : ${masked}`);
console.log(`  redirect_uri    : ${redirect}`);

if (javascriptOrigins.length > 0) {
  console.log(`  origens JS      : ${javascriptOrigins.join(', ')}`);
}
if (redirectUris.length === 0) {
  console.log('  aviso: JSON sem redirect_uris — usando o padrão de desenvolvimento.');
}
if (!redirect.startsWith('http://localhost:8081')) {
  console.log('  aviso: redirect diferente de http://localhost:8081 — confira as origens no Console.');
}

console.log('\n  Ignorados de propósito (não são variáveis de ambiente):');
for (const ignored of ['auth_uri', 'token_uri', 'auth_provider_x509_cert_url', 'universe_domain']) {
  if (root[ignored] !== undefined) console.log(`    ${ignored}: ${root[ignored]}`);
}

console.log('\n  Confira com: grep -c "^GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-" .env  → deve imprimir 1');
console.log('  O arquivo .env é ignorado pelo git; nunca comite o JSON baixado.\n');
