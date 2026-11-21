import express from 'express';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
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
}

interface CachedPhoto {
  buffer: Buffer;
  contentType: string;
}

const rooms = new Map<string, RoomRuntime>();
const socketMetas = new Map<WebSocket, SocketMeta>();
const photoCache = new Map<string, CachedPhoto>();

const LOCAL_FALLBACK_PORTRAITS: Record<PlayerRole, string> = {
  Batter: 'player_portrait_batter_1795289107133.jpg',
  Bowler: 'player_portrait_pacer_1795289106811.jpg',
  'All-Rounder': 'player_portrait_allrounder_1795289107451.jpg',
  Wicketkeeper: 'player_portrait_keeper_1795289106537.jpg',
};

function isAllowedWikiImageUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    return (
      u.hostname === 'upload.wikimedia.org' ||
      u.hostname === 'thumb.wikimedia.org' ||
      u.hostname.endsWith('.wikimedia.org')
    );
  } catch {
    return false;
  }
}

async function resolvePlayerPhoto(playerId: string): Promise<CachedPhoto | null> {
  const cached = photoCache.get(playerId);
  if (cached) return cached;

  const player = REAL_PLAYER_POOL.find((p) => p.id === playerId);
  if (!player) return null;

  if (player.wikiSlug) {
    try {
      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(player.wikiSlug)}`;
      const summaryRes = await fetch(summaryUrl, {
        headers: { 'User-Agent': 'CreaseHammerAuction/1.0 (https://creasehammer.local)' },
        signal: AbortSignal.timeout(4500),
      });
      if (summaryRes.ok) {
        const data = (await summaryRes.json()) as {
          thumbnail?: { source?: string };
          originalimage?: { source?: string };
        };
        const imgUrl = data.thumbnail?.source || data.originalimage?.source;
        if (imgUrl && isAllowedWikiImageUrl(imgUrl)) {
          const imgRes = await fetch(imgUrl, {
            headers: { 'User-Agent': 'CreaseHammerAuction/1.0' },
            signal: AbortSignal.timeout(4500),
          });
          if (imgRes.ok) {
            const ct = imgRes.headers.get('content-type') || 'image/jpeg';
            if (ct.startsWith('image/')) {
              const arrayBuf = await imgRes.arrayBuffer();
              const entry: CachedPhoto = {
                buffer: Buffer.from(arrayBuf),
                contentType: ct,
              };
              if (photoCache.size > 150) {
                const firstKey = photoCache.keys().next().value;
                if (firstKey) photoCache.delete(firstKey);
              }
              photoCache.set(playerId, entry);
              return entry;
            }
          }
        }
      }
    } catch {
      // Fall through to bundled local portrait
    }
  }

  const filename = LOCAL_FALLBACK_PORTRAITS[player.role] || 'player_portrait_batter_1795289107133.jpg';
  const candidateDirs = [
    path.resolve(__dirname, 'src/assets/images'),
    path.resolve(__dirname, 'dist/src/assets/images'),
  ];
  for (const imagesDir of candidateDirs) {
    try {
      const resolved = path.resolve(imagesDir, filename);
      if (resolved.startsWith(imagesDir + path.sep)) {
        const buffer = await fs.readFile(resolved);
        const entry = { buffer, contentType: 'image/jpeg' };
        photoCache.set(playerId, entry);
        return entry;
      }
    } catch {
      // Try next directory
    }
  }
  return null;
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
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      activeRooms: rooms.size,
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
    const meta: SocketMeta = { ws, roomCode: null, clientId: null };
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
          clientSentAt: typeof msg.clientSentAt === 'number' && Number.isFinite(msg.clientSentAt) ? msg.clientSentAt : undefined,
        });
        return;
      }

      if (msg.type === 'room:create') {
        detachSocketFromRoom(meta);
        const code = allocateUniqueRoomCode();
        const clientName = typeof msg.clientName === 'string' ? msg.clientName.slice(0, 32) : 'Auctioneer';
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

        const clientName = typeof msg.clientName === 'string' ? msg.clientName.slice(0, 32) : 'Manager';
        const incomingClientId = typeof msg.clientId === 'string' ? msg.clientId.slice(0, 64) : undefined;
        const incomingToken = typeof msg.sessionToken === 'string' ? msg.sessionToken.slice(0, 128) : undefined;

        const { sessionToken, participant } = joinRoom(runtime, incomingClientId, clientName, incomingToken);

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
          const expectedAmount = typeof msg.expectedAmount === 'number' && Number.isFinite(msg.expectedAmount)
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

  if (!isProduction) {
    const vite = await import('vite');
    const viteServer = await vite.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'API endpoint not found.' });
    });
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`CreaseHammer auction server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
