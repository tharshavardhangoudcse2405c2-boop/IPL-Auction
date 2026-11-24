import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, WifiOff, X } from 'lucide-react';
import {
  playClickSound,
  playRejectedSound,
  playSeatClaimSound,
  setupAudioUnlock,
  unlockAudio,
} from './client/audio.ts';
import { useAppRouter } from './client/router.ts';
import { useAuctionSocket } from './client/useAuctionSocket.ts';
import { AuctionWinnerPage } from './components/AuctionWinnerPage.tsx';
import { CreateAuctionPage } from './components/CreateAuctionPage.tsx';
import { HomePage } from './components/HomePage.tsx';
import { JoinRoomPage } from './components/JoinRoomPage.tsx';
import { LiveAuctionRoom } from './components/LiveAuctionRoom.tsx';
import { LobbyRoom } from './components/LobbyRoom.tsx';
import { PlayerPoolPage } from './components/PlayerPoolPage.tsx';
import { ResultsSummary } from './components/ResultsSummary.tsx';
import { RulesSetupPage } from './components/RulesSetupPage.tsx';
import type { AuctionRoomState } from './shared/types.ts';

export default function App() {
  const { route, navigate } = useAppRouter();
  const muted = false;

  useEffect(() => {
    return setupAudioUnlock();
  }, []);

  const handleRoomJoined = useCallback(
    (joinedState: AuctionRoomState) => {
      const code = joinedState.roomCode;
      if (joinedState.phase === 'COMPLETED') {
        navigate(`/room/${code}/winner`);
      } else {
        navigate(`/room/${code}`);
      }
    },
    [navigate],
  );

  const handleSoundEvent = useCallback((kind: 'joined' | 'rejected') => {
    if (kind === 'joined') {
      playSeatClaimSound(false);
    } else if (kind === 'rejected') {
      playRejectedSound(false);
    }
  }, []);

  const {
    status,
    roomState,
    clientId,
    sessionToken,
    clockOffsetMs,
    toasts,
    connectionError,
    dismissToast,
    createRoom,
    joinRoomByCode,
    leaveRoom,
    sendMessage,
    addVoiceListener,
    manualReconnect,
  } = useAuctionSocket({
    onRoomJoined: handleRoomJoined,
    onSoundEvent: handleSoundEvent,
  });

  const [reducedMotion] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );

  const handleNav = (path: string) => {
    unlockAudio();
    playClickSound(muted);
    navigate(path);
  };

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
  }, [reducedMotion]);

  // Keep /room/:code, /winner, /results aligned with phase changes (e.g. auction ends or host triggers rematch)
  useEffect(() => {
    if (!roomState) return;
    if (roomState.phase === 'COMPLETED' && route.page === 'room') {
      navigate(`/room/${roomState.roomCode}/winner`, { replace: true });
    } else if (
      roomState.phase !== 'COMPLETED' &&
      (route.page === 'winner' || route.page === 'results')
    ) {
      navigate(`/room/${roomState.roomCode}`, { replace: true });
    }
  }, [roomState, route.page, navigate]);

  const handleLeaveRoom = () => {
    leaveRoom();
    navigate('/');
  };

  const showReconnectBanner =
    Boolean(roomState) &&
    (status === 'reconnecting' || status === 'disconnected' || Boolean(connectionError));

  const renderPage = () => {
    if (route.page === 'create') {
      return (
        <CreateAuctionPage
          onCreateRoom={createRoom}
          onNavigate={(p) => navigate(p)}
          isConnecting={status === 'connecting'}
        />
      );
    }

    if (route.page === 'join') {
      return (
        <JoinRoomPage
          initialRoomCode={route.prefillCode}
          isConnecting={status === 'connecting'}
          onJoinRoom={joinRoomByCode}
          onNavigate={(p) => navigate(p)}
        />
      );
    }

    if (route.page === 'players') {
      return <PlayerPoolPage onNavigate={(p) => navigate(p)} />;
    }

    if (route.page === 'rules') {
      return <RulesSetupPage onNavigate={(p) => navigate(p)} />;
    }

    if (route.page === 'winner' || route.page === 'results' || route.page === 'room') {
      if (!roomState || roomState.roomCode !== route.roomCode) {
        return (
          <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
            <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-8 space-y-4 shadow-xl">
              <div className="font-display text-2xl font-bold text-[#CFEAE0]">
                {status === 'connecting' || status === 'reconnecting'
                  ? `Connecting to Room ${route.roomCode}...`
                  : `Room ${route.roomCode}`}
              </div>
              <p className="text-xs text-[#CFEAE0]/80">
                {status === 'connecting' || status === 'reconnecting'
                  ? 'Restoring your auction room session...'
                  : 'Enter this room directly or head back to the main page.'}
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => joinRoomByCode(route.roomCode, 'Manager')}
                  className="rounded-xl bg-[#5B91A3] px-5 py-2.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9]"
                >
                  Enter Room {route.roomCode}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-2.5 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D]"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        );
      }

      if (roomState.phase === 'LOBBY') {
        return (
          <LobbyRoom
            state={roomState}
            clientId={clientId}
            muted={muted}
            onSend={sendMessage}
            onLeave={handleLeaveRoom}
          />
        );
      }

      if (roomState.phase === 'COMPLETED') {
        if (route.page === 'results') {
          return (
            <ResultsSummary
              state={roomState}
              clientId={clientId}
              onSend={sendMessage}
              onLeave={handleLeaveRoom}
              onViewWinner={() => navigate(`/room/${roomState.roomCode}/winner`)}
            />
          );
        }
        return (
          <AuctionWinnerPage
            state={roomState}
            clientId={clientId}
            sessionToken={sessionToken}
            muted={muted}
            onSend={sendMessage}
            onLeave={handleLeaveRoom}
            onViewResults={() => navigate(`/room/${roomState.roomCode}/results`)}
          />
        );
      }

      return (
        <LiveAuctionRoom
          state={roomState}
          clientId={clientId}
          clockOffsetMs={clockOffsetMs}
          wsConnected={status === 'connected'}
          muted={muted}
          reducedMotion={reducedMotion}
          onSend={sendMessage}
          addVoiceListener={addVoiceListener}
          onLeave={handleLeaveRoom}
        />
      );
    }

    return (
      <HomePage
        activeRoom={roomState}
        onNavigate={(p) => navigate(p)}
      />
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#131B2B] text-[#CFEAE0]">
      {/* Top Header */}
      <header className="border-b border-[#5B91A3]/30 bg-[#1B273B]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 sm:gap-6 px-4 py-3.5 sm:px-6">
          {/* Wordmark */}
          <button
            type="button"
            onClick={() => handleNav('/')}
            className="font-display text-2xl font-extrabold tracking-tight text-[#CFEAE0] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#5B91A3]"
          >
            Real Auction 26
          </button>

          {/* Navigation links for each separate page */}
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1.5 sm:gap-6 text-sm font-semibold text-[#CFEAE0]/80">
            {(
              [
                ['/', 'Home', route.page === 'home'],
                ['/create', 'Create', route.page === 'create'],
                ['/join', 'Join', route.page === 'join'],
                ['/players', 'Player Pool', route.page === 'players'],
                ['/rules', 'Rules', route.page === 'rules'],
              ] as const
            ).map(([path, label, active]) => (
              <button
                key={path}
                type="button"
                onClick={() => handleNav(path)}
                className={`transition-colors whitespace-nowrap shrink-0 underline-offset-4 ${
                  active
                    ? 'text-[#CFEAE0] underline decoration-[#5B91A3] decoration-2'
                    : 'hover:text-[#CFEAE0] hover:underline'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Visible Owner Name on Every Page */}
          <div className="font-display text-base sm:text-lg font-extrabold tracking-wider text-[#CFEAE0] whitespace-nowrap shrink-0">
            HARSHAVARDHAN
          </div>
        </div>
      </header>

      {/* Connection Recovery Banner */}
      {showReconnectBanner && (
        <div
          role="alert"
          className="border-b border-rose-400/40 bg-rose-950/75 px-4 py-2.5 text-xs text-rose-100"
        >
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-rose-300 shrink-0" aria-hidden="true" />
              <span>
                {connectionError || 'Connection to the auction server was lost. Your room state is preserved on the server.'}
              </span>
            </div>
            <button
              type="button"
              onClick={manualReconnect}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-500 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reconnect Now
            </button>
          </div>
        </div>
      )}

      {/* Main Content View */}
      <main className="flex-1">{renderPage()}</main>

      {/* Toast Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs shadow-xl ${
                t.kind === 'error'
                  ? 'border-rose-400/45 bg-rose-950/95 text-rose-100'
                  : 'border-[#5B91A3]/55 bg-[#2F4A63] text-[#CFEAE0]'
              }`}
            >
              <span className="leading-relaxed">{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss message"
                className="text-[#CFEAE0]/70 hover:text-[#CFEAE0] shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
