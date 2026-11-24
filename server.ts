import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { generateAuctionWinnerAnalysis } from './src/server/aiAnalysis.ts';
import {
  AuthError,
  authenticateCookieHeader,
  clearSessionCookie,
  getAuthConfigurationSummary,
  getSessionTokenHashFromCookie,
  requestOtpChallenge,
  revokeSessionFromCookieHeader,
  setSessionCookie,
  updateAuthenticatedDisplayName,
  verifyCsrfOrOrigin,
  verifyOtpChallenge,
  verifyUpgradeOrigin,
  type AuthenticatedUser,
} from './src/server/auth.ts';
import {
  DatabaseNotConfiguredError,
  cleanupExpiredAuthRecords,
  ensureAuthSchema,
  isDatabaseConfigured,
} from './src/server/db.ts';
import { OtpDeliveryError } from './src/server/otpProviders.ts';
import { VERIFIED_PHOTO_URLS } from './src/server/verifiedPhotos.ts';
import {
  claimTeam,
  createRoomRuntime,
  extendTimer,
  fillOpenSeatsWithBots,
  finalizeCurrentLot,
  generateRoomCode,
  getFullPlayerPoolSummary,
  handlePlaceBid,
  joinRoom,
  openNextLot,
  pauseAuction,
  reauctionPlayer,
  rematchRoom,
  resumeAuction,
  startAuction,
  tickRoom,
  toggleParticipantReady,
  undoLastBid,
  updateLobbyConfig,
  updateTeamSettings,
  type RoomRuntime,
} from './src/server/auctionEngine.ts';
import { REAL_PLAYER_POOL } from './src/shared/data.ts';
import type { ClientMessage, PlayerRole, ServerMessage } from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface SocketMeta {
  ws: WebSocket;
  roomCode: string | null;
  clientId: string | null;
  userId: string;
  userDisplayName: string;
  sessionTokenHash: string | null;
}

interface CachedPhoto {
  buffer: Buffer;
  contentType: string;
}

const rooms = new Map<string, RoomRuntime>();
const socketMetas = new Map<WebSocket, SocketMeta>();
const photoCache = new Map<string, CachedPhoto>();
const photoInFlight = new Map<string, Promise<CachedPhoto | null>>();
const analysisInFlight = new Map<string, Promise<Awaited<ReturnType<typeof generateAuctionWinnerAnalysis>>>>();

const WIKI_USER_AGENT = 'RealAuction26Bot/1.0 (https://realauction26.local; admin@realauction26.local)';
const MAX_CONCURRENT_PHOTO_FETCHES = 8;
let activePhotoFetches = 0;
const photoFetchQueue: Array<() => void> = [];

function runWithWikiSlot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = () => {
      activePhotoFetches += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activePhotoFetches -= 1;
          const next = photoFetchQueue.shift();
          if (next) next();
        });
    };
    if (activePhotoFetches < MAX_CONCURRENT_PHOTO_FETCHES) {
      start();
    } else {
      photoFetchQueue.push(start);
    }
  });
}

const LOCAL_FALLBACK_PORTRAITS: Record<PlayerRole, string> = {
  Batter: 'player_portrait_batter_1795289107133.jpg',
  Bowler: 'player_portrait_pacer_1795289106811.jpg',
  'All-Rounder': 'player_portrait_allrounder_1795289107451.jpg',
  Wicketkeeper: 'player_portrait_keeper_1795289106537.jpg',
};

function isAllowedPlayerPhotoUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'upload.wikimedia.org' ||
      u.hostname === 'thumb.wikimedia.org' ||
      u.hostname.endsWith('.wikimedia.org') ||
      (u.hostname === 'www.iplt20.com' && u.pathname.startsWith('/api/team-assets')) ||
      u.hostname === 'static.cricbuzz.com'
    );
  } catch {
    return false;
  }
}

async function readLocalFallbackPortrait(role: PlayerRole): Promise<CachedPhoto | null> {
  const filename = LOCAL_FALLBACK_PORTRAITS[role] || 'player_portrait_batter_1795289107133.jpg';
  const candidateDirs = [
    path.resolve(__dirname, 'src/assets/images'),
    path.resolve(__dirname, 'dist/src/assets/images'),
  ];
  for (const imagesDir of candidateDirs) {
    try {
      const resolved = path.resolve(imagesDir, filename);
      if (resolved.startsWith(imagesDir + path.sep)) {
        const buffer = await fs.readFile(resolved);
        return { buffer, contentType: 'image/jpeg' };
      }
    } catch {
      // Try next directory
    }
  }
  return null;
}

async function resolvePlayerPhoto(playerId: string): Promise<CachedPhoto | null> {
  const cached = photoCache.get(playerId);
  if (cached) return cached;

  const existingPromise = photoInFlight.get(playerId);
  if (existingPromise) return existingPromise;

  const player = REAL_PLAYER_POOL.find((p) => p.id === playerId);
  if (!player) return null;

  const task = (async (): Promise<CachedPhoto | null> => {
    const verifiedUrl = VERIFIED_PHOTO_URLS[playerId];
    if (verifiedUrl && isAllowedPlayerPhotoUrl(verifiedUrl)) {
      try {
        const entry = await runWithWikiSlot(async (): Promise<CachedPhoto | null> => {
          const imgRes = await fetch(verifiedUrl, {
            headers: {
              'User-Agent': WIKI_USER_AGENT,
              Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(8000),
          });
          if (!imgRes.ok) return null;
          const ct = imgRes.headers.get('content-type') || 'image/jpeg';
          if (!ct.startsWith('image/')) return null;
          const arrayBuf = await imgRes.arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuf),
            contentType: ct,
          };
        });
        if (entry) {
          if (photoCache.size > 350) {
            const firstKey = photoCache.keys().next().value;
            if (firstKey) photoCache.delete(firstKey);
          }
          photoCache.set(playerId, entry);
          return entry;
        }
      } catch {
        // Fall through to temporary local portrait without poisoning photoCache
      }
    }

    return readLocalFallbackPortrait(player.role);
  })().finally(() => {
    photoInFlight.delete(playerId);
  });

  photoInFlight.set(playerId, task);
  return task;
}

function sendToSocket(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastRoomState(roomCode: string): void {
  const runtime = rooms.get(roomCode);
  if (!runtime) return;
  runtime.state.serverTime = Date.now();
  const payload = JSON.stringify({
    type: 'room:state',
    state: runtime.state,
  } satisfies ServerMessage);

  for (const meta of socketMetas.values()) {
    if (meta.roomCode === roomCode && meta.ws.readyState === WebSocket.OPEN) {
      meta.ws.send(payload);
    }
  }
}

function detachSocketFromRoom(meta: SocketMeta): void {
  const prevCode = meta.roomCode;
  const prevClientId = meta.clientId;
  meta.roomCode = null;
  meta.clientId = null;

  if (prevCode && prevClientId) {
    const runtime = rooms.get(prevCode);
    if (runtime) {
      const participant = runtime.state.participants.find((p) => p.clientId === prevClientId);
      if (participant) {
        const hasAnother = Array.from(socketMetas.values()).some(
          (m) => m.roomCode === prevCode && m.clientId === prevClientId,
        );
        if (!hasAnother) {
          participant.connected = false;
          broadcastRoomState(prevCode);
        }
      }
    }
  }
}

function allocateUniqueRoomCode(): string {
  for (let i = 0; i < 20; i++) {
    const code = generateRoomCode();
    if (!rooms.has(code)) return code;
  }
  return `${generateRoomCode()}${Math.floor(Math.random() * 9)}`;
}

async function startServer(): Promise<void> {
  if (isDatabaseConfigured()) {
    try {
      await ensureAuthSchema();
      await cleanupExpiredAuthRecords();
      console.log('Real Auction 26 PostgreSQL auth schema ready.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Warning: PostgreSQL auth schema initialization deferred:', msg);
    }
  } else {
    console.warn('Auth setup notice: DATABASE_URL is not configured yet. Configure Render PostgreSQL to enable login.');
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  const sendAuthError = (res: express.Response, err: unknown) => {
    if (err instanceof AuthError || err instanceof DatabaseNotConfiguredError || err instanceof OtpDeliveryError) {
      res.status(err.status).json({
        ok: false,
        code: err.code,
        message: err.message,
        ...(err instanceof AuthError && err.retryAfterSeconds
          ? { retryAfterSeconds: err.retryAfterSeconds }
          : {}),
      });
      return;
    }
    res.status(500).json({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Authentication service encountered an unexpected error. Please try again.',
    });
  };

  const requireCsrf = (req: express.Request, res: express.Response): boolean => {
    if (!verifyCsrfOrOrigin(req)) {
      res.status(403).json({
        ok: false,
        code: 'CSRF_BLOCKED',
        message: 'Request origin verification failed.',
      });
      return false;
    }
    return true;
  };

  const requireAuthenticatedUser = async (
    req: express.Request,
    res: express.Response,
  ): Promise<AuthenticatedUser | null> => {
    const user = await authenticateCookieHeader(req.headers.cookie);
    if (!user) {
      res.status(401).json({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Sign in with email or phone OTP to continue.',
      });
      return null;
    }
    return user;
  };

  app.get('/api/health', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    const authConfig = getAuthConfigurationSummary();
    res.json({
      ok: true,
      app: 'Real Auction 26',
      activeRooms: rooms.size,
      geminiConfigured: Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY'),
      auth: {
        database: authConfig.database,
        authSecret: authConfig.authSecret,
        email: authConfig.email,
        sms: authConfig.sms,
      },
      pool: getFullPlayerPoolSummary(),
      serverTime: Date.now(),
    });
  });

  app.get('/api/auth/me', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const providers = getAuthConfigurationSummary();
    const user = await authenticateCookieHeader(req.headers.cookie);
    res.json({
      ok: true,
      authenticated: Boolean(user),
      user,
      providers,
    });
  });

  app.post('/api/auth/request-otp', async (req, res) => {
    if (!requireCsrf(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    try {
      const result = await requestOtpChallenge(req, body.channel, body.target);
      res.json({ ok: true, ...result });
    } catch (err) {
      sendAuthError(res, err);
    }
  });

  app.post('/api/auth/verify-otp', async (req, res) => {
    if (!requireCsrf(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    try {
      const { user, rawToken } = await verifyOtpChallenge(
        req,
        body.channel,
        body.target,
        body.code,
        body.displayName,
      );
      setSessionCookie(req, res, rawToken);
      res.json({ ok: true, user });
    } catch (err) {
      sendAuthError(res, err);
    }
  });

  app.patch('/api/auth/profile', async (req, res) => {
    if (!requireCsrf(req, res)) return;
    const authUser = await requireAuthenticatedUser(req, res);
    if (!authUser) return;
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    try {
      const updated = await updateAuthenticatedDisplayName(authUser.id, body.displayName);
      for (const [code, runtime] of rooms.entries()) {
        let updatedRoom = false;
        for (const p of runtime.state.participants) {
          if (p.userId === updated.id) {
            p.name = updated.displayName;
            updatedRoom = true;
            for (const team of runtime.state.teams) {
              if (team.ownerClientId === p.clientId) {
                team.ownerName = updated.displayName;
              }
            }
          }
        }
        if (updatedRoom) {
          broadcastRoomState(code);
        }
      }
      res.json({ ok: true, user: updated });
    } catch (err) {
      sendAuthError(res, err);
    }
  });

  app.post('/api/auth/logout', async (req, res) => {
    if (!requireCsrf(req, res)) return;
    res.setHeader('Cache-Control', 'no-store');
    const tokenHash = getSessionTokenHashFromCookie(req.headers.cookie);
    await revokeSessionFromCookieHeader(req.headers.cookie);
    clearSessionCookie(req, res);

    if (tokenHash) {
      for (const meta of Array.from(socketMetas.values())) {
        if (meta.sessionTokenHash === tokenHash) {
          meta.ws.close(4401, 'Session signed out');
        }
      }
    }

    res.json({ ok: true });
  });

  app.get('/api/rooms/:code', async (req, res) => {
    const authUser = await requireAuthenticatedUser(req, res);
    if (!authUser) return;

    const code = String(req.params.code || '').trim().toUpperCase();
    const runtime = rooms.get(code);
    if (!runtime) {
      res.status(404).json({ exists: false, message: 'Room not found or expired.' });
      return;
    }
    res.json({
      exists: true,
      roomCode: runtime.state.roomCode,
      phase: runtime.state.phase,
      mode: runtime.state.config.mode,
      teamCount: runtime.state.teams.length,
      participantsCount: runtime.state.participants.filter((p) => p.connected).length,
    });
  });

  app.post('/api/rooms/:code/ai-analysis', async (req, res) => {
    if (!requireCsrf(req, res)) return;
    const authUser = await requireAuthenticatedUser(req, res);
    if (!authUser) return;

    const code = String(req.params.code || '').trim().toUpperCase();
    const runtime = rooms.get(code);
    if (!runtime) {
      res.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND', message: 'Auction room not found or expired.' });
      return;
    }

    const isParticipant = runtime.state.participants.some((p) => p.userId === authUser.id);
    if (!isParticipant) {
      res.status(403).json({
        ok: false,
        code: 'FORBIDDEN',
        message: 'Only participants in this auction room can request AI squad analysis.',
      });
      return;
    }

    if (runtime.state.phase !== 'COMPLETED') {
      res.status(400).json({
        ok: false,
        code: 'AUCTION_NOT_COMPLETED',
        message: 'AI winner analysis is only available once the auction concludes.',
      });
      return;
    }

    if (runtime.state.winnerAnalysis) {
      res.json({ ok: true, analysis: runtime.state.winnerAnalysis });
      return;
    }

    let pending = analysisInFlight.get(code);
    if (!pending) {
      pending = generateAuctionWinnerAnalysis(runtime.state).finally(() => {
        analysisInFlight.delete(code);
      });
      analysisInFlight.set(code, pending);
    }

    const result = await pending;
    if (!result.ok) {
      res.status(result.status).json({
        ok: false,
        code: result.code,
        message: result.message,
      });
      return;
    }

    runtime.state.winnerAnalysis = result.analysis;
    broadcastRoomState(code);
    res.json({ ok: true, analysis: result.analysis });
  });

  app.get('/api/player-photo/:id', async (req, res) => {
    const playerId = String(req.params.id || '').trim();
    const photo = await resolvePlayerPhoto(playerId);
    if (!photo) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(photo.buffer);
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const upgradeAuthMap = new WeakMap<
    http.IncomingMessage,
    { user: AuthenticatedUser; sessionTokenHash: string | null }
  >();

  server.on('upgrade', async (req, socket, head) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== '/ws') {
      if (isProduction) {
        socket.destroy();
      }
      return;
    }

    if (!verifyUpgradeOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const authUser = await authenticateCookieHeader(req.headers.cookie);
    if (!authUser) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionTokenHash = getSessionTokenHashFromCookie(req.headers.cookie);
    upgradeAuthMap.set(req, { user: authUser, sessionTokenHash });
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws, req) => {
    const authData = upgradeAuthMap.get(req);
    upgradeAuthMap.delete(req);
    if (!authData) {
      ws.close(4401, 'Authentication required');
      return;
    }
    const { user: authUser, sessionTokenHash } = authData;
    const meta: SocketMeta = {
      ws,
      roomCode: null,
      clientId: null,
      userId: authUser.id,
      userDisplayName: authUser.displayName,
      sessionTokenHash,
    };
    socketMetas.set(ws, meta);

    ws.on('message', (rawData) => {
      let msg: ClientMessage;
      try {
        const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
        if (text.length > 65536) {
          sendToSocket(ws, { type: 'room:error', message: 'Message exceeds maximum allowed size.' });
          return;
        }
        msg = JSON.parse(text) as ClientMessage;
      } catch {
        sendToSocket(ws, { type: 'room:error', message: 'Malformed request payload.' });
        return;
      }

      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
        sendToSocket(ws, { type: 'room:error', message: 'Invalid message format.' });
        return;
      }

      if (msg.type === 'ping') {
        sendToSocket(ws, {
          type: 'pong',
          serverTime: Date.now(),
          clientSentAt:
            typeof msg.clientSentAt === 'number' && Number.isFinite(msg.clientSentAt) ? msg.clientSentAt : undefined,
        });
        return;
      }

      if (msg.type === 'room:create') {
        detachSocketFromRoom(meta);
        const code = allocateUniqueRoomCode();
        const clientName =
          typeof msg.clientName === 'string' && msg.clientName.trim()
            ? msg.clientName.slice(0, 32)
            : meta.userDisplayName;
        const configObj = msg.config && typeof msg.config === 'object' ? msg.config : {};
        const customTeams = Array.isArray(msg.customTeams) ? msg.customTeams.slice(0, 12) : undefined;

        const { runtime, hostClientId, sessionToken } = createRoomRuntime(
          code,
          meta.userId,
          clientName,
          configObj,
          customTeams,
        );
        rooms.set(code, runtime);

        meta.roomCode = code;
        meta.clientId = hostClientId;

        sendToSocket(ws, {
          type: 'room:joined',
          roomCode: code,
          clientId: hostClientId,
          sessionToken,
          state: runtime.state,
        });
        return;
      }

      if (msg.type === 'room:join') {
        const code = typeof msg.roomCode === 'string' ? msg.roomCode.trim().toUpperCase() : '';
        if (!/^[A-Z0-9]{4,10}$/.test(code)) {
          sendToSocket(ws, {
            type: 'room:error',
            code: 'ROOM_NOT_FOUND',
            message: 'Enter a valid room code.',
          });
          return;
        }

        const runtime = rooms.get(code);
        if (!runtime) {
          sendToSocket(ws, {
            type: 'room:error',
            code: 'ROOM_NOT_FOUND',
            message: `Room "${code}" was not found. Check the code or start a new room.`,
          });
          return;
        }

        detachSocketFromRoom(meta);

        const clientName =
          typeof msg.clientName === 'string' && msg.clientName.trim()
            ? msg.clientName.slice(0, 32)
            : meta.userDisplayName;
        const incomingClientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : undefined;
        const incomingToken = typeof msg.sessionToken === 'string' ? msg.sessionToken.slice(0, 128) : undefined;

        const { sessionToken, participant } = joinRoom(
          runtime,
          meta.userId,
          incomingClientId,
          clientName,
          incomingToken,
        );

        meta.roomCode = code;
        meta.clientId = participant.clientId;

        sendToSocket(ws, {
          type: 'room:joined',
          roomCode: code,
          clientId: participant.clientId,
          sessionToken,
          state: runtime.state,
        });
        broadcastRoomState(code);
        return;
      }

      // All remaining actions strictly derive identity & room from server-side SocketMeta
      if (!meta.roomCode || !meta.clientId) {
        sendToSocket(ws, { type: 'room:error', message: 'You are not connected to an active room.' });
        return;
      }

      const runtime = rooms.get(meta.roomCode);
      if (!runtime) {
        meta.roomCode = null;
        meta.clientId = null;
        sendToSocket(ws, { type: 'room:error', code: 'ROOM_EXPIRED', message: 'Room no longer exists.' });
        return;
      }

      const clientId = meta.clientId;
      const roomCode = meta.roomCode;

      switch (msg.type) {
        case 'room:update_config': {
          const err = updateLobbyConfig(
            runtime,
            clientId,
            msg.config && typeof msg.config === 'object' ? msg.config : {},
          );
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'room:update_team': {
          if (typeof msg.teamId !== 'string' || !msg.teamId) {
            sendToSocket(ws, { type: 'room:error', message: 'Invalid team ID.' });
            break;
          }
          const err = updateTeamSettings(runtime, clientId, {
            teamId: msg.teamId,
            name: typeof msg.name === 'string' ? msg.name : undefined,
            shortCode: typeof msg.shortCode === 'string' ? msg.shortCode : undefined,
            color: typeof msg.color === 'string' ? msg.color : undefined,
            controlType: msg.controlType === 'human' || msg.controlType === 'bot' ? msg.controlType : undefined,
          });
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'room:claim_team': {
          const targetTeamId = msg.teamId === null ? null : typeof msg.teamId === 'string' ? msg.teamId : null;
          if (msg.teamId !== null && typeof msg.teamId !== 'string') {
            sendToSocket(ws, { type: 'room:error', message: 'Invalid franchise selection.' });
            break;
          }
          const err = claimTeam(runtime, clientId, targetTeamId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'room:fill_bots': {
          const err = fillOpenSeatsWithBots(runtime, clientId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'room:toggle_ready': {
          toggleParticipantReady(runtime, clientId, Boolean(msg.ready));
          broadcastRoomState(roomCode);
          break;
        }
        case 'auction:start': {
          const err = startAuction(runtime, clientId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:bid': {
          const teamId = typeof msg.teamId === 'string' ? msg.teamId : '';
          const expectedAmount =
            typeof msg.expectedAmount === 'number' && Number.isFinite(msg.expectedAmount)
              ? msg.expectedAmount
              : -1;

          const result = handlePlaceBid(runtime, teamId, expectedAmount, clientId, false);
          if (!result.ok) {
            sendToSocket(ws, {
              type: 'bid:rejected',
              teamId,
              reason: result.reason || 'Bid rejected.',
            });
            sendToSocket(ws, { type: 'room:state', state: runtime.state });
          } else {
            sendToSocket(ws, {
              type: 'bid:accepted',
              teamId,
              amount: result.amount!,
              lotEndsAt: result.lotEndsAt!,
              serverTime: Date.now(),
            });
            broadcastRoomState(roomCode);
          }
          break;
        }
        case 'auction:pause': {
          const err = pauseAuction(runtime, clientId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:resume': {
          const err = resumeAuction(runtime, clientId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:extend_timer': {
          const extra = typeof msg.extraSeconds === 'number' && Number.isFinite(msg.extraSeconds) ? msg.extraSeconds : 5;
          const err = extendTimer(runtime, clientId, extra);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:hammer_now': {
          const p = runtime.state.participants.find((item) => item.clientId === clientId && item.connected);
          if (!p?.isHost) {
            sendToSocket(ws, { type: 'room:error', message: 'Only the host can hammer a lot early.' });
          } else if (!runtime.state.currentLot?.leadingTeamId) {
            sendToSocket(ws, { type: 'room:error', message: 'No active bid to hammer. Use Skip Lot instead.' });
          } else {
            finalizeCurrentLot(runtime, false);
            broadcastRoomState(roomCode);
          }
          break;
        }
        case 'auction:skip_lot': {
          const p = runtime.state.participants.find((item) => item.clientId === clientId && item.connected);
          if (!p?.isHost) {
            sendToSocket(ws, { type: 'room:error', message: 'Only the host can skip a lot.' });
          } else if (!runtime.state.currentLot) {
            sendToSocket(ws, { type: 'room:error', message: 'No active lot to skip.' });
          } else {
            finalizeCurrentLot(runtime, true);
            broadcastRoomState(roomCode);
          }
          break;
        }
        case 'auction:undo_bid': {
          const err = undoLastBid(runtime, clientId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:reauction_player': {
          const playerId = typeof msg.playerId === 'string' ? msg.playerId : '';
          const err = reauctionPlayer(runtime, clientId, playerId);
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        case 'auction:next_lot': {
          const p = runtime.state.participants.find((item) => item.clientId === clientId && item.connected);
          if (!p?.isHost) {
            sendToSocket(ws, { type: 'room:error', message: 'Only the host can advance lots manually.' });
          } else if (runtime.state.phase === 'LOT_RESULT') {
            openNextLot(runtime);
            broadcastRoomState(roomCode);
          }
          break;
        }
        case 'auction:end_early': {
          const p = runtime.state.participants.find((item) => item.clientId === clientId && item.connected);
          if (!p?.isHost) {
            sendToSocket(ws, { type: 'room:error', message: 'Only the host can conclude the auction.' });
          } else {
            runtime.state.phase = 'COMPLETED';
            runtime.state.currentLot = null;
            runtime.autoAdvanceAt = null;
            broadcastRoomState(roomCode);
          }
          break;
        }
        case 'auction:rematch': {
          const err = rematchRoom(runtime, clientId, Boolean(msg.keepSettings));
          if (err) sendToSocket(ws, { type: 'room:error', message: err });
          else broadcastRoomState(roomCode);
          break;
        }
        default: {
          sendToSocket(ws, { type: 'room:error', message: 'Unsupported action type.' });
        }
      }
    });

    ws.on('close', () => {
      socketMetas.delete(ws);
      detachSocketFromRoom(meta);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [code, runtime] of rooms.entries()) {
      const changed = tickRoom(runtime, now);
      if (changed) {
        broadcastRoomState(code);
      }

      const hasConnected = runtime.state.participants.some((p) => p.connected);
      if (!hasConnected && now - runtime.lastTickAt > 6 * 60 * 60 * 1000) {
        rooms.delete(code);
      }
    }
  }, 250);

  setInterval(() => {
    void cleanupExpiredAuthRecords();
  }, 60 * 60 * 1000);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (!isProduction) {
    const vite = await import('vite');
    const viteServer = await vite.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Real Auction 26 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
