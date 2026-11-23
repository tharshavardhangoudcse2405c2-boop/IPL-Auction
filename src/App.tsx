import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Sliders, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
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
    manualReconnect,
  } = useAuctionSocket({
    onRoomJoined: handleRoomJoined,
  });

  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  const [prefsOpen, setPrefsOpen] = useState(false);

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
          muted={muted}
          reducedMotion={reducedMotion}
          onSend={sendMessage}
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
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-[#5B91A3]/30 bg-[#1B273B]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 sm:gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => navigate('/')}
            className="font-display text-2xl font-extrabold tracking-tight text-[#CFEAE0] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#5B91A3]"
          >
            Real Auction 26
          </button>

          {/* Zone 2: Concise single-line nav links for each separate page */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-[#CFEAE0]/80">
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
                onClick={() => navigate(path)}
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

          {/* Zone 3: Broadcast Preferences */}
          <div className="relative flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setPrefsOpen((v) => !v)}
              aria-expanded={prefsOpen}
              className="inline-flex items-center gap-2 rounded-xl border border-[#5B91A3]/45 bg-[#2F4A63] px-3.5 py-2 text-xs font-bold text-[#CFEAE0] hover:bg-[#3A5975] transition-colors whitespace-nowrap shrink-0"
            >
              {muted ? (
                <VolumeX className="h-4 w-4 text-[#CFEAE0]/70" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Preferences</span>
            </button>

            {prefsOpen && (
              <div className="absolute right-0 top-full mt-2 w-68 rounded-2xl border border-[#5B91A3]/45 bg-[#2F4A63] p-4 shadow-2xl z-40 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[#CFEAE0]">
                  <span>Broadcast Preferences</span>
                  <Sliders className="h-3.5 w-3.5 text-[#CFEAE0]/75" aria-hidden="true" />
                </div>

                <label className="flex items-center justify-between gap-3 text-xs text-[#CFEAE0]/90 cursor-pointer">
                  <span>Mute Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => setMuted(e.target.checked)}
                    className="h-4 w-4 accent-[#5B91A3]"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 text-xs text-[#CFEAE0]/90 cursor-pointer">
                  <span>Reduced Motion</span>
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(e) => setReducedMotion(e.target.checked)}
                    className="h-4 w-4 accent-[#5B91A3]"
                  />
                </label>

                <div className="border-t border-[#CFEAE0]/15 pt-2.5 flex md:hidden flex-wrap gap-2 text-xs font-semibold">
                  <button type="button" onClick={() => { setPrefsOpen(false); navigate('/'); }} className="text-[#CFEAE0] hover:underline">
                    Home
                  </button>
                  <button type="button" onClick={() => { setPrefsOpen(false); navigate('/create'); }} className="text-[#CFEAE0] hover:underline">
                    Create
                  </button>
                  <button type="button" onClick={() => { setPrefsOpen(false); navigate('/join'); }} className="text-[#CFEAE0] hover:underline">
                    Join
                  </button>
                  <button type="button" onClick={() => { setPrefsOpen(false); navigate('/players'); }} className="text-[#CFEAE0] hover:underline">
                    Player Pool
                  </button>
                  <button type="button" onClick={() => { setPrefsOpen(false); navigate('/rules'); }} className="text-[#CFEAE0] hover:underline">
                    Rules
                  </button>
                </div>
              </div>
            )}
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

      {/* Clean Minimal Footer */}
      <footer className="border-t border-[#5B91A3]/25 bg-[#1B273B] px-4 py-4 text-xs text-[#CFEAE0]/75">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <span>
            Real Auction 26 · IPL-style cricket auction simulator with real cricketers & post-auction AI squad analysis
          </span>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => navigate('/create')} className="hover:text-[#CFEAE0]">
              Create
            </button>
            <button type="button" onClick={() => navigate('/join')} className="hover:text-[#CFEAE0]">
              Join
            </button>
            <button type="button" onClick={() => navigate('/players')} className="hover:text-[#CFEAE0]">
              Player Pool
            </button>
            <button type="button" onClick={() => navigate('/rules')} className="hover:text-[#CFEAE0]">
              Rules & Setup
            </button>
          </div>
        </div>
      </footer>

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
