import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuctionConfig, AuctionRoomState, ClientMessage, ServerMessage, Team } from '../shared/types.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface SavedSession {
  roomCode: string;
  clientId: string;
  sessionToken: string;
  clientName: string;
}

const SESSION_KEY = 'creasehammer_session_v1';

function loadSavedSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedSession>;
    if (parsed.roomCode && parsed.clientId && parsed.sessionToken) {
      return {
        roomCode: parsed.roomCode,
        clientId: parsed.clientId,
        sessionToken: parsed.sessionToken,
        clientName: parsed.clientName || 'Manager',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession | null): void {
  try {
    if (!session) {
      sessionStorage.removeItem(SESSION_KEY);
    } else {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota issues
  }
}

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cli-${crypto.randomUUID().slice(0, 12)}`;
  }
  return `cli-${Math.random().toString(36).slice(2, 12)}`;
}

export interface ToastNotice {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export function useAuctionSocket() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomState, setRoomState] = useState<AuctionRoomState | null>(null);
  const [clientId, setClientId] = useState<string>(() => loadSavedSession()?.clientId || makeClientId());
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const activeSessionRef = useRef<SavedSession | null>(loadSavedSession());
  const pendingActionRef = useRef<ClientMessage | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);

  const pushToast = useCallback((kind: ToastNotice['kind'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const connectSocket = useCallback(
    (onOpenMessage?: ClientMessage) => {
      clearTimers();
      intentionalCloseRef.current = false;

      if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
        if (wsRef.current.readyState === WebSocket.OPEN && onOpenMessage) {
          wsRef.current.send(JSON.stringify(onOpenMessage));
          return;
        }
        pendingActionRef.current = onOpenMessage ?? pendingActionRef.current;
        return;
      }

      if (onOpenMessage) {
        pendingActionRef.current = onOpenMessage;
      }

      setStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');
      setConnectionError(null);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setStatus('connected');
        setConnectionError(null);

        if (pendingActionRef.current) {
          ws.send(JSON.stringify(pendingActionRef.current));
          pendingActionRef.current = null;
        } else if (activeSessionRef.current) {
          const s = activeSessionRef.current;
          ws.send(
            JSON.stringify({
              type: 'room:join',
              roomCode: s.roomCode,
              clientId: s.clientId,
              clientName: s.clientName,
              sessionToken: s.sessionToken,
            } satisfies ClientMessage),
          );
        }

        heartbeatTimerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientSentAt: Date.now() } satisfies ClientMessage));
          }
        }, 8000);
        // Immediate initial RTT clock calibration
        ws.send(JSON.stringify({ type: 'ping', clientSentAt: Date.now() } satisfies ClientMessage));
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }

        if (msg.type === 'pong') {
          const now = Date.now();
          const rtt = msg.clientSentAt ? Math.max(0, now - msg.clientSentAt) : 0;
          setClockOffsetMs(msg.serverTime + Math.round(rtt / 2) - now);
          return;
        }

        if (msg.type === 'bid:accepted') {
          setClockOffsetMs(msg.serverTime - Date.now());
          return;
        }

        if (msg.type === 'room:joined') {
          setClientId(msg.clientId);
          setRoomState(msg.state);
          setClockOffsetMs(msg.state.serverTime - Date.now());

          const me = msg.state.participants.find((p) => p.clientId === msg.clientId);
          const session: SavedSession = {
            roomCode: msg.roomCode,
            clientId: msg.clientId,
            sessionToken: msg.sessionToken,
            clientName: me?.name || activeSessionRef.current?.clientName || 'Manager',
          };
          activeSessionRef.current = session;
          saveSession(session);

          const url = new URL(window.location.href);
          if (url.searchParams.get('room') !== msg.roomCode) {
            url.searchParams.set('room', msg.roomCode);
            window.history.replaceState({}, '', url.toString());
          }
          return;
        }

        if (msg.type === 'room:state') {
          setRoomState(msg.state);
          setClockOffsetMs(msg.state.serverTime - Date.now());
          return;
        }

        if (msg.type === 'bid:rejected') {
          pushToast('error', msg.reason);
          return;
        }

        if (msg.type === 'room:error') {
          pushToast('error', msg.message);
          if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'ROOM_EXPIRED') {
            activeSessionRef.current = null;
            saveSession(null);
            setRoomState(null);
            setStatus('idle');
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url.toString());
          }
        }
      };

      ws.onerror = () => {
        setConnectionError('Real-time connection interrupted. Attempting to restore...');
      };

      ws.onclose = () => {
        clearTimers();
        wsRef.current = null;
        if (intentionalCloseRef.current) {
          setStatus('idle');
          return;
        }

        if (activeSessionRef.current) {
          setStatus('reconnecting');
          const attempt = reconnectAttemptRef.current;
          reconnectAttemptRef.current += 1;
          const delayMs = Math.min(8000, 1000 * Math.pow(1.6, attempt));
          setConnectionError(`Connection lost. Retrying automatically (${attempt + 1})...`);
          reconnectTimerRef.current = window.setTimeout(() => {
            connectSocket();
          }, delayMs);
        } else {
          setStatus('disconnected');
        }
      };
    },
    [clearTimers, pushToast],
  );

  // Restore active session on mount if user refreshed page
  useEffect(() => {
    const saved = loadSavedSession();
    const urlRoom = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase();
    if (saved && (!urlRoom || saved.roomCode === urlRoom)) {
      activeSessionRef.current = saved;
      connectSocket({
        type: 'room:join',
        roomCode: saved.roomCode,
        clientId: saved.clientId,
        clientName: saved.clientName,
        sessionToken: saved.sessionToken,
      });
    }

    return () => {
      intentionalCloseRef.current = true;
      clearTimers();
      wsRef.current?.close();
    };
  }, [clearTimers, connectSocket]);

  const sendMessage = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        pushToast('error', 'Not connected to server. Reconnecting...');
        connectSocket(msg);
      }
    },
    [connectSocket, pushToast],
  );

  const createRoom = useCallback(
    (clientName: string, config: AuctionConfig, customTeams?: Partial<Team>[]) => {
      const cid = clientId || makeClientId();
      setClientId(cid);
      activeSessionRef.current = null;
      saveSession(null);
      connectSocket({
        type: 'room:create',
        clientId: cid,
        clientName,
        config,
        customTeams,
      });
    },
    [clientId, connectSocket],
  );

  const joinRoomByCode = useCallback(
    (roomCode: string, clientName: string) => {
      const code = roomCode.trim().toUpperCase();
      if (!code) {
        pushToast('error', 'Enter a valid 6-character room code.');
        return;
      }
      const saved = activeSessionRef.current;
      const matchingSaved = saved && saved.roomCode === code ? saved : null;
      const cid = matchingSaved?.clientId || clientId || makeClientId();
      setClientId(cid);
      connectSocket({
        type: 'room:join',
        roomCode: code,
        clientId: cid,
        clientName: clientName.trim() || 'Manager',
        sessionToken: matchingSaved?.sessionToken,
      });
    },
    [clientId, connectSocket, pushToast],
  );

  const leaveRoom = useCallback(() => {
    intentionalCloseRef.current = true;
    clearTimers();
    wsRef.current?.close();
    wsRef.current = null;
    activeSessionRef.current = null;
    saveSession(null);
    setRoomState(null);
    setStatus('idle');
    setConnectionError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
  }, [clearTimers]);

  const manualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connectSocket();
  }, [connectSocket]);

  return {
    status,
    roomState,
    clientId,
    clockOffsetMs,
    toasts,
    connectionError,
    dismissToast,
    pushToast,
    createRoom,
    joinRoomByCode,
    leaveRoom,
    sendMessage,
    manualReconnect,
  };
}
