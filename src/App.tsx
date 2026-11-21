import { useEffect, useState } from 'react';
import { RefreshCw, Sliders, Volume2, VolumeX, WifiOff, X } from 'lucide-react';
import { useAuctionSocket } from './client/useAuctionSocket.ts';
import { LandingSetup } from './components/LandingSetup.tsx';
import { LiveAuctionRoom } from './components/LiveAuctionRoom.tsx';
import { LobbyRoom } from './components/LobbyRoom.tsx';
import { ReferenceModal } from './components/ReferenceModal.tsx';
import { ResultsSummary } from './components/ResultsSummary.tsx';

export default function App() {
  const {
    status,
    roomState,
    clientId,
    clockOffsetMs,
    toasts,
    connectionError,
    dismissToast,
    createRoom,
    joinRoomByCode,
    leaveRoom,
    sendMessage,
    manualReconnect,
  } = useAuctionSocket();

  const [muted, setMuted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [refTab, setRefTab] = useState<'pool' | 'rules' | 'setup' | null>(null);

  const initialUrlRoom =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() || ''
      : '';

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
  }, [reducedMotion]);

  const showReconnectBanner =
    Boolean(roomState) && (status === 'reconnecting' || status === 'disconnected' || Boolean(connectionError));

  return (
    <div className="min-h-screen flex flex-col bg-[#090D16] text-slate-100">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-white/10 bg-[#0B101B]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => {
              if (!roomState) window.scrollTo({ top: 0, behavior: 'smooth' });
              else setRefTab(null);
            }}
            className="font-display text-2xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-amber-400"
          >
            CreaseHammer
          </button>

          {/* Zone 2: 4 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
            <button
              type="button"
              onClick={() => {
                if (roomState) leaveRoom();
              }}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Studio
            </button>
            <button
              type="button"
              onClick={() => setRefTab('pool')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Player Pool
            </button>
            <button
              type="button"
              onClick={() => setRefTab('rules')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Rules
            </button>
            <button
              type="button"
              onClick={() => setRefTab('setup')}
              className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Setup
            </button>
          </nav>

          {/* Zone 3: 1 primary action (opens Audio & Motion preferences) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPrefsOpen((v) => !v)}
              aria-expanded={prefsOpen}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors whitespace-nowrap shrink-0"
            >
              {muted ? (
                <VolumeX className="h-4 w-4 text-slate-400" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4 text-amber-400" aria-hidden="true" />
              )}
              Audio & Motion
            </button>

            {prefsOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-xl border border-white/15 bg-[#111827] p-4 shadow-2xl z-40 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-white">
                  <span>Broadcast Preferences</span>
                  <Sliders className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                </div>

                <label className="flex items-center justify-between gap-3 text-xs text-slate-300 cursor-pointer">
                  <span>Mute Auction Sound Effects</span>
                  <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => setMuted(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 text-xs text-slate-300 cursor-pointer">
                  <span>Reduced Motion Animations</span>
                  <input
                    type="checkbox"
                    checked={reducedMotion}
                    onChange={(e) => setReducedMotion(e.target.checked)}
                    className="h-4 w-4 accent-amber-500"
                  />
                </label>

                <div className="border-t border-white/10 pt-2 flex md:hidden flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPrefsOpen(false);
                      setRefTab('pool');
                    }}
                    className="text-amber-400 hover:underline"
                  >
                    Player Pool
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrefsOpen(false);
                      setRefTab('rules');
                    }}
                    className="text-slate-300 hover:underline"
                  >
                    Rules
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPrefsOpen(false);
                      setRefTab('setup');
                    }}
                    className="text-slate-300 hover:underline"
                  >
                    Setup
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
          className="border-b border-rose-500/40 bg-rose-950/70 px-4 py-2.5 text-xs text-rose-100"
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
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1 font-semibold text-white hover:bg-rose-500 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reconnect Now
            </button>
          </div>
        </div>
      )}

      {/* Main Content View */}
      <main className="flex-1">
        {!roomState ? (
          <LandingSetup
            initialRoomCode={initialUrlRoom}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoomByCode}
            onOpenReference={(tab) => setRefTab(tab)}
            isConnecting={status === 'connecting'}
          />
        ) : roomState.phase === 'LOBBY' ? (
          <LobbyRoom
            state={roomState}
            clientId={clientId}
            onSend={sendMessage}
            onLeave={leaveRoom}
          />
        ) : roomState.phase === 'COMPLETED' ? (
          <ResultsSummary
            state={roomState}
            clientId={clientId}
            onSend={sendMessage}
            onLeave={leaveRoom}
          />
        ) : (
          <LiveAuctionRoom
            state={roomState}
            clientId={clientId}
            clockOffsetMs={clockOffsetMs}
            muted={muted}
            reducedMotion={reducedMotion}
            onSend={sendMessage}
            onLeave={leaveRoom}
          />
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-white/10 bg-[#0B101B] px-4 py-4 text-xs text-slate-400">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
          <span>
            CreaseHammer · IPL-style cricket auction simulator with real cricketers & unbranded geometric franchise crests
          </span>
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setRefTab('pool')} className="hover:text-white">
              Player Pool
            </button>
            <button type="button" onClick={() => setRefTab('rules')} className="hover:text-white">
              Rules
            </button>
            <button type="button" onClick={() => setRefTab('setup')} className="hover:text-white">
              Setup Guide
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
                  ? 'border-rose-500/40 bg-rose-950/95 text-rose-100'
                  : 'border-white/15 bg-[#111827] text-slate-100'
              }`}
            >
              <span className="leading-relaxed">{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss message"
                className="text-slate-400 hover:text-white shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Reference Modal */}
      {refTab && (
        <ReferenceModal
          activeTab={refTab}
          onChangeTab={(tab) => setRefTab(tab)}
          onClose={() => setRefTab(null)}
        />
      )}
    </div>
  );
}
