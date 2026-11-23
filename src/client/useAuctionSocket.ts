import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuctionConfig,
  AuctionRoomState,
  ClientMessage,
  ServerMessage,
  Team,
} from '../shared/types.ts';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface RoomSessionHint {
  roomCode: string;
  clientId: string;
  sessionToken: string;
  clientName: string;
}

const ACTIVE_SESSION_KEY = 'ra26_session_v1';

function loadRoomSession(): RoomSessionHint | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomSessionHint>;
    if (parsed.roomCode) {
      return {
        roomCode: String(parsed.roomCode).trim().toUpperCase(),
        clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
        sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : '',
        clientName: typeof parsed.clientName === 'string' && parsed.clientName ? parsed.clientName : 'Manager',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveRoomSession(hint: RoomSessionHint | null): void {
  try {
    if (!hint) {
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } else {
      sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(hint));
    }
  } catch {
    // Ignore storage quota issues
  }
}

export interface ToastNotice {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

interface UseAuctionSocketOptions {
  onRoomJoined?: (state: AuctionRoomState) => void;
}

export function useAuctionSocket({ onRoomJoined }: UseAuctionSocketOptions = {}) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomState, setRoomState] = useState<AuctionRoomState | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const [sessionToken, setSessionToken] = useState<string>('');
  const [clockOffsetMs, setClockOffsetMs] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastNotice[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef<number>(0);
  const activeSessionRef = useRef<RoomSessionHint | null>(loadRoomSession());
  const pendingActionRef = useRef<ClientMessage | null>(null);
  const intentionalCloseRef = useRef<boolean>(false);
  const onRoomJoinedRef = useRef(onRoomJoined);

  useEffect(() => {
    onRoomJoinedRef.current = onRoomJoined;
  }, [onRoomJoined]);

  const pushToast = useCallback((kind: ToastNotice['kind'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
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

  const resetRoomState = useCallback(() => {
    intentionalCloseRef.current = true;
    clearTimers();
    wsRef.current?.close();
    wsRef.current = null;
    activeSessionRef.current = null;
    saveRoomSession(null);
    setRoomState(null);
    setClientId('');
    setSessionToken('');
    setStatus('idle');
    setConnectionError(null);
  }, [clearTimers]);

  const connectSocket = useCallback(
    (onOpenMessage?: ClientMessage) => {
      clearTimers();
      intentionalCloseRef.current = false;

      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
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
          const hint = activeSessionRef.current;
          ws.send(
            JSON.stringify({
              type: 'room:join',
              roomCode: hint.roomCode,
              clientId: hint.clientId,
              sessionToken: hint.sessionToken,
              clientName: hint.clientName,
            } satisfies ClientMessage),
          );
        }

        heartbeatTimerRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientSentAt: Date.now() } satisfies ClientMessage));
          }
        }, 8000);
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
          setSessionToken(msg.sessionToken);
          setRoomState(msg.state);
          setClockOffsetMs(msg.state.serverTime - Date.now());

          const me = msg.state.participants.find((p) => p.clientId === msg.clientId);
          const hint: RoomSessionHint = {
            roomCode: msg.roomCode,
            clientId: msg.clientId,
            sessionToken: msg.sessionToken,
            clientName: me?.name || activeSessionRef.current?.clientName || 'Manager',
          };
          activeSessionRef.current = hint;
          saveRoomSession(hint);
          onRoomJoinedRef.current?.(msg.state);
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
            saveRoomSession(null);
            setRoomState(null);
            setClientId('');
            setSessionToken('');
            setStatus('idle');
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

  // Restore active room if URL is /room/:code or sessionStorage has an active room session
  useEffect(() => {
    const pathMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4,10})(?:\/(?:winner|results))?$/i);
    const pathCode = pathMatch ? pathMatch[1].toUpperCase() : null;
    const saved = loadRoomSession();
    const targetCode = pathCode || saved?.roomCode || null;

    if (targetCode) {
      const sameRoom = saved && saved.roomCode === targetCode;
      const hint: RoomSessionHint = {
        roomCode: targetCode,
        clientId: sameRoom ? saved.clientId : '',
        sessionToken: sameRoom ? saved.sessionToken : '',
        clientName: sameRoom ? saved.clientName : 'Manager',
      };
      activeSessionRef.current = hint;
      connectSocket({
        type: 'room:join',
        roomCode: hint.roomCode,
        clientId: hint.clientId,
        sessionToken: hint.sessionToken,
        clientName: hint.clientName,
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
      setRoomState(null);
      setClientId('');
      setSessionToken('');
      activeSessionRef.current = null;
      saveRoomSession(null);
      connectSocket({
        type: 'room:create',
        clientId: '',
        clientName: clientName.trim() || 'Auctioneer',
        config,
        customTeams,
      });
    },
    [connectSocket],
  );

  const joinRoomByCode = useCallback(
    (roomCode: string, clientName: string) => {
      const code = roomCode.trim().toUpperCase();
      if (!code) {
        pushToast('error', 'Enter a valid room code.');
        return;
      }
      const cleanName = clientName.trim() || 'Manager';
      const saved = loadRoomSession();
      const sameRoom = saved && saved.roomCode === code;
      const hint: RoomSessionHint = {
        roomCode: code,
        clientId: sameRoom ? saved.clientId : '',
        sessionToken: sameRoom ? saved.sessionToken : '',
        clientName: cleanName,
      };
      activeSessionRef.current = hint;
      saveRoomSession(hint);
      setRoomState(null);
      connectSocket({
        type: 'room:join',
        roomCode: code,
        clientId: hint.clientId,
        sessionToken: hint.sessionToken,
        clientName: cleanName,
      });
    },
    [connectSocket, pushToast],
  );

  const leaveRoom = useCallback(() => {
    resetRoomState();
  }, [resetRoomState]);

  const manualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    connectSocket();
  }, [connectSocket]);

  return {
    status,
    roomState,
    clientId,
    sessionToken,
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
