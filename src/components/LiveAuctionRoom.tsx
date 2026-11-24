import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Clock,
  FastForward,
  Gavel,
  Headphones,
  Mic,
  MicOff,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  auctionAnnouncer,
  buildBidAnnouncement,
  buildLeadChangeAnnouncement,
  buildNewPlayerAnnouncement,
  buildOutcomeAnnouncement,
  type AnnouncerStatus,
} from '../client/announcer.ts';
import {
  playBidSound,
  playExtendTimerSound,
  playNewLotSound,
  playPauseResumeSound,
  playSoldSound,
  playTickSound,
  playUnsoldSound,
  unlockAudio,
} from '../client/audio.ts';
import type { VoiceServerMessage } from '../client/useAuctionSocket.ts';
import { useVoiceChat } from '../client/useVoiceChat.ts';
import {
  evaluateTeamBidEligibility,
  formatLakhs,
  formatLakhsCompact,
  getBidIncrement,
  getMaxAffordableBid,
  getNextValidBid,
  getTeamOverseasCount,
  getTeamRoleCounts,
  type AuctionRoomState,
  type ClientMessage,
  type Player,
  type Team,
} from '../shared/types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { PlayerStatsTooltip, type HoveredPlayerStats } from './PlayerStatsTooltip.tsx';
import { TeamCrest } from './TeamCrest.tsx';

interface LiveAuctionRoomProps {
  state: AuctionRoomState;
  clientId: string;
  clockOffsetMs: number;
  wsConnected: boolean;
  muted: boolean;
  reducedMotion: boolean;
  onSend: (msg: ClientMessage) => void;
  addVoiceListener: (listener: (msg: VoiceServerMessage) => void) => () => void;
  onLeave: () => void;
}

type DeskTab = 'bids' | 'events' | 'unsold' | 'queue';

export function LiveAuctionRoom({
  state,
  clientId,
  clockOffsetMs,
  wsConnected,
  muted,
  reducedMotion,
  onSend,
  addVoiceListener,
  onLeave,
}: LiveAuctionRoomProps) {
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);
  const [deskTab, setDeskTab] = useState<DeskTab>('bids');
  const [inspectedTeamId, setInspectedTeamId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingBidKey, setPendingBidKey] = useState<string | null>(null);
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [hoveredPlayerStats, setHoveredPlayerStats] = useState<HoveredPlayerStats | null>(null);
  const [announcerStatus, setAnnouncerStatus] = useState<AnnouncerStatus>(() =>
    auctionAnnouncer.getStatus(),
  );

  const voice = useVoiceChat({
    enabled: true,
    wsConnected,
    roomCode: state.roomCode,
    clientId,
    onSend,
    addVoiceListener,
  });

  const activeSpeakers = useMemo(
    () =>
      voice.voicePeers.filter(
        (peer) => peer.speaking || (peer.clientId === clientId && (voice.isSpeaking || voice.isHoldTalking)),
      ),
    [voice.voicePeers, clientId, voice.isSpeaking, voice.isHoldTalking],
  );

  const prevBidIdRef = useRef<string | null>(state.currentLot?.bidHistory[0]?.id ?? null);
  const prevOutcomeTsRef = useRef<number | null>(state.lastOutcome?.timestamp ?? null);
  const prevLotNumRef = useRef<number | null>(null);
  const announcedLotKeyRef = useRef<string | null>(null);
  const announcedBidIdRef = useRef<string | null>(state.currentLot?.bidHistory[0]?.id ?? null);
  const announcedLeadRef = useRef<{ lotNumber: number; teamId: string | null; amount: number } | null>(
    state.currentLot
      ? {
          lotNumber: state.currentLot.lotNumber,
          teamId: state.currentLot.leadingTeamId,
          amount: state.currentLot.currentBid,
        }
      : null,
  );
  const announcedOutcomeKeyRef = useRef<string | null>(
    state.lastOutcome ? `${state.lastOutcome.player.id}:${state.lastOutcome.timestamp}` : null,
  );
  const prevPhaseRef = useRef<AuctionRoomState['phase']>(state.phase);
  const prevLotEndsAtRef = useRef<{ lotNum: number; endsAt: number; bidsLen: number } | null>(
    state.currentLot
      ? {
          lotNum: state.currentLot.lotNumber,
          endsAt: state.currentLot.lotEndsAt,
          bidsLen: state.currentLot.bidHistory.length,
        }
      : null,
  );
  const lastTickSecRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const me = state.participants.find((p) => p.clientId === clientId);
  const isHost = Boolean(me?.isHost);
  const lot = state.currentLot;
  const outcome = state.lastOutcome;

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now() + clockOffsetMs);
    }, 100);
    return () => window.clearInterval(id);
  }, [clockOffsetMs]);

  const remainingMs = useMemo(() => {
    if (!lot) return 0;
    if (state.phase === 'PAUSED') {
      return lot.remainingMsWhenPaused ?? 0;
    }
    if (state.phase === 'LIVE') {
      return Math.max(0, lot.lotEndsAt - nowMs);
    }
    return 0;
  }, [lot, nowMs, state.phase]);

  const remainingSec = Math.ceil(remainingMs / 1000);
  const timerPct = lot
    ? Math.max(0, Math.min(100, (remainingMs / (state.config.timerSeconds * 1000)) * 100))
    : 0;

  useEffect(() => {
    const unsubscribe = auctionAnnouncer.subscribe(setAnnouncerStatus);
    const handleGestureUnlock = () => {
      auctionAnnouncer.unlockFromGesture();
    };
    window.addEventListener('pointerdown', handleGestureUnlock, { passive: true, capture: true });
    window.addEventListener('keydown', handleGestureUnlock, { passive: true, capture: true });
    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', handleGestureUnlock, true);
      window.removeEventListener('keydown', handleGestureUnlock, true);
      auctionAnnouncer.clearAllSpeech();
    };
  }, []);

  useEffect(() => {
    if (lot && state.phase === 'LIVE' && prevLotNumRef.current !== lot.lotNumber) {
      prevLotNumRef.current = lot.lotNumber;
      playNewLotSound(muted);
    }
  }, [lot, state.phase, muted]);

  // Spoken announcement: new player enters the block (server-confirmed currentLot)
  useEffect(() => {
    if (!lot || state.phase !== 'LIVE') return;
    const lotKey = `${lot.lotNumber}:${lot.player.id}:${lot.openedAt}`;
    if (announcedLotKeyRef.current !== lotKey) {
      announcedLotKeyRef.current = lotKey;
      announcedLeadRef.current = {
        lotNumber: lot.lotNumber,
        teamId: lot.leadingTeamId,
        amount: lot.currentBid,
      };
      auctionAnnouncer.enqueue('lot', buildNewPlayerAnnouncement(lot.player), `lot:${lotKey}`);
    }
  }, [lot, state.phase]);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    if (prev !== state.phase) {
      prevPhaseRef.current = state.phase;
      if (prev === 'LIVE' && state.phase === 'PAUSED') {
        playPauseResumeSound(muted, true);
      } else if (prev === 'PAUSED' && state.phase === 'LIVE') {
        playPauseResumeSound(muted, false);
      }
    }
  }, [state.phase, muted]);

  useEffect(() => {
    if (!lot || state.phase !== 'LIVE') {
      prevLotEndsAtRef.current = lot
        ? { lotNum: lot.lotNumber, endsAt: lot.lotEndsAt, bidsLen: lot.bidHistory.length }
        : null;
      return;
    }
    const prev = prevLotEndsAtRef.current;
    if (
      prev &&
      prev.lotNum === lot.lotNumber &&
      prev.bidsLen === lot.bidHistory.length &&
      lot.lotEndsAt - prev.endsAt > 2500
    ) {
      playExtendTimerSound(muted);
    }
    prevLotEndsAtRef.current = {
      lotNum: lot.lotNumber,
      endsAt: lot.lotEndsAt,
      bidsLen: lot.bidHistory.length,
    };
  }, [lot, state.phase, muted]);

  useEffect(() => {
    const latestBid = lot?.bidHistory[0] ?? null;
    if (latestBid && latestBid.id !== prevBidIdRef.current) {
      prevBidIdRef.current = latestBid.id;
      playBidSound(muted, !latestBid.isBot);
    }

    // Spoken announcement: server-confirmed accepted bid or highest-bidder change
    if (!lot || (state.phase !== 'LIVE' && state.phase !== 'PAUSED')) return;

    if (latestBid && latestBid.id !== announcedBidIdRef.current) {
      announcedBidIdRef.current = latestBid.id;
      announcedLeadRef.current = {
        lotNumber: lot.lotNumber,
        teamId: lot.leadingTeamId,
        amount: lot.currentBid,
      };
      auctionAnnouncer.enqueue(
        'bid',
        buildBidAnnouncement(latestBid.teamName, latestBid.amount),
        `bid:${latestBid.id}`,
      );
      return;
    }

    const prevLead = announcedLeadRef.current;
    if (
      prevLead &&
      prevLead.lotNumber === lot.lotNumber &&
      (prevLead.teamId !== lot.leadingTeamId || prevLead.amount !== lot.currentBid)
    ) {
      announcedLeadRef.current = {
        lotNumber: lot.lotNumber,
        teamId: lot.leadingTeamId,
        amount: lot.currentBid,
      };
      if (lot.leadingTeamId && lot.currentBid > 0) {
        const leader = state.teams.find((t) => t.id === lot.leadingTeamId);
        if (leader) {
          auctionAnnouncer.enqueue(
            'bid',
            buildLeadChangeAnnouncement(leader.name, lot.currentBid),
            `lead:${lot.lotNumber}:${lot.leadingTeamId}:${lot.currentBid}`,
          );
        }
      }
    }
  }, [lot, state.phase, state.teams, muted]);

  useEffect(() => {
    if (state.phase === 'LIVE' && remainingSec > 0 && remainingSec <= 4) {
      if (lastTickSecRef.current !== remainingSec) {
        lastTickSecRef.current = remainingSec;
        playTickSound(muted, remainingSec <= 2);
      }
    } else {
      lastTickSecRef.current = null;
    }
  }, [remainingSec, state.phase, muted]);

  useEffect(() => {
    if (state.phase === 'LOT_RESULT' && outcome && outcome.timestamp !== prevOutcomeTsRef.current) {
      prevOutcomeTsRef.current = outcome.timestamp;
      if (outcome.status === 'SOLD') {
        playSoldSound(muted);
      } else {
        playUnsoldSound(muted);
      }
    }

    // Spoken announcement: server-confirmed lot close (SOLD / UNSOLD)
    if (state.phase === 'LOT_RESULT' && outcome) {
      const outcomeKey = `${outcome.player.id}:${outcome.timestamp}`;
      if (announcedOutcomeKeyRef.current !== outcomeKey) {
        announcedOutcomeKeyRef.current = outcomeKey;
        auctionAnnouncer.enqueue('result', buildOutcomeAnnouncement(outcome), `result:${outcomeKey}`);
      }
    }
  }, [state.phase, outcome, muted]);

  const leadingTeam = lot?.leadingTeamId
    ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null
    : null;

  const nextBid = lot ? getNextValidBid(lot) : 0;
  const currentIncrement = lot && lot.currentBid > 0 ? getBidIncrement(lot.currentBid) : 0;

  useEffect(() => {
    setPendingBidKey(null);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, [lot?.lotNumber, lot?.currentBid, lot?.leadingTeamId, state.phase]);

  const biddableHumanTeams: Team[] = useMemo(() => {
    if (state.config.mode === 'local') {
      return state.teams.filter(
        (t) => t.controlType === 'human' && (isHost || t.ownerClientId === clientId),
      );
    }
    if (state.config.mode === 'solo') {
      return state.teams.filter((t) => t.controlType === 'human' && t.ownerClientId === clientId);
    }
    return state.teams.filter(
      (t) => t.controlType === 'human' && t.ownerClientId === clientId && me?.teamId === t.id,
    );
  }, [state.config.mode, state.teams, clientId, isHost, me?.teamId]);

  const inspectedTeam =
    state.teams.find((t) => t.id === inspectedTeamId) ??
    biddableHumanTeams[0] ??
    state.teams[0];

  const handlePlaceBid = (teamId: string, expectedAmount: number) => {
    if (!lot) return;
    unlockAudio();
    auctionAnnouncer.unlockFromGesture();
    const key = `${lot.lotNumber}:${teamId}:${expectedAmount}`;
    setPendingBidKey(key);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setPendingBidKey((cur) => (cur === key ? null : cur));
    }, 900);

    onSend({
      type: 'auction:bid',
      teamId,
      expectedAmount,
    });
  };

  const volumePercent = Math.round(announcerStatus.volume * 100);

  const currentSet = lot?.player.set ?? null;
  const auctionedInSet = currentSet
    ? state.soldHistory.filter((o) => o.player.set === currentSet).length +
      state.unsoldPool.filter((p) => p.set === currentSet).length
    : 0;
  const queuedInSet = currentSet
    ? state.playerQueue.filter((p) => p.set === currentSet).length
    : 0;
  const totalInSet = currentSet ? auctionedInSet + 1 + queuedInSet : 0;
  const setProgressPct =
    totalInSet > 0 ? Math.min(100, Math.round((auctionedInSet / totalInSet) * 100)) : 0;

  const showPlayerStats = (player: Player, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHoveredPlayerStats({
      player,
      anchorRect: {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      },
    });
  };

  const hidePlayerStats = () => {
    setHoveredPlayerStats(null);
  };

  useEffect(() => {
    setHoveredPlayerStats(null);
  }, [lot?.lotNumber, lot?.player.id, state.phase, deskTab, inspectedTeamId]);

  useEffect(() => {
    const dismiss = () => setHoveredPlayerStats(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 space-y-5">
      <PlayerStatsTooltip hovered={hoveredPlayerStats} />

      {/* Screen-reader live announcement region synced with confirmed auction events */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcerStatus.lastSpokenText}
      </div>

      {/* Top Broadcast Context Strip */}
      <div className="flex flex-col gap-3 rounded-xl border border-[#5B91A3]/35 bg-[#2F4A63] px-4 py-3 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-display text-lg font-bold tracking-wide text-[#CFEAE0]">
              Room <span className="font-mono-num text-white">{state.roomCode}</span>
            </span>
            <span className="text-[#5B91A3]" aria-hidden="true">·</span>
            <span className="text-[#CFEAE0]/85">
              {lot ? `Lot #${lot.lotNumber} of ${lot.totalLots}` : `Completed ${state.soldHistory.length + state.unsoldPool.length} Lots`}
            </span>
            <span className="text-[#5B91A3]" aria-hidden="true">·</span>
            <span className="text-[#CFEAE0]/85">
              {lot ? `Set: ${lot.player.set}` : 'Lot Transition'}
            </span>
            <span className="text-[#5B91A3]" aria-hidden="true">·</span>
            <span
              className={`font-bold ${
                state.phase === 'LIVE'
                  ? 'text-emerald-300'
                  : state.phase === 'PAUSED'
                    ? 'text-amber-300'
                    : 'text-[#CFEAE0]'
              }`}
            >
              {state.phase === 'LIVE'
                ? 'Bidding Open'
                : state.phase === 'PAUSED'
                  ? 'Clock Paused'
                  : outcome?.status === 'SOLD'
                    ? 'Hammer Sold'
                    : 'Marked Unsold'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-[#CFEAE0]/80">
            <span>
              Sold: <strong className="font-mono-num text-[#CFEAE0]">{state.soldHistory.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Unsold: <strong className="font-mono-num text-[#CFEAE0]">{state.unsoldPool.length}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Queued: <strong className="font-mono-num text-[#CFEAE0]">{state.playerQueue.length}</strong>
            </span>
            <button
              type="button"
              onClick={onLeave}
              className="ml-1 rounded-lg border border-[#5B91A3]/50 bg-[#131B2B] px-3 py-1.5 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
            >
              Exit Room
            </button>
          </div>
        </div>

        {/* Spoken Announcement Controls (Desktop & Mobile accessible) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#CFEAE0]/15 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            {announcerStatus.supported ? (
              <>
                <button
                  type="button"
                  aria-pressed={announcerStatus.muted}
                  aria-label={
                    announcerStatus.muted
                      ? 'Unmute spoken auction announcements'
                      : 'Mute spoken auction announcements'
                  }
                  onClick={() => {
                    unlockAudio();
                    auctionAnnouncer.setMuted(!announcerStatus.muted);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-bold transition-colors whitespace-nowrap ${
                    announcerStatus.muted
                      ? 'border-[#5B91A3]/40 bg-[#131B2B] text-[#CFEAE0]/75 hover:text-[#CFEAE0]'
                      : 'border-[#5B91A3] bg-[#5B91A3] text-[#131B2B] hover:bg-[#70A7B9]'
                  }`}
                >
                  {announcerStatus.muted ? (
                    <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span>{announcerStatus.muted ? 'Announcer Muted' : 'Announcer On'}</span>
                </button>

                <label className="inline-flex items-center gap-2 rounded-lg border border-[#5B91A3]/35 bg-[#131B2B] px-3 py-1.5">
                  <span className="text-[11px] font-semibold text-[#CFEAE0]/80 whitespace-nowrap">
                    Volume
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={announcerStatus.muted ? 0 : volumePercent}
                    aria-label="Spoken announcement volume"
                    onChange={(e) => {
                      const nextPct = Number(e.target.value);
                      unlockAudio();
                      auctionAnnouncer.unlockFromGesture();
                      if (nextPct > 0 && announcerStatus.muted) {
                        auctionAnnouncer.setMuted(false);
                      }
                      auctionAnnouncer.setVolume(nextPct / 100);
                    }}
                    className="h-1.5 w-20 sm:w-28 cursor-pointer accent-[#5B91A3]"
                  />
                  <span className="w-8 text-right font-mono-num text-[11px] font-bold text-[#CFEAE0]">
                    {announcerStatus.muted ? '0%' : `${volumePercent}%`}
                  </span>
                </label>

                {announcerStatus.autoplayBlocked && !announcerStatus.muted && (
                  <button
                    type="button"
                    onClick={() => {
                      unlockAudio();
                      auctionAnnouncer.unlockFromGesture();
                    }}
                    className="rounded-lg border border-amber-300/60 bg-amber-950/60 px-2.5 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-950/85 whitespace-nowrap"
                  >
                    Tap to Enable Browser Voice
                  </button>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#5B91A3]/30 bg-[#131B2B] px-3 py-1.5 text-[11px] text-[#CFEAE0]/70">
                <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Voice announcements unavailable in this browser
              </span>
            )}
          </div>

          {announcerStatus.lastSpokenText && (
            <div className="min-w-0 truncate text-[11px] text-[#CFEAE0]/75 max-w-full sm:max-w-md">
              <span className="font-semibold text-[#CFEAE0]/90">Announcer:</span>{' '}
              <span>{announcerStatus.lastSpokenText}</span>
            </div>
          )}
        </div>

        {/* Real-Time Multi-User Voice Chat Controls (Mic Toggle + Push-to-Talk + Mute + Speakers) */}
        <div className="flex flex-col gap-2.5 border-t border-[#CFEAE0]/15 pt-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-[#CFEAE0]/85 whitespace-nowrap">
                <Radio className="h-3.5 w-3.5 text-[#5B91A3]" aria-hidden="true" />
                Live Voice Chat
              </span>

              {/* Toggle Mic Button (Off by default; tap once ON, tap again OFF) */}
              <button
                type="button"
                aria-pressed={voice.isMicOn}
                aria-label={voice.isMicOn ? 'Turn microphone off' : 'Turn microphone on'}
                onClick={() => {
                  voice.unlockIncomingAudio();
                  void voice.toggleMic();
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 font-bold transition-colors whitespace-nowrap min-h-[38px] sm:min-h-0 ${
                  voice.isMicOn
                    ? 'border-emerald-400 bg-emerald-500 text-[#131B2B] hover:bg-emerald-400'
                    : 'border-[#5B91A3]/45 bg-[#131B2B] text-[#CFEAE0]/85 hover:text-[#CFEAE0] hover:border-[#5B91A3]'
                }`}
              >
                {voice.isMicOn ? (
                  <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <MicOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{voice.isMicOn ? 'Mic On' : 'Mic Off'}</span>
              </button>

              {/* Push-to-Talk Hold Button */}
              <button
                type="button"
                aria-pressed={voice.isHoldTalking}
                aria-label="Hold to talk to room participants"
                onPointerDown={(e) => {
                  e.preventDefault();
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // Ignore capture fallback on older mobile browsers
                  }
                  voice.unlockIncomingAudio();
                  void voice.startPushToTalk();
                }}
                onPointerUp={() => voice.stopPushToTalk()}
                onPointerCancel={() => voice.stopPushToTalk()}
                onLostPointerCapture={() => voice.stopPushToTalk()}
                onKeyDown={(e) => {
                  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                    e.preventDefault();
                    voice.unlockIncomingAudio();
                    void voice.startPushToTalk();
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    voice.stopPushToTalk();
                  }
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 font-bold transition-colors whitespace-nowrap touch-none select-none min-h-[38px] sm:min-h-0 ${
                  voice.isHoldTalking
                    ? 'border-emerald-300 bg-emerald-400 text-[#131B2B] shadow-sm'
                    : 'border-[#5B91A3]/45 bg-[#131B2B] text-[#CFEAE0]/90 hover:border-[#CFEAE0] hover:text-[#CFEAE0]'
                }`}
              >
                <Mic className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{voice.isHoldTalking ? 'Talking...' : 'Hold to Talk'}</span>
              </button>

              {/* Mute / Unmute Incoming Participants Audio */}
              <button
                type="button"
                aria-pressed={voice.isIncomingMuted}
                aria-label={voice.isIncomingMuted ? 'Unmute participants voice chat' : 'Mute participants voice chat'}
                onClick={() => {
                  voice.unlockIncomingAudio();
                  voice.toggleIncomingMute();
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 sm:py-1.5 font-bold transition-colors whitespace-nowrap min-h-[38px] sm:min-h-0 ${
                  voice.isIncomingMuted
                    ? 'border-rose-400/50 bg-rose-950/60 text-rose-200 hover:bg-rose-950/80'
                    : 'border-[#5B91A3]/45 bg-[#131B2B] text-[#CFEAE0]/85 hover:text-[#CFEAE0]'
                }`}
              >
                {voice.isIncomingMuted ? (
                  <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Headphones className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{voice.isIncomingMuted ? 'Chat Muted' : 'Chat Audio On'}</span>
              </button>

              {voice.autoplayBlocked && !voice.isIncomingMuted && (
                <button
                  type="button"
                  onClick={() => voice.unlockIncomingAudio()}
                  className="rounded-lg border border-amber-300/60 bg-amber-950/60 px-2.5 py-1.5 text-[11px] font-bold text-amber-200 hover:bg-amber-950/85 whitespace-nowrap"
                >
                  Tap to Enable Voice Audio
                </button>
              )}

              {/* Live local mic input level bar when transmitting */}
              {voice.isTransmitting && (
                <div
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-[#131B2B] px-2.5 py-1.5"
                  aria-label="Microphone transmission level"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                  <div className="h-1.5 w-14 overflow-hidden rounded-full bg-[#2F4A63]">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-100"
                      style={{ width: `${Math.max(12, Math.round(voice.micLevel * 100))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Who is Speaking Readout */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              {voice.permissionState === 'requesting' ? (
                <span className="rounded-lg border border-amber-300/45 bg-amber-950/50 px-2.5 py-1 font-semibold text-amber-200">
                  Requesting microphone permission...
                </span>
              ) : activeSpeakers.length > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-950/55 px-2.5 py-1 font-bold text-emerald-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                  Speaking:{' '}
                  {activeSpeakers
                    .map((p) => (p.teamShortCode ? `${p.name} (${p.teamShortCode})` : p.name))
                    .join(', ')}
                </span>
              ) : (
                <span className="text-[#CFEAE0]/70">
                  {voice.voicePeers.length > 1
                    ? `${voice.voicePeers.length} connected in voice room · Nobody speaking`
                    : voice.isTransmitting
                      ? 'Mic live — waiting for audio input'
                      : 'Mic off · Tap Mic Off or hold Hold to Talk'}
                </span>
              )}
            </div>
          </div>

          {/* Connected Voice Room Participants */}
          {voice.voicePeers.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {voice.voicePeers.map((peer) => {
                const isSelf = peer.clientId === clientId;
                const peerSpeaking =
                  peer.speaking || (isSelf && (voice.isSpeaking || voice.isHoldTalking));
                const peerMicOn = peer.micActive || (isSelf && voice.isTransmitting);
                return (
                  <span
                    key={peer.clientId}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                      peerSpeaking
                        ? 'border-emerald-400/70 bg-emerald-950/60 text-emerald-200'
                        : peerMicOn
                          ? 'border-[#5B91A3]/60 bg-[#131B2B] text-[#CFEAE0]'
                          : 'border-[#5B91A3]/25 bg-[#131B2B]/70 text-[#CFEAE0]/70'
                    }`}
                  >
                    {peerMicOn ? (
                      <Mic
                        className={`h-3 w-3 shrink-0 ${peerSpeaking ? 'text-emerald-300' : 'text-[#5B91A3]'}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <MicOff className="h-3 w-3 shrink-0 text-[#CFEAE0]/45" aria-hidden="true" />
                    )}
                    <span>
                      {peer.name}
                      {isSelf ? ' (You)' : ''}
                      {peer.teamShortCode ? ` · ${peer.teamShortCode}` : ''}
                    </span>
                    <span className="text-[10px] opacity-80">
                      {peerSpeaking ? 'Speaking' : peerMicOn ? 'Mic On' : 'Listening'}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Microphone Permission / Availability Help Alert */}
          {voice.errorMessage && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-lg border border-rose-400/45 bg-rose-950/65 px-3 py-2 text-xs text-rose-100"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                <span className="leading-relaxed">{voice.errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => voice.dismissError()}
                aria-label="Dismiss microphone alert"
                className="shrink-0 text-rose-200/80 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main 12-Column Broadcast Arena */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT / CENTER STAGE (8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          {lot ? (
            <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 sm:p-6 space-y-5 shadow-xl">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <div
                  tabIndex={0}
                  onMouseEnter={(e) => showPlayerStats(lot.player, e.currentTarget)}
                  onMouseLeave={hidePlayerStats}
                  onFocus={(e) => showPlayerStats(lot.player, e.currentTarget)}
                  onBlur={hidePlayerStats}
                  className="shrink-0 w-full sm:w-auto cursor-help rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B91A3]"
                >
                  <PlayerAvatar player={lot.player} size="hero" />
                </div>

                <div className="min-w-0 flex-1 space-y-4 w-full">
                  <div>
                    <div className="text-xs font-bold tracking-wider text-[#CFEAE0]/80 uppercase">
                      {lot.player.set} Set · {lot.player.specialty}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2.5">
                      <h1
                        onMouseEnter={(e) => showPlayerStats(lot.player, e.currentTarget)}
                        onMouseLeave={hidePlayerStats}
                        className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-[#CFEAE0] leading-tight cursor-help"
                      >
                        {lot.player.name}
                      </h1>
                      <button
                        type="button"
                        onMouseEnter={(e) => showPlayerStats(lot.player, e.currentTarget)}
                        onMouseLeave={hidePlayerStats}
                        onFocus={(e) => showPlayerStats(lot.player, e.currentTarget)}
                        onBlur={hidePlayerStats}
                        onClick={(e) =>
                          hoveredPlayerStats?.player.id === lot.player.id
                            ? hidePlayerStats()
                            : showPlayerStats(lot.player, e.currentTarget)
                        }
                        aria-label={`View quick stats for ${lot.player.name}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#5B91A3]/55 bg-[#131B2B]/85 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#CFEAE0] hover:border-[#CFEAE0] hover:bg-[#1B293D]"
                      >
                        <BarChart3 className="h-3.5 w-3.5 text-[#5B91A3]" aria-hidden="true" />
                        Stats
                      </button>
                    </div>
                    <div className="mt-2.5 rounded-lg border border-[#5B91A3]/25 bg-[#131B2B]/70 px-3 py-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-[#CFEAE0]/85">
                          {lot.player.set} Set Progress
                        </span>
                        <span className="font-mono-num font-bold text-[#CFEAE0]">
                          {auctionedInSet} / {totalInSet} auctioned
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${lot.player.set} set auction progress`}
                        aria-valuenow={auctionedInSet}
                        aria-valuemin={0}
                        aria-valuemax={totalInSet}
                        className="h-2 w-full overflow-hidden rounded-full bg-[#131B2B]"
                      >
                        <div
                          className="h-full rounded-full bg-[#5B91A3] transition-all duration-300"
                          style={{ width: `${setProgressPct}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-[#CFEAE0]/85">
                      <span className="font-bold text-[#CFEAE0]">{lot.player.role}</span>
                      <span className="text-[#5B91A3]" aria-hidden="true">·</span>
                      <span className="font-semibold text-[#CFEAE0]">{lot.player.tacticalRole}</span>
                      <span className="text-[#5B91A3]" aria-hidden="true">·</span>
                      <span>
                        {lot.player.nationality}
                        {lot.player.isOverseas ? ' (Overseas)' : ' (Domestic)'}
                      </span>
                      {lot.player.age !== null && (
                        <>
                          <span className="text-[#5B91A3]" aria-hidden="true">·</span>
                          <span className="font-mono-num">Age {lot.player.age}</span>
                        </>
                      )}
                      {lot.player.battingStyle !== '—' && (
                        <>
                          <span className="text-[#5B91A3]" aria-hidden="true">·</span>
                          <span>{lot.player.battingStyle}</span>
                        </>
                      )}
                      {lot.player.bowlingStyle !== '—' && (
                        <>
                          <span className="text-[#5B91A3]" aria-hidden="true">·</span>
                          <span>{lot.player.bowlingStyle}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* T20 Stats Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-3">
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">IPL Matches</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.matches !== null ? lot.player.stats.matches : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">Runs</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.runs !== null ? lot.player.stats.runs : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">Strike Rate</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.strikeRate !== null ? lot.player.stats.strikeRate.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">Average</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.average !== null ? lot.player.stats.average.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">Wickets</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.wickets !== null ? lot.player.stats.wickets : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#CFEAE0]/65">Economy</div>
                      <div className="font-mono-num text-base font-bold text-[#CFEAE0]">
                        {lot.player.stats.economy !== null && lot.player.stats.economy > 0
                          ? lot.player.stats.economy.toFixed(2)
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Live Bid & Countdown Readout */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-4">
                    <div>
                      <div className="text-xs text-[#CFEAE0]/65">Base Price</div>
                      <div className="mt-1 font-mono-num text-lg font-bold text-[#CFEAE0]">
                        {formatLakhs(lot.player.basePrice)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-[#CFEAE0]/65">
                        {lot.currentBid > 0 ? 'Current Highest Bid' : 'Opening Ask'}
                      </div>
                      <div className="mt-1 font-mono-num text-2xl font-extrabold text-[#CFEAE0]">
                        {lot.currentBid > 0 ? formatLakhsCompact(lot.currentBid) : formatLakhs(lot.player.basePrice)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-[#CFEAE0]/65">Leading Franchise</div>
                      {leadingTeam ? (
                        <div className="mt-1 flex items-center gap-2 min-w-0">
                          <TeamCrest shortCode={leadingTeam.shortCode} color={leadingTeam.color} size="sm" />
                          <span className="truncate text-sm font-bold text-[#CFEAE0]">{leadingTeam.name}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-sm font-medium text-[#CFEAE0]/70">Awaiting first bid</div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-[#CFEAE0]/65">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {state.phase === 'PAUSED' ? 'Paused' : 'Synced Clock'}
                        </span>
                        {currentIncrement > 0 && (
                          <span className="font-mono-num text-[#5B91A3]">+{formatLakhs(currentIncrement)}</span>
                        )}
                      </div>
                      <div
                        className={`mt-1 font-mono-num text-2xl sm:text-3xl font-extrabold tracking-tight ${
                          state.phase === 'PAUSED'
                            ? 'text-amber-300'
                            : remainingSec <= 3
                              ? 'text-rose-400'
                              : remainingSec <= 5
                                ? 'text-amber-300'
                                : 'text-[#CFEAE0]'
                        }`}
                      >
                        00:{String(remainingSec).padStart(2, '0')}
                      </div>
                    </div>
                  </div>

                  {state.phase === 'PAUSED' && (
                    <div className="rounded-xl border border-amber-300/45 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-amber-200">
                      Clock paused by the auctioneer — bidding is temporarily held across all connected devices.
                    </div>
                  )}

                  {/* Timer Progress Bar */}
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#131B2B]" aria-label="Auction countdown bar">
                    <div
                      className={`h-full transition-all duration-100 ${
                        state.phase === 'PAUSED'
                          ? 'bg-amber-300'
                          : remainingSec <= 3
                            ? 'bg-rose-400'
                            : remainingSec <= 5
                              ? 'bg-amber-300'
                              : 'bg-[#5B91A3]'
                      }`}
                      style={{ width: `${timerPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* ALWAYS-VISIBLE BIDDING DECK */}
              <div className="border-t border-[#CFEAE0]/15 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[#CFEAE0]">
                    {state.config.mode === 'local'
                      ? 'Shared Bidding Deck — Every Franchise Bids Openly'
                      : 'Your Franchise Bidding Console'}
                  </div>
                  <div className="text-xs text-[#CFEAE0]/80">
                    Next valid bid: <span className="font-mono-num font-bold text-[#CFEAE0]">{formatLakhsCompact(nextBid)}</span>
                    {' · '}
                    No pass button required
                  </div>
                </div>

                {biddableHumanTeams.length === 0 ? (
                  <div className="rounded-xl border border-amber-300/40 bg-[#131B2B] p-4 text-sm text-[#CFEAE0]">
                    {state.config.mode === 'online'
                      ? 'You have not claimed a franchise in this room. You must claim a team in the lobby before placing bids.'
                      : 'No human-controlled franchise is assigned to this session.'}
                  </div>
                ) : (
                  <div
                    className={`grid gap-3 ${
                      biddableHumanTeams.length === 1
                        ? 'grid-cols-1'
                        : biddableHumanTeams.length === 2
                          ? 'grid-cols-1 sm:grid-cols-2'
                          : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
                    }`}
                  >
                    {biddableHumanTeams.map((team) => {
                      const elig = evaluateTeamBidEligibility(team, lot, state.config, state.phase);
                      const isLeading = lot.leadingTeamId === team.id;
                      const overseas = getTeamOverseasCount(team);
                      const roles = getTeamRoleCounts(team);
                      const bidKey = `${lot.lotNumber}:${team.id}:${elig.nextBid}`;
                      const isSubmitting = pendingBidKey === bidKey;

                      return (
                        <div
                          key={team.id}
                          className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-colors ${
                            isLeading
                              ? 'border-emerald-400/60 bg-emerald-950/35'
                              : 'border-[#5B91A3]/35 bg-[#131B2B]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <TeamCrest shortCode={team.shortCode} color={team.color} size="md" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-[#CFEAE0]">{team.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#CFEAE0]/75 font-mono-num">
                                <span className="text-[#5B91A3] font-bold">{formatLakhsCompact(team.purse)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{team.squad.length}/{state.config.maxSquadSize}</span>
                                <span aria-hidden="true">·</span>
                                <span>OS {overseas}/{state.config.maxOverseas}</span>
                              </div>
                              {biddableHumanTeams.length === 1 && (
                                <div className="mt-1 text-[11px] text-[#CFEAE0]/70 font-mono-num">
                                  BAT {roles.Batter} · BWL {roles.Bowler} · AR {roles['All-Rounder']} · WK {roles.Wicketkeeper} · Max Bid {formatLakhsCompact(getMaxAffordableBid(team, state.config))}
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={!elig.canBid || isSubmitting}
                            onClick={() => handlePlaceBid(team.id, elig.nextBid)}
                            className={`rounded-xl px-4 py-2.5 text-sm font-extrabold transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 min-h-[44px] ${
                              elig.canBid && !isSubmitting
                                ? 'bg-[#5B91A3] text-[#131B2B] hover:bg-[#70A7B9] shadow-sm'
                                : isLeading
                                  ? 'border border-emerald-400/40 bg-emerald-950/50 text-emerald-300 cursor-default'
                                  : 'border border-[#5B91A3]/25 bg-[#2F4A63]/40 text-[#CFEAE0]/50 cursor-not-allowed'
                            }`}
                          >
                            {isSubmitting
                              ? 'Placing...'
                              : elig.canBid
                                ? `Bid ${formatLakhs(elig.nextBid)}`
                                : elig.reason || 'Unavailable'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : state.phase === 'LOT_RESULT' && outcome ? (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={`rounded-2xl border p-6 sm:p-8 text-center space-y-5 shadow-xl ${
                outcome.status === 'SOLD'
                  ? 'border-emerald-400/50 bg-[#2F4A63]'
                  : 'border-[#5B91A3]/35 bg-[#2F4A63]'
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <div
                  tabIndex={0}
                  onMouseEnter={(e) => showPlayerStats(outcome.player, e.currentTarget)}
                  onMouseLeave={hidePlayerStats}
                  onFocus={(e) => showPlayerStats(outcome.player, e.currentTarget)}
                  onBlur={hidePlayerStats}
                  className="cursor-help rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5B91A3]"
                >
                  <PlayerAvatar player={outcome.player} size="md" />
                </div>
                <div className="space-y-1">
                  <div
                    className={`inline-flex items-center gap-2 font-display text-4xl sm:text-5xl font-extrabold tracking-wider uppercase ${
                      outcome.status === 'SOLD' ? 'text-emerald-300' : 'text-[#CFEAE0]/80'
                    }`}
                  >
                    <Gavel className="h-8 w-8" aria-hidden="true" />
                    {outcome.status === 'SOLD' ? 'SOLD!' : 'UNSOLD'}
                  </div>
                  <h2
                    onMouseEnter={(e) => showPlayerStats(outcome.player, e.currentTarget)}
                    onMouseLeave={hidePlayerStats}
                    className="font-display text-2xl sm:text-3xl font-bold text-[#CFEAE0] cursor-help"
                  >
                    {outcome.player.name}
                  </h2>
                  <p className="text-sm text-[#CFEAE0]/80">
                    {outcome.player.role} · {outcome.player.nationality} · Base {formatLakhs(outcome.player.basePrice)}
                  </p>
                </div>

                {outcome.status === 'SOLD' && outcome.winningTeamName && (
                  <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-emerald-400/35 bg-[#131B2B] px-5 py-3">
                    <TeamCrest
                      shortCode={outcome.winningTeamShortCode || 'TEAM'}
                      color={outcome.winningTeamColor || '#5B91A3'}
                      size="md"
                    />
                    <div className="text-left">
                      <div className="text-xs text-[#CFEAE0]/70">Acquired by {outcome.winningTeamName}</div>
                      <div className="font-mono-num text-xl font-extrabold text-[#CFEAE0]">
                        {formatLakhsCompact(outcome.soldPrice)}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  {isHost && outcome.status === 'UNSOLD' && (
                    <button
                      type="button"
                      onClick={() => onSend({ type: 'auction:reauction_player', playerId: outcome.player.id })}
                      className="inline-flex items-center gap-2 rounded-xl border border-[#5B91A3]/60 bg-[#131B2B] px-4 py-2 text-sm font-bold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Re-Auction Immediately
                    </button>
                  )}
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => onSend({ type: 'auction:next_lot' })}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-2 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
                    >
                      <FastForward className="h-4 w-4" aria-hidden="true" />
                      Next Player Now
                    </button>
                  )}
                  {!isHost && (
                    <div className="text-xs text-[#CFEAE0]/75">Advancing to next lot shortly...</div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : null}

          {/* FRANCHISE SQUAD & PURSE MATRIX */}
          <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 space-y-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-bold text-[#CFEAE0]">
                Franchise Purses & Squad Balance ({state.teams.length} Teams)
              </h2>
              <span className="text-xs text-[#CFEAE0]/75">
                Select any franchise below to inspect its signed squad
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {state.teams.map((team) => {
                const roles = getTeamRoleCounts(team);
                const overseas = getTeamOverseasCount(team);
                const isSelected = inspectedTeam?.id === team.id;
                const isLeading = lot?.leadingTeamId === team.id;

                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setInspectedTeamId(team.id)}
                    className={`text-left rounded-xl border p-3 transition-colors ${
                      isLeading
                        ? 'border-emerald-400/65 bg-emerald-950/35'
                        : isSelected
                          ? 'border-[#CFEAE0] bg-[#131B2B]'
                          : 'border-[#5B91A3]/30 bg-[#131B2B]/80 hover:bg-[#131B2B]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TeamCrest shortCode={team.shortCode} color={team.color} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[#CFEAE0]">
                            {team.name}
                          </div>
                          <div className="text-[11px] text-[#CFEAE0]/70">
                            {team.controlType === 'bot' ? 'AI Bot' : team.ownerName || 'Human'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono-num text-sm font-bold text-[#5B91A3]">
                          {formatLakhsCompact(team.purse)}
                        </div>
                        <div className="font-mono-num text-[11px] text-[#CFEAE0]/70">
                          {team.squad.length}/{state.config.maxSquadSize} · OS {overseas}/{state.config.maxOverseas}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] font-mono-num text-[#CFEAE0]/70 border-t border-[#5B91A3]/20 pt-1.5">
                      <span>BAT {roles.Batter}</span>
                      <span>BWL {roles.Bowler}</span>
                      <span>AR {roles['All-Rounder']}</span>
                      <span>WK {roles.Wicketkeeper}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {inspectedTeam && (
              <div className="rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <TeamCrest shortCode={inspectedTeam.shortCode} color={inspectedTeam.color} size="sm" />
                    <span className="font-bold text-[#CFEAE0]">{inspectedTeam.name} Squad</span>
                    <span className="text-xs text-[#CFEAE0]/70 font-mono-num">
                      ({inspectedTeam.squad.length} signed · {Math.max(0, state.config.minSquadSize - inspectedTeam.squad.length)} needed for min {state.config.minSquadSize})
                    </span>
                  </div>
                  <div className="text-xs text-[#CFEAE0]/80 font-mono-num">
                    Spent {formatLakhsCompact(inspectedTeam.startingPurse - inspectedTeam.purse)} · Remaining {formatLakhsCompact(inspectedTeam.purse)}
                  </div>
                </div>

                {inspectedTeam.squad.length === 0 ? (
                  <p className="text-xs text-[#CFEAE0]/60">No players signed yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {inspectedTeam.squad.map((item) => (
                      <div
                        key={item.player.id}
                        tabIndex={0}
                        onMouseEnter={(e) => showPlayerStats(item.player, e.currentTarget)}
                        onMouseLeave={hidePlayerStats}
                        onFocus={(e) => showPlayerStats(item.player, e.currentTarget)}
                        onBlur={hidePlayerStats}
                        className="flex items-center justify-between rounded-lg border border-[#5B91A3]/25 bg-[#2F4A63]/55 px-3 py-2 text-xs cursor-help hover:border-[#5B91A3]/65 focus:outline-none focus:ring-2 focus:ring-[#5B91A3]"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[#CFEAE0]">{item.player.name}</div>
                          <div className="text-[#CFEAE0]/75">
                            {item.player.role} · {item.player.isOverseas ? 'OS' : 'IND'}
                          </div>
                        </div>
                        <span className="ml-2 font-mono-num font-bold text-[#CFEAE0] shrink-0">
                          {formatLakhs(item.soldPrice)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT RAIL: AUCTIONEER DESK, BID HISTORY, LOG & UNSOLD POOL (4 cols) */}
        <aside className="lg:col-span-4 space-y-5">
          {isHost && (
            <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-[#CFEAE0]">Auctioneer Controls</h2>
                <span className="text-xs text-[#CFEAE0]/70">Host</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {state.phase === 'LIVE' ? (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:pause' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-3 py-2 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
                  >
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    Pause Clock
                  </button>
                ) : state.phase === 'PAUSED' ? (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:resume' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#5B91A3] px-3 py-2 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume Clock
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:next_lot' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#5B91A3] px-3 py-2 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
                  >
                    <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
                    Next Player
                  </button>
                )}

                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={!lot}
                    onClick={() => onSend({ type: 'auction:extend_timer', extraSeconds: 5 })}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-2 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    +5s
                  </button>
                  <button
                    type="button"
                    disabled={!lot}
                    onClick={() => onSend({ type: 'auction:extend_timer', extraSeconds: 10 })}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-2 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    +10s
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!lot || !lot.leadingTeamId}
                  onClick={() => onSend({ type: 'auction:hammer_now' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-400/45 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-950/65 disabled:opacity-40 whitespace-nowrap"
                >
                  <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                  Hammer Sold
                </button>

                <button
                  type="button"
                  disabled={!lot}
                  onClick={() => onSend({ type: 'auction:skip_lot' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] disabled:opacity-40 whitespace-nowrap"
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                  Skip / Unsold
                </button>

                <button
                  type="button"
                  disabled={!lot || lot.bidHistory.length === 0}
                  onClick={() => onSend({ type: 'auction:undo_bid' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] disabled:opacity-40 whitespace-nowrap"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Undo Last Bid
                </button>

                {!confirmEnd ? (
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-400/45 bg-rose-950/35 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-950/60 whitespace-nowrap"
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    End Auction
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmEnd(false);
                      onSend({ type: 'auction:end_early' });
                    }}
                    onMouseLeave={() => setConfirmEnd(false)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-500 whitespace-nowrap"
                  >
                    Confirm Finish?
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tabbed Live Feed */}
          <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] overflow-hidden shadow-xl">
            <div className="grid grid-cols-4 border-b border-[#5B91A3]/30 bg-[#131B2B] p-1 gap-1">
              {(
                [
                  ['bids', `Bids (${lot?.bidHistory.length ?? 0})`],
                  ['events', 'Event Log'],
                  ['unsold', `Unsold (${state.unsoldPool.length})`],
                  ['queue', `Queue (${state.playerQueue.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDeskTab(key)}
                  className={`rounded-lg py-2 px-1.5 text-[11px] font-bold transition-colors truncate ${
                    deskTab === key
                      ? 'bg-[#5B91A3] text-[#131B2B]'
                      : 'text-[#CFEAE0]/75 hover:text-[#CFEAE0]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-[420px] overflow-y-auto p-4 space-y-2">
              {deskTab === 'bids' && (
                <>
                  {!lot || lot.bidHistory.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#CFEAE0]/60">
                      No bids placed yet on this lot.
                    </div>
                  ) : (
                    lot.bidHistory.map((b, idx) => (
                      <div
                        key={b.id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                          idx === 0
                            ? 'border-[#CFEAE0]/60 bg-[#131B2B]'
                            : 'border-[#5B91A3]/25 bg-[#131B2B]/75'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <TeamCrest shortCode={b.teamShortCode} color={b.teamColor} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-bold text-[#CFEAE0]">
                              {b.teamName} {b.isBot ? '(AI)' : ''}
                            </div>
                            <div className="text-[10px] text-[#CFEAE0]/65">
                              {new Date(b.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              {b.botReason ? ` · ${b.botReason}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="font-mono-num font-bold text-[#5B91A3] shrink-0">
                          {formatLakhsCompact(b.amount)}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {deskTab === 'events' && (
                <>
                  {state.eventLog.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#CFEAE0]/60">No events logged yet.</div>
                  ) : (
                    state.eventLog.map((evt) => (
                      <div
                        key={evt.id}
                        className="rounded-lg border border-[#5B91A3]/20 bg-[#131B2B] px-3 py-2 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between text-[10px] text-[#CFEAE0]/55">
                          <span className="uppercase tracking-wider">{evt.type}</span>
                          <span className="font-mono-num">
                            {new Date(evt.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className={`leading-relaxed ${
                            evt.type === 'sold'
                              ? 'text-emerald-300 font-medium'
                              : evt.type === 'unsold'
                                ? 'text-[#CFEAE0]/65'
                                : 'text-[#CFEAE0]/90'
                          }`}
                        >
                          {evt.message}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {deskTab === 'unsold' && (
                <>
                  {state.unsoldPool.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#CFEAE0]/60">
                      No unsold players yet.
                    </div>
                  ) : (
                    state.unsoldPool.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#5B91A3]/25 bg-[#131B2B] px-3 py-2 text-xs hover:border-[#5B91A3]/65"
                      >
                        <div
                          tabIndex={0}
                          onMouseEnter={(e) => showPlayerStats(p, e.currentTarget)}
                          onMouseLeave={hidePlayerStats}
                          onFocus={(e) => showPlayerStats(p, e.currentTarget)}
                          onBlur={hidePlayerStats}
                          className="min-w-0 flex-1 cursor-help rounded focus:outline-none focus:ring-2 focus:ring-[#5B91A3]"
                        >
                          <div className="truncate font-semibold text-[#CFEAE0]">{p.name}</div>
                          <div className="text-[#CFEAE0]/70">
                            {p.role} · {p.nationality} · Base {formatLakhs(p.basePrice)}
                          </div>
                        </div>
                        {isHost && (
                          <button
                            type="button"
                            onClick={() => onSend({ type: 'auction:reauction_player', playerId: p.id })}
                            className="inline-flex items-center gap-1 rounded-md bg-[#5B91A3] px-2.5 py-1 text-[11px] font-bold text-[#131B2B] hover:bg-[#70A7B9] shrink-0"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                            Re-Auction
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </>
              )}

              {deskTab === 'queue' && (
                <>
                  {state.playerQueue.length === 0 ? (
                    <div className="py-8 text-center text-xs text-[#CFEAE0]/60">
                      Queue is empty.
                    </div>
                  ) : (
                    <>
                      {(showAllQueue ? state.playerQueue : state.playerQueue.slice(0, 40)).map((p, idx) => (
                        <div
                          key={p.id}
                          tabIndex={0}
                          onMouseEnter={(e) => showPlayerStats(p, e.currentTarget)}
                          onMouseLeave={hidePlayerStats}
                          onFocus={(e) => showPlayerStats(p, e.currentTarget)}
                          onBlur={hidePlayerStats}
                          className="flex items-center justify-between rounded-lg border border-[#5B91A3]/25 bg-[#131B2B] px-3 py-2 text-xs cursor-help hover:border-[#5B91A3]/65 focus:outline-none focus:ring-2 focus:ring-[#5B91A3]"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[#CFEAE0]">
                              {idx + 1}. {p.name}
                            </div>
                            <div className="text-[#CFEAE0]/70">
                              {p.set} · {p.role} · {p.nationality}
                            </div>
                          </div>
                          <span className="font-mono-num text-[#5B91A3] font-bold shrink-0">
                            {formatLakhs(p.basePrice)}
                          </span>
                        </div>
                      ))}
                      {!showAllQueue && state.playerQueue.length > 40 && (
                        <button
                          type="button"
                          onClick={() => setShowAllQueue(true)}
                          className="w-full rounded-lg border border-[#5B91A3]/45 bg-[#131B2B] py-2 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D]"
                        >
                          Show All {state.playerQueue.length} Queued Players
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
