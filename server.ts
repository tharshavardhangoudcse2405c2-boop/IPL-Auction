import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { generateAuctionWinnerAnalysis } from './src/server/aiAnalysis.ts';
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
  scheduleBotsForCurrentLot,
  startAuction,
  tickRoom,
  timingSafeTokenEquals,
  toggleParticipantReady,
  undoLastBid,
  updateLobbyConfig,
  updateTeamSettings,
  type RoomRuntime,
} from './src/server/auctionEngine.ts';
import { REAL_PLAYER_POOL } from './src/shared/data.ts';
import type {
  ClientMessage,
  PlayerRole,
  ServerMessage,
  VoicePeerState,
  VoiceSignalPayload,
} from './src/shared/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface SocketMeta {
  ws: WebSocket;
  roomCode: string | null;
  clientId: string | null;
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

const ROOMS_SNAPSHOT_PATH = path.join(os.tmpdir(), 'real-auction-26-rooms.json');
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
let persistTimer: NodeJS.Timeout | null = null;

interface PersistedRoomRecord {
  state: RoomRuntime['state'];
  sessionTokens: Array<[string, string]>;
  autoAdvanceAt: number | null;
  lastTickAt: number;
}

async function writeRoomsSnapshot(): Promise<void> {
  try {
    const records: PersistedRoomRecord[] = [];
    for (const runtime of rooms.values()) {
      records.push({
        state: runtime.state,
        sessionTokens: Array.from(runtime.sessionTokens.entries()),
        autoAdvanceAt: runtime.autoAdvanceAt,
        lastTickAt: runtime.lastTickAt,
      });
    }
    const tmpPath = `${ROOMS_SNAPSHOT_PATH}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(records), 'utf8');
    await fs.rename(tmpPath, ROOMS_SNAPSHOT_PATH);
  } catch {
    // Best-effort local persistence
  }
}

function schedulePersistRooms(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void writeRoomsSnapshot();
  }, 250);
}

async function restoreRoomsSnapshot(): Promise<void> {
  try {
    const raw = await fs.readFile(ROOMS_SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as PersistedRoomRecord[];
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    for (const rec of parsed) {
      if (!rec?.state?.roomCode || !Array.isArray(rec.state.playerQueue)) continue;
      if (now - (rec.lastTickAt || rec.state.createdAt || now) > ROOM_TTL_MS) continue;
      for (const p of rec.state.participants ?? []) {
        p.connected = false;
      }
      if (rec.state.phase === 'LIVE' && rec.state.currentLot) {
        rec.state.currentLot.lotEndsAt = now + Math.max(8, rec.state.config.timerSeconds) * 1000;
      }
      const runtime: RoomRuntime = {
        state: rec.state,
        sessionTokens: new Map(Array.isArray(rec.sessionTokens) ? rec.sessionTokens : []),
        botLotValuations: new Map(),
        botReadyAt: new Map(),
        voicePeers: new Map(),
        autoAdvanceAt: rec.autoAdvanceAt ?? null,
        lastTickAt: now,
      };
      if (rec.state.phase === 'LIVE' && rec.state.currentLot) {
        scheduleBotsForCurrentLot(runtime, now);
      }
      rooms.set(rec.state.roomCode, runtime);
    }
  } catch {
    // Snapshot may not exist yet on first run
  }
}

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
  schedulePersistRooms();
}

function buildVoicePeersList(runtime: RoomRuntime): VoicePeerState[] {
  const peers: VoicePeerState[] = [];
  for (const participant of runtime.state.participants) {
    if (!participant.connected) continue;
    const team = runtime.state.teams.find((t) => t.ownerClientId === participant.clientId);
    const voice = runtime.voicePeers.get(participant.clientId);
    peers.push({
      clientId: participant.clientId,
      name: participant.name,
      teamShortCode: team?.shortCode ?? null,
      joined: Boolean(voice?.joined),
      micActive: Boolean(voice?.micActive),
      speaking: Boolean(voice?.micActive && voice?.speaking),
    });
  }
  return peers;
}

function broadcastVoicePeers(roomCode: string): void {
  const runtime = rooms.get(roomCode);
  if (!runtime) return;
  const payload = JSON.stringify({
    type: 'voice:peers',
    peers: buildVoicePeersList(runtime),
  } satisfies ServerMessage);

  for (const meta of socketMetas.values()) {
    if (meta.roomCode === roomCode && meta.ws.readyState === WebSocket.OPEN) {
      meta.ws.send(payload);
    }
  }
}

function sanitizeVoiceSignal(raw: unknown): VoiceSignalPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if ((obj.kind === 'offer' || obj.kind === 'answer') && typeof obj.sdp === 'string' && obj.sdp.length <= 32768) {
    return { kind: obj.kind, sdp: obj.sdp };
  }
  if (obj.kind === 'ice' && obj.candidate && typeof obj.candidate === 'object' && !Array.isArray(obj.candidate)) {
    const c = obj.candidate as Record<string, unknown>;
    if (typeof c.candidate !== 'string' || c.candidate.length > 2048) return null;
    return {
      kind: 'ice',
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' || c.sdpMid === null ? c.sdpMid : undefined,
        sdpMLineIndex:
          typeof c.sdpMLineIndex === 'number' && Number.isFinite(c.sdpMLineIndex)
            ? c.sdpMLineIndex
            : undefined,
        usernameFragment:
          typeof c.usernameFragment === 'string' || c.usernameFragment === null ? c.usernameFragment : undefined,
      },
    };
  }
  return null;
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
          runtime.voicePeers.delete(prevClientId);
          broadcastRoomState(prevCode);
          broadcastVoicePeers(prevCode);
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
  await restoreRoomsSnapshot();
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    res.json({
      ok: true,
      app: 'Real Auction 26',
      activeRooms: rooms.size,
      geminiConfigured: Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY'),
      pool: getFullPlayerPoolSummary(),
      serverTime: Date.now(),
    });
  });

  app.get('/api/rooms/:code', (req, res) => {
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
    const code = String(req.params.code || '').trim().toUpperCase();
    const runtime = rooms.get(code);
    if (!runtime) {
      res.status(404).json({ ok: false, code: 'ROOM_NOT_FOUND', message: 'Auction room not found or expired.' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const clientId = String(body.clientId || req.headers['x-room-client-id'] || '').trim();
    const sessionToken = String(body.sessionToken || req.headers['x-room-session-token'] || '').trim();
    const expectedToken = clientId ? runtime.sessionTokens.get(clientId) : undefined;
    const isParticipant = Boolean(
      clientId &&
        expectedToken &&
        sessionToken &&
        timingSafeTokenEquals(sessionToken, expectedToken) &&
        runtime.state.participants.some((p) => p.clientId === clientId),
    );
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

    if (runtime.state.winnerAnalysis && runtime.state.winnerAnalysis.confidenceLevel) {
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
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const meta: SocketMeta = {
      ws,
      roomCode: null,
      clientId: null,
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
            : 'Auctioneer';
        const configObj = msg.config && typeof msg.config === 'object' ? msg.config : {};
        const customTeams = Array.isArray(msg.customTeams) ? msg.customTeams.slice(0, 12) : undefined;

        const { runtime, hostClientId, sessionToken } = createRoomRuntime(
          code,
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
        sendToSocket(ws, {
          type: 'voice:peers',
          peers: buildVoicePeersList(runtime),
        });
        void writeRoomsSnapshot();
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
            : 'Manager';
        const incomingClientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : undefined;
        const incomingToken = typeof msg.sessionToken === 'string' ? msg.sessionToken.slice(0, 128) : undefined;

        const { sessionToken, participant } = joinRoom(
          runtime,
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
        broadcastVoicePeers(code);
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
          else {
            broadcastRoomState(roomCode);
            void writeRoomsSnapshot();
          }
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
          else {
            broadcastRoomState(roomCode);
            void writeRoomsSnapshot();
          }
          break;
        }
        case 'voice:presence': {
          const joined = Boolean(msg.joined);
          const micActive = joined && Boolean(msg.micActive);
          const speaking = micActive && Boolean(msg.speaking);
          if (!joined) {
            runtime.voicePeers.delete(clientId);
          } else {
            runtime.voicePeers.set(clientId, { joined: true, micActive, speaking });
          }
          broadcastVoicePeers(roomCode);
          break;
        }
        case 'voice:signal': {
          const targetClientId = typeof msg.targetClientId === 'string' ? msg.targetClientId.trim() : '';
          if (!targetClientId || targetClientId === clientId) break;
          const targetConnected = runtime.state.participants.some(
            (p) => p.clientId === targetClientId && p.connected,
          );
          if (!targetConnected) break;
          const signal = sanitizeVoiceSignal(msg.signal);
          if (!signal) break;
          for (const targetMeta of socketMetas.values()) {
            if (targetMeta.roomCode === roomCode && targetMeta.clientId === targetClientId) {
              sendToSocket(targetMeta.ws, {
                type: 'voice:signal',
                fromClientId: clientId,
                signal,
              });
            }
          }
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
      if (!hasConnected && now - runtime.lastTickAt > ROOM_TTL_MS) {
        rooms.delete(code);
        schedulePersistRooms();
      }
    }
  }, 250);

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
