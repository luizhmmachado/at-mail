import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export interface Db {
  pool: Pool;
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function serverlessDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432') url.port = '6543';
  return url.toString();
}

export async function openDb(connectionString: string): Promise<Db> {
  const pool = new Pool({ connectionString: serverlessDatabaseUrl(connectionString), max: 1, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000, allowExitOnIdle: true, ssl: { rejectUnauthorized: false } });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS atmail_users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT, created_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS atmail_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS atmail_credentials (account_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, scopes TEXT NOT NULL, updated_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS atmail_accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL, channel TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL, context_id TEXT NOT NULL, updated_at BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS atmail_notification_preferences (user_id TEXT NOT NULL, account_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, account_id));
    CREATE TABLE IF NOT EXISTS atmail_chat_thread_read_states (user_id TEXT NOT NULL, account_id TEXT NOT NULL, space_id TEXT NOT NULL, thread_name TEXT NOT NULL, last_read_time BIGINT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (user_id, account_id, thread_name));
    CREATE TABLE IF NOT EXISTS atmail_vault_records (user_id TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL, revision BIGINT NOT NULL, updated_at BIGINT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE, payload JSONB NOT NULL, PRIMARY KEY (user_id, kind, record_id));
    CREATE TABLE IF NOT EXISTS atmail_vault_meta (user_id TEXT PRIMARY KEY, revision BIGINT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS atmail_oauth_pending (state TEXT PRIMARY KEY, code TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL);
  `);
  return {
    pool,
    query: (text, values) => pool.query(text, values),
    async transaction(callback) { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
    close: () => pool.end()
  };
}
