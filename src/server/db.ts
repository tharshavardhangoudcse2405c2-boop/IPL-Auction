import pg from 'pg';
import type { Pool as PoolType, PoolClient, QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

export class DatabaseNotConfiguredError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message = 'PostgreSQL DATABASE_URL is not configured on the server yet.') {
    super(message);
    this.name = 'DatabaseNotConfiguredError';
    this.code = 'DATABASE_NOT_CONFIGURED';
    this.status = 503;
  }
}

let poolInstance: PoolType | null = null;
let poolConnectionString: string | null = null;
let schemaReadyPromise: Promise<void> | null = null;

function readDatabaseUrl(): string {
  return (process.env.DATABASE_URL || '').trim();
}

export function isDatabaseConfigured(): boolean {
  const url = readDatabaseUrl();
  if (!url) return false;
  if (url === 'MY_DATABASE_URL' || url.includes('USER:PASSWORD@HOST')) return false;
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

function resolveSslConfig(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  const explicitSsl = (process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (explicitSsl === 'false') return false;
  if (explicitSsl === 'true') {
    return {
      rejectUnauthorized: (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED || '').trim().toLowerCase() !== 'false',
    };
  }

  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get('sslmode');
    if (sslMode === 'disable') return false;
    if (sslMode === 'require' || parsed.hostname.endsWith('.render.com')) {
      return { rejectUnauthorized: false };
    }
  } catch {
    // Fall back to default non-SSL for internal connections
  }

  return false;
}

export function getPool(): PoolType {
  if (!isDatabaseConfigured()) {
    throw new DatabaseNotConfiguredError(
      'Database is not configured. Set DATABASE_URL to your Render PostgreSQL internal connection string.',
    );
  }

  const connectionString = readDatabaseUrl();
  if (poolInstance && poolConnectionString === connectionString) {
    return poolInstance;
  }

  poolInstance = new Pool({
    connectionString,
    ssl: resolveSslConfig(connectionString),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
  });
  poolConnectionString = connectionString;

  poolInstance.on('error', () => {
    // Prevent unhandled pool idle errors from crashing the server process
  });

  return poolInstance;
}

export async function ensureAuthSchema(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new DatabaseNotConfiguredError(
      'Database is not configured. Set DATABASE_URL to your Render PostgreSQL internal connection string.',
    );
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          phone TEXT UNIQUE,
          display_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS otp_challenges (
          id TEXT PRIMARY KEY,
          channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
          target TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          request_ip TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_otp_challenges_lookup
          ON otp_challenges (channel, target, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires
          ON otp_challenges (expires_at);

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_user_id
          ON sessions (user_id);

        CREATE INDEX IF NOT EXISTS idx_sessions_expires
          ON sessions (expires_at);
      `);
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }

  return schemaReadyPromise;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  await ensureAuthSchema();
  return getPool().query<T>(sql, params);
}

export async function dbTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureAuthSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function cleanupExpiredAuthRecords(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  try {
    await dbQuery(
      `DELETE FROM otp_challenges WHERE expires_at < NOW() - INTERVAL '1 day'`,
    );
    await dbQuery(
      `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day' OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')`,
    );
  } catch {
    // Non-fatal periodic cleanup
  }
}
