class SyncError extends Error {
  constructor(message: string, readonly kind: 'auth' | 'rate-limit' | 'network' | 'provider' | 'unknown' = 'unknown') { super(message); }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export interface GoogleUser { sub: string; email: string; name?: string; picture?: string; email_verified?: boolean }

export async function exchangeCode(input: { code: string; codeVerifier?: string; redirectUri: string; clientId: string; clientSecret: string }): Promise<{ accessToken: string; refreshToken?: string; scope: string }> {
  const body = new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: 'authorization_code' });
  if (input.codeVerifier) body.set('code_verifier', input.codeVerifier);
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = await response.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!response.ok || !json.access_token) throw new SyncError(`OAuth Google: ${json.error ?? response.status}`, 'auth');
  return { accessToken: json.access_token, refreshToken: json.refresh_token, scope: json.scope ?? '' };
}

export async function getUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new SyncError(`userinfo Google: ${response.status}`, 'auth');
  return await response.json() as GoogleUser;
}

export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const json = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !json.access_token) throw new SyncError(`refresh Google: ${json.error ?? response.status}`, 'auth');
  return json.access_token;
}

/** Revoga o refresh token no Google: desconectar a conta precisa invalidar o grant. */
export async function revokeToken(token: string): Promise<void> {
  if (token.length === 0) return;
  const response = await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token })
  });
  if (!response.ok) throw new SyncError(`revogação Google: ${response.status}`, 'provider');
}
