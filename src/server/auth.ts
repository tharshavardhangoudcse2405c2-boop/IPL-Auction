import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Request, Response } from 'express';
import {
  DatabaseNotConfiguredError,
  dbQuery,
  dbTransaction,
  isDatabaseConfigured,
} from './db.ts';
import {
  OtpDeliveryError,
  getEmailProviderStatus,
  getSmsProviderStatus,
  sendEmailOtp,
  sendSmsOtp,
} from './otpProviders.ts';

export type OtpChannel = 'email' | 'phone';

export interface AuthenticatedUser {
  id: string;
  displayName: string;
  channel: OtpChannel;
  email: string | null;
  phone: string | null;
  maskedTarget: string;
}

export interface AuthConfigurationSummary {
  database: boolean;
  authSecret: boolean;
  email: boolean;
  sms: boolean;
  missingDatabaseVars: string[];
  missingEmailVars: string[];
  missingSmsVars: string[];
}

export class AuthError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(code: string, message: string, status = 400, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const SESSION_COOKIE_NAME = 'ra26_session';
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 45;
const OTP_MAX_ATTEMPTS = 5;
const OTP_HOURLY_TARGET_LIMIT = 6;
const SESSION_TTL_DAYS = 30;
const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

// In-memory sliding window IP rate limiter (supplements persistent DB per-target throttling)
const ipRequestTimestamps = new Map<string, number[]>();
const IP_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUEST_OTP_PER_IP = 15;
const MAX_VERIFY_OTP_PER_IP = 25;

function readAuthSecret(): string {
  return (process.env.AUTH_SECRET || '').trim();
}

export function isAuthSecretConfigured(): boolean {
  const secret = readAuthSecret();
  if (!secret || secret.length < 16) return false;
  const upper = secret.toUpperCase();
  if (
    upper.startsWith('MY_') ||
    upper.includes('CHANGE_ME') ||
    upper.includes('YOUR_SECRET') ||
    upper.includes('REPLACE_')
  ) {
    return false;
  }
  return true;
}

export function getAuthConfigurationSummary(): AuthConfigurationSummary {
  const dbReady = isDatabaseConfigured();
  const secretReady = isAuthSecretConfigured();
  const emailStatus = getEmailProviderStatus();
  const smsStatus = getSmsProviderStatus();

  const missingDatabaseVars: string[] = [];
  if (!dbReady) missingDatabaseVars.push('DATABASE_URL');
  if (!secretReady) missingDatabaseVars.push('AUTH_SECRET');

  return {
    database: dbReady,
    authSecret: secretReady,
    email: emailStatus.configured,
    sms: smsStatus.configured,
    missingDatabaseVars,
    missingEmailVars: emailStatus.missing,
    missingSmsVars: smsStatus.missing,
  };
}

function assertCoreAuthReady(): string {
  if (!isDatabaseConfigured()) {
    throw new DatabaseNotConfiguredError(
      'Database is not configured on the server yet. Add DATABASE_URL in Render to enable accounts and persistent sessions.',
    );
  }
  if (!isAuthSecretConfigured()) {
    throw new AuthError(
      'AUTH_SECRET_NOT_CONFIGURED',
      'Server session signing key is missing. Set AUTH_SECRET (at least 16 random characters) in your Render environment variables.',
      503,
    );
  }
  return readAuthSecret();
}

function hmacHex(secret: string, input: string): string {
  return crypto.createHmac('sha256', secret).update(input, 'utf8').digest('hex');
}

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getClientIp(req: Request | IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim().slice(0, 64);
  }
  if (Array.isArray(fwd) && fwd[0]) {
    return fwd[0].split(',')[0].trim().slice(0, 64);
  }
  return (req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

function checkIpRateLimit(bucketKey: string, maxRequests: number): void {
  const now = Date.now();
  const cutoff = now - IP_WINDOW_MS;
  const recent = (ipRequestTimestamps.get(bucketKey) || []).filter((ts) => ts > cutoff);
  if (recent.length >= maxRequests) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + IP_WINDOW_MS - now) / 1000));
    throw new AuthError(
      'RATE_LIMITED',
      `Too many requests from your network. Please wait ${retryAfterSeconds} seconds before trying again.`,
      429,
      retryAfterSeconds,
    );
  }
  recent.push(now);
  ipRequestTimestamps.set(bucketKey, recent);

  if (ipRequestTimestamps.size > 5000) {
    for (const [key, list] of ipRequestTimestamps.entries()) {
      const kept = list.filter((ts) => ts > cutoff);
      if (kept.length === 0) ipRequestTimestamps.delete(key);
      else ipRequestTimestamps.set(key, kept);
    }
  }
}

export function validateAndNormalizeTarget(channel: unknown, rawTarget: unknown): {
  channel: OtpChannel;
  target: string;
} {
  if (channel !== 'email' && channel !== 'phone') {
    throw new AuthError('INVALID_CHANNEL', 'Choose either email or phone verification.', 400);
  }

  if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
    throw new AuthError(
      'INVALID_TARGET',
      channel === 'email' ? 'Enter your email address.' : 'Enter your phone number with country code.',
      400,
    );
  }

  const trimmed = rawTarget.trim();

  if (channel === 'email') {
    if (/[\r\n\0]/.test(trimmed)) {
      throw new AuthError('INVALID_EMAIL', 'Enter a valid email address.', 400);
    }
    const normalized = trimmed.toLowerCase();
    if (
      normalized.length > 254 ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(normalized)
    ) {
      throw new AuthError('INVALID_EMAIL', 'Enter a valid email address (for example name@gmail.com).', 400);
    }
    return { channel: 'email', target: normalized };
  }

  const compact = trimmed.replace(/[\s\-().]/g, '');
  if (!compact.startsWith('+')) {
    throw new AuthError(
      'INVALID_PHONE',
      'Include your country code starting with + (for example +919876543210 or +14155550123).',
      400,
    );
  }
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) {
    throw new AuthError(
      'INVALID_PHONE',
      'Enter a valid international phone number with country code (8 to 15 digits after +).',
      400,
    );
  }
  return { channel: 'phone', target: compact };
}

export function maskTarget(channel: OtpChannel, target: string): string {
  if (channel === 'email') {
    const [local, domain] = target.split('@');
    if (!local || !domain) return 'Verified email';
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}***@${domain}`;
  }
  const suffix = target.slice(-4);
  const prefix = target.slice(0, Math.min(3, target.length));
  return `${prefix}***${suffix}`;
}

function deriveDefaultDisplayName(channel: OtpChannel, target: string, requestedName?: unknown): string {
  if (typeof requestedName === 'string' && requestedName.trim()) {
    return requestedName.trim().slice(0, 32);
  }
  if (channel === 'email') {
    const localPart = target.split('@')[0] || 'Manager';
    const cleaned = localPart
      .replace(/[._-]+/g, ' ')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    return (cleaned || 'Manager').slice(0, 32);
  }
  const last4 = target.slice(-4);
  return `Manager ${last4}`.slice(0, 32);
}

export async function requestOtpChallenge(
  req: Request,
  rawChannel: unknown,
  rawTarget: unknown,
): Promise<{ channel: OtpChannel; maskedTarget: string; expiresInSeconds: number; resendAfterSeconds: number }> {
  const secret = assertCoreAuthReady();
  const { channel, target } = validateAndNormalizeTarget(rawChannel, rawTarget);
  const ip = getClientIp(req);

  checkIpRateLimit(`req:${ip}`, MAX_REQUEST_OTP_PER_IP);

  if (channel === 'email') {
    const emailStatus = getEmailProviderStatus();
    if (!emailStatus.configured) {
      throw new OtpDeliveryError(
        'EMAIL_NOT_CONFIGURED',
        `Email OTP is not configured on the server yet. Missing: ${emailStatus.missing.join(', ')}.`,
        503,
      );
    }
  } else {
    const smsStatus = getSmsProviderStatus();
    if (!smsStatus.configured) {
      throw new OtpDeliveryError(
        'SMS_NOT_CONFIGURED',
        `Phone SMS OTP is not configured on the server yet. Missing: ${smsStatus.missing.join(', ')}.`,
        503,
      );
    }
  }

  const rateStats = await dbQuery<{
    latest_created_at: Date | string | null;
    hourly_count: string | number;
  }>(
    `
      SELECT
        MAX(created_at) AS latest_created_at,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS hourly_count
      FROM otp_challenges
      WHERE channel = $1 AND target = $2
    `,
    [channel, target],
  );

  const row = rateStats.rows[0];
  if (row?.latest_created_at) {
    const elapsedSec = (Date.now() - new Date(row.latest_created_at).getTime()) / 1000;
    if (elapsedSec < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitSec = Math.max(1, Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsedSec));
      throw new AuthError(
        'OTP_COOLDOWN',
        `Please wait ${waitSec} seconds before requesting another verification code.`,
        429,
        waitSec,
      );
    }
  }

  if (Number(row?.hourly_count || 0) >= OTP_HOURLY_TARGET_LIMIT) {
    throw new AuthError(
      'OTP_HOURLY_LIMIT',
      'Too many verification codes requested for this destination. Please try again later.',
      429,
      600,
    );
  }

  const challengeId = `otp-${crypto.randomBytes(12).toString('hex')}`;
  const otpCode = String(crypto.randomInt(100000, 1000000));
  const codeHash = hmacHex(secret, `${challengeId}:${channel}:${target}:${otpCode}`);

  await dbQuery(
    `
      INSERT INTO otp_challenges (id, channel, target, code_hash, attempts, expires_at, request_ip)
      VALUES ($1, $2, $3, $4, 0, NOW() + ($5 * INTERVAL '1 minute'), $6)
    `,
    [challengeId, channel, target, codeHash, OTP_TTL_MINUTES, ip],
  );

  try {
    if (channel === 'email') {
      await sendEmailOtp({ to: target, code: otpCode, expiresMinutes: OTP_TTL_MINUTES });
    } else {
      await sendSmsOtp({ to: target, code: otpCode, expiresMinutes: OTP_TTL_MINUTES });
    }
  } catch (err) {
    // Clean up failed unsent challenge so user isn't penalized with stale challenge state
    try {
      await dbQuery(`DELETE FROM otp_challenges WHERE id = $1`, [challengeId]);
    } catch {
      // Ignore cleanup failure
    }
    throw err;
  }

  // Invalidate any older unconsumed challenges for this destination now that the new one succeeded
  await dbQuery(
    `
      UPDATE otp_challenges
      SET consumed_at = NOW()
      WHERE channel = $1 AND target = $2 AND id <> $3 AND consumed_at IS NULL
    `,
    [channel, target, challengeId],
  );

  return {
    channel,
    maskedTarget: maskTarget(channel, target),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

export async function verifyOtpChallenge(
  req: Request,
  rawChannel: unknown,
  rawTarget: unknown,
  rawCode: unknown,
  rawDisplayName?: unknown,
): Promise<{ user: AuthenticatedUser; rawToken: string }> {
  const secret = assertCoreAuthReady();
  const { channel, target } = validateAndNormalizeTarget(rawChannel, rawTarget);
  const ip = getClientIp(req);

  checkIpRateLimit(`verify:${ip}`, MAX_VERIFY_OTP_PER_IP);

  const normalizedCode = typeof rawCode === 'string' ? rawCode.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new AuthError('INVALID_CODE_FORMAT', 'Enter the 6-digit verification code.', 400);
  }

  const lookup = await dbQuery<{
    id: string;
    code_hash: string;
    attempts: number;
    expires_at: Date | string;
    consumed_at: Date | string | null;
  }>(
    `
      SELECT id, code_hash, attempts, expires_at, consumed_at
      FROM otp_challenges
      WHERE channel = $1 AND target = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [channel, target],
  );

  const challenge = lookup.rows[0];
  if (!challenge) {
    throw new AuthError(
      'OTP_NOT_FOUND',
      'No active verification code was found. Please request a new code.',
      400,
    );
  }

  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    await dbQuery(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challenge.id]);
    throw new AuthError(
      'OTP_EXPIRED',
      'That verification code has expired. Request a new code to continue.',
      400,
    );
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await dbQuery(`UPDATE otp_challenges SET consumed_at = NOW() WHERE id = $1`, [challenge.id]);
    throw new AuthError(
      'OTP_LOCKED',
      'Too many incorrect code attempts. Request a new verification code.',
      429,
    );
  }

  const expectedHash = hmacHex(secret, `${challenge.id}:${channel}:${target}:${normalizedCode}`);
  if (!safeHexEqual(expectedHash, challenge.code_hash)) {
    const nextAttempts = challenge.attempts + 1;
    const locked = nextAttempts >= OTP_MAX_ATTEMPTS;
    await dbQuery(
      `
        UPDATE otp_challenges
        SET attempts = $2,
            consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END
        WHERE id = $1
      `,
      [challenge.id, nextAttempts, locked],
    );

    if (locked) {
      throw new AuthError(
        'OTP_LOCKED',
        'Too many incorrect attempts. Please request a new verification code.',
        429,
      );
    }

    const remaining = OTP_MAX_ATTEMPTS - nextAttempts;
    throw new AuthError(
      'OTP_INVALID',
      `Incorrect verification code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.`,
      401,
    );
  }

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hmacHex(secret, `session:${rawToken}`);
  const sessionId = `ses-${crypto.randomBytes(12).toString('hex')}`;
  const requestedDisplayName = typeof rawDisplayName === 'string' && rawDisplayName.trim()
    ? rawDisplayName.trim().slice(0, 32)
    : null;

  const user = await dbTransaction(async (client) => {
    const consumed = await client.query<{ id: string }>(
      `
        UPDATE otp_challenges
        SET consumed_at = NOW()
        WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()
        RETURNING id
      `,
      [challenge.id],
    );

    if (consumed.rowCount === 0) {
      throw new AuthError(
        'OTP_ALREADY_USED',
        'This verification code has already been used or expired. Request a new code.',
        400,
      );
    }

    const existingUser = await client.query<{
      id: string;
      email: string | null;
      phone: string | null;
      display_name: string;
    }>(
      channel === 'email'
        ? `SELECT id, email, phone, display_name FROM users WHERE email = $1 LIMIT 1`
        : `SELECT id, email, phone, display_name FROM users WHERE phone = $1 LIMIT 1`,
      [target],
    );

    let userRow: {
      id: string;
      email: string | null;
      phone: string | null;
      display_name: string;
    };

    if (existingUser.rows[0]) {
      const current = existingUser.rows[0];
      const nextName = requestedDisplayName || current.display_name;
      const updated = await client.query<typeof userRow>(
        `
          UPDATE users
          SET last_login_at = NOW(), display_name = $2
          WHERE id = $1
          RETURNING id, email, phone, display_name
        `,
        [current.id, nextName],
      );
      userRow = updated.rows[0];
    } else {
      const newUserId = `usr-${crypto.randomBytes(12).toString('hex')}`;
      const displayName = deriveDefaultDisplayName(channel, target, requestedDisplayName);
      const inserted = await client.query<typeof userRow>(
        channel === 'email'
          ? `INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3) RETURNING id, email, phone, display_name`
          : `INSERT INTO users (id, phone, display_name) VALUES ($1, $2, $3) RETURNING id, email, phone, display_name`,
        [newUserId, target, displayName],
      );
      userRow = inserted.rows[0];
    }

    await client.query(
      `
        INSERT INTO sessions (id, user_id, token_hash, expires_at)
        VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'))
      `,
      [sessionId, userRow.id, tokenHash, SESSION_TTL_DAYS],
    );

    const activeChannel: OtpChannel = userRow.email ? 'email' : 'phone';
    const rawDest = userRow.email || userRow.phone || target;
    return {
      id: userRow.id,
      displayName: userRow.display_name,
      channel: activeChannel,
      email: userRow.email,
      phone: userRow.phone,
      maskedTarget: maskTarget(activeChannel, rawDest),
    } satisfies AuthenticatedUser;
  });

  return { user, rawToken };
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function isSecureTransport(req: Request | IncomingMessage): boolean {
  const protoHeader = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader;
  if (typeof proto === 'string' && proto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  if ('secure' in req && req.secure) {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return true;
  }
  const appUrl = (process.env.APP_URL || '').trim();
  return appUrl.startsWith('https://');
}

export function setSessionCookie(req: Request, res: Response, rawToken: string): void {
  const secure = isSecureTransport(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isSecureTransport(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function getSessionTokenHashFromCookie(cookieHeader: string | undefined): string | null {
  if (!isAuthSecretConfigured()) return null;
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken || rawToken.length < 16 || rawToken.length > 256) {
    return null;
  }
  return hmacHex(readAuthSecret(), `session:${rawToken}`);
}

export async function authenticateCookieHeader(
  cookieHeader: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!isDatabaseConfigured() || !isAuthSecretConfigured()) {
    return null;
  }
  const tokenHash = getSessionTokenHashFromCookie(cookieHeader);
  if (!tokenHash) {
    return null;
  }

  try {
    const res = await dbQuery<{
      session_id: string;
      last_seen_at: Date | string;
      user_id: string;
      email: string | null;
      phone: string | null;
      display_name: string;
    }>(
      `
        SELECT
          s.id AS session_id,
          s.last_seen_at,
          u.id AS user_id,
          u.email,
          u.phone,
          u.display_name
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash],
    );

    const row = res.rows[0];
    if (!row) return null;

    const lastSeenAgeMs = Date.now() - new Date(row.last_seen_at).getTime();
    if (lastSeenAgeMs > 5 * 60 * 1000) {
      void dbQuery(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [row.session_id]).catch(() => {});
    }

    const activeChannel: OtpChannel = row.email ? 'email' : 'phone';
    const rawDest = row.email || row.phone || '';
    return {
      id: row.user_id,
      displayName: row.display_name,
      channel: activeChannel,
      email: row.email,
      phone: row.phone,
      maskedTarget: rawDest ? maskTarget(activeChannel, rawDest) : 'Verified account',
    };
  } catch {
    return null;
  }
}

export async function revokeSessionFromCookieHeader(cookieHeader: string | undefined): Promise<void> {
  if (!isDatabaseConfigured() || !isAuthSecretConfigured()) return;
  const cookies = parseCookies(cookieHeader);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return;

  const secret = readAuthSecret();
  const tokenHash = hmacHex(secret, `session:${rawToken}`);
  try {
    await dbQuery(
      `UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  } catch {
    // Best-effort revocation; cookie will still be cleared client-side
  }
}

export async function updateAuthenticatedDisplayName(
  userId: string,
  rawDisplayName: unknown,
): Promise<AuthenticatedUser> {
  assertCoreAuthReady();
  const trimmed = typeof rawDisplayName === 'string' ? rawDisplayName.trim().slice(0, 32) : '';
  if (!trimmed || trimmed.length < 2) {
    throw new AuthError('INVALID_NAME', 'Enter a display name with at least 2 characters.', 400);
  }
  const res = await dbQuery<{
    id: string;
    email: string | null;
    phone: string | null;
    display_name: string;
  }>(
    `UPDATE users SET display_name = $2 WHERE id = $1 RETURNING id, email, phone, display_name`,
    [userId, trimmed],
  );
  const row = res.rows[0];
  if (!row) {
    throw new AuthError('USER_NOT_FOUND', 'User account not found.', 404);
  }
  const activeChannel: OtpChannel = row.email ? 'email' : 'phone';
  const rawDest = row.email || row.phone || '';
  return {
    id: row.id,
    displayName: row.display_name,
    channel: activeChannel,
    email: row.email,
    phone: row.phone,
    maskedTarget: rawDest ? maskTarget(activeChannel, rawDest) : 'Verified account',
  };
}

export function verifyCsrfOrOrigin(req: Request): boolean {
  const customHeader = req.headers['x-requested-with'];
  if (customHeader === 'RealAuction26') {
    return true;
  }
  const origin = req.headers.origin;
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function verifyUpgradeOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const hostHeader = req.headers['x-forwarded-host'] || req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return false;
  try {
    const originHost = new URL(origin).host;
    if (originHost === host) return true;
    const appUrl = (process.env.APP_URL || '').trim();
    if (appUrl && !appUrl.startsWith('MY_')) {
      try {
        if (new URL(appUrl).host === originHost) return true;
      } catch {
        // Ignore invalid APP_URL
      }
    }
    return false;
  } catch {
    return false;
  }
}
