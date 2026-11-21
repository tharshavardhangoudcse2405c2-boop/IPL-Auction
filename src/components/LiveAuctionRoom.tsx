import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  FastForward,
  Gavel,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Undo2,
  XCircle,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  playBidSound,
  playSoldSound,
  playTickSound,
  playUnsoldSound,
} from '../client/audio.ts';
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
  type Team,
} from '../shared/types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';
import { TeamCrest } from './TeamCrest.tsx';

interface LiveAuctionRoomProps {
  state: AuctionRoomState;
  clientId: string;
  clockOffsetMs: number;
  muted: boolean;
  reducedMotion: boolean;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
}

type DeskTab = 'bids' | 'events' | 'unsold' | 'queue';

export function LiveAuctionRoom({
  state,
  clientId,
  clockOffsetMs,
  muted,
  reducedMotion,
  onSend,
  onLeave,
}: LiveAuctionRoomProps) {
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs);
  const [deskTab, setDeskTab] = useState<DeskTab>('bids');
  const [inspectedTeamId, setInspectedTeamId] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingBidKey, setPendingBidKey] = useState<string | null>(null);
  const [showAllQueue, setShowAllQueue] = useState(false);

  const prevBidIdRef = useRef<string | null>(null);
  const prevOutcomeTsRef = useRef<number | null>(null);
  const lastTickSecRef = useRef<number | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const me = state.participants.find((p) => p.clientId === clientId);
  const isHost = Boolean(me?.isHost);
  const lot = state.currentLot;
  const outcome = state.lastOutcome;

  // Smooth 100ms timer loop synced with server clock
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

  // Sound cues for bids, final countdown ticks, and sold/unsold gavel
  useEffect(() => {
    const latestBid = lot?.bidHistory[0] ?? null;
    if (latestBid && latestBid.id !== prevBidIdRef.current) {
      prevBidIdRef.current = latestBid.id;
      playBidSound(muted, !latestBid.isBot);
    }
  }, [lot?.bidHistory, muted]);

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
  }, [state.phase, outcome, muted]);

  const leadingTeam = lot?.leadingTeamId
    ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null
    : null;

  const nextBid = lot ? getNextValidBid(lot) : 0;
  const currentIncrement = lot && lot.currentBid > 0 ? getBidIncrement(lot.currentBid) : 0;

  // Clear pending bid lock whenever lot bid/leader/phase updates
  useEffect(() => {
    setPendingBidKey(null);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
  }, [lot?.lotNumber, lot?.currentBid, lot?.leadingTeamId, state.phase]);

  // Determine which teams this client can actively bid for
  const biddableHumanTeams: Team[] = useMemo(() => {
    if (state.config.mode === 'local') {
      return state.teams.filter(
        (t) => t.controlType === 'human' && (isHost || t.ownerClientId === clientId),
      );
    }
    if (state.config.mode === 'solo') {
      return state.teams.filter((t) => t.controlType === 'human' && t.ownerClientId === clientId);
    }
    // Online mode: strictly the single franchise claimed by this participant
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

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6 space-y-5">
      {/* Top Broadcast Context Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#111827] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-display text-lg font-bold tracking-wide text-white">
            Room <span className="font-mono-num text-amber-400">{state.roomCode}</span>
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-300">
            {lot ? `Lot #${lot.lotNumber} of ${lot.totalLots}` : `Completed ${state.soldHistory.length + state.unsoldPool.length} Lots`}
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span className="text-slate-300">
            {lot ? `Set: ${lot.player.set}` : 'Lot Transition'}
          </span>
          <span className="text-slate-600" aria-hidden="true">·</span>
          <span
            className={`font-semibold ${
              state.phase === 'LIVE'
                ? 'text-emerald-400'
                : state.phase === 'PAUSED'
                  ? 'text-amber-400'
                  : 'text-sky-300'
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

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span>
            Sold: <strong className="font-mono-num text-white">{state.soldHistory.length}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Unsold: <strong className="font-mono-num text-white">{state.unsoldPool.length}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Queued: <strong className="font-mono-num text-white">{state.playerQueue.length}</strong>
          </span>
          <button
            type="button"
            onClick={onLeave}
            className="ml-2 rounded-md border border-white/15 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-white/5 whitespace-nowrap"
          >
            Exit Room
          </button>
        </div>
      </div>

      {/* Main 12-Column Broadcast Arena */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT / CENTER STAGE (8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          {/* Active Lot Stage OR Sold/Unsold Outcome Stage */}
          {lot ? (
            <div className="rounded-2xl border border-white/10 bg-[#111827] p-5 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <PlayerAvatar player={lot.player} size="hero" />

                <div className="min-w-0 flex-1 space-y-4 w-full">
                  <div>
                    <div className="text-xs font-medium tracking-wider text-amber-400 uppercase">
                      {lot.player.set} Set · {lot.player.specialty}
                    </div>
                    <h1 className="mt-1 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
                      {lot.player.name}
                    </h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                      <span className="font-semibold text-white">{lot.player.role}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-amber-300 font-medium">{lot.player.tacticalRole}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span>
                        {lot.player.nationality}
                        {lot.player.isOverseas ? ' (Overseas)' : ' (Domestic)'}
                      </span>
                      {lot.player.age !== null && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-mono-num">Age {lot.player.age}</span>
                        </>
                      )}
                      {lot.player.battingStyle !== '—' && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span>{lot.player.battingStyle}</span>
                        </>
                      )}
                      {lot.player.bowlingStyle !== '—' && (
                        <>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span>{lot.player.bowlingStyle}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* T20 Stats Grid */}
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 rounded-xl border border-white/10 bg-[#090D16] p-3">
                    <div>
                      <div className="text-[11px] text-slate-400">IPL Matches</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.matches !== null ? lot.player.stats.matches : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Runs</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.runs !== null ? lot.player.stats.runs : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Strike Rate</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.strikeRate !== null ? lot.player.stats.strikeRate.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Average</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.average !== null ? lot.player.stats.average.toFixed(1) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Wickets</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.wickets !== null ? lot.player.stats.wickets : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Economy</div>
                      <div className="font-mono-num text-base font-bold text-white">
                        {lot.player.stats.economy !== null && lot.player.stats.economy > 0
                          ? lot.player.stats.economy.toFixed(2)
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {/* Live Bid & Countdown Readout */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-white/10 bg-[#090D16] p-4">
                    <div>
                      <div className="text-xs text-slate-400">Base Price</div>
                      <div className="mt-1 font-mono-num text-lg font-bold text-slate-200">
                        {formatLakhs(lot.player.basePrice)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-400">
                        {lot.currentBid > 0 ? 'Current Highest Bid' : 'Opening Ask'}
                      </div>
                      <div className="mt-1 font-mono-num text-2xl font-bold text-amber-400">
                        {lot.currentBid > 0 ? formatLakhsCompact(lot.currentBid) : formatLakhs(lot.player.basePrice)}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-400">Leading Franchise</div>
                      {leadingTeam ? (
                        <div className="mt-1 flex items-center gap-2 min-w-0">
                          <TeamCrest shortCode={leadingTeam.shortCode} color={leadingTeam.color} size="sm" />
                          <span className="truncate text-sm font-bold text-white">{leadingTeam.name}</span>
                        </div>
                      ) : (
                        <div className="mt-1 text-sm font-medium text-slate-400">Awaiting first bid</div>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {state.phase === 'PAUSED' ? 'Paused' : 'Synced Clock'}
                        </span>
                        {currentIncrement > 0 && (
                          <span className="font-mono-num text-slate-300">+{formatLakhs(currentIncrement)}</span>
                        )}
                      </div>
                      <div
                        className={`mt-1 font-mono-num text-2xl sm:text-3xl font-extrabold tracking-tight ${
                          state.phase === 'PAUSED'
                            ? 'text-amber-300'
                            : remainingSec <= 3
                              ? 'text-rose-400'
                              : remainingSec <= 5
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                        }`}
                      >
                        00:{String(remainingSec).padStart(2, '0')}
                      </div>
                    </div>
                  </div>

                  {state.phase === 'PAUSED' && (
                    <div className="rounded-lg border border-amber-400/40 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200">
                      Clock paused by the auctioneer — bidding is temporarily held across all connected devices.
                    </div>
                  )}

                  {/* Timer Progress Bar */}
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10" aria-label="Auction countdown bar">
                    <div
                      className={`h-full transition-all duration-100 ${
                        state.phase === 'PAUSED'
                          ? 'bg-amber-400'
                          : remainingSec <= 3
                            ? 'bg-rose-500'
                            : remainingSec <= 5
                              ? 'bg-amber-400'
                              : 'bg-emerald-500'
                      }`}
                      style={{ width: `${timerPct}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* ALWAYS-VISIBLE BIDDING DECK */}
              <div className="border-t border-white/10 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-white">
                    {state.config.mode === 'local'
                      ? 'Shared Bidding Deck — Every Franchise Bids Openly'
                      : 'Your Franchise Bidding Console'}
                  </div>
                  <div className="text-xs text-slate-400">
                    Next valid bid: <span className="font-mono-num font-bold text-amber-300">{formatLakhsCompact(nextBid)}</span>
                    {' · '}
                    No pass button required
                  </div>
                </div>

                {biddableHumanTeams.length === 0 ? (
                  <div className="rounded-xl border border-amber-400/30 bg-[#090D16] p-4 text-sm text-amber-100">
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
                              ? 'border-emerald-500/60 bg-emerald-500/10'
                              : 'border-white/10 bg-[#090D16]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <TeamCrest shortCode={team.shortCode} color={team.color} size="md" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-white">{team.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono-num">
                                <span className="text-amber-300 font-semibold">{formatLakhsCompact(team.purse)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{team.squad.length}/{state.config.maxSquadSize}</span>
                                <span aria-hidden="true">·</span>
                                <span>OS {overseas}/{state.config.maxOverseas}</span>
                              </div>
                              {biddableHumanTeams.length === 1 && (
                                <div className="mt-1 text-[11px] text-slate-400 font-mono-num">
                                  BAT {roles.Batter} · BWL {roles.Bowler} · AR {roles['All-Rounder']} · WK {roles.Wicketkeeper} · Max Legal Bid {formatLakhsCompact(getMaxAffordableBid(team, state.config))}
                                </div>
                              )}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={!elig.canBid || isSubmitting}
                            onClick={() => handlePlaceBid(team.id, elig.nextBid)}
                            className={`rounded-lg px-4 py-2.5 text-sm font-bold transition-transform active:scale-[0.98] whitespace-nowrap shrink-0 min-h-[44px] ${
                              elig.canBid && !isSubmitting
                                ? 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm'
                                : isLeading
                                  ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-300 cursor-default'
                                  : 'border border-white/10 bg-white/5 text-slate-400 cursor-not-allowed'
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
            /* SOLD / UNSOLD REVEAL CARD */
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className={`rounded-2xl border p-6 sm:p-8 text-center space-y-5 ${
                outcome.status === 'SOLD'
                  ? 'border-emerald-500/40 bg-emerald-950/30'
                  : 'border-slate-600/40 bg-[#111827]'
              }`}
            >
              <div className="flex flex-col items-center gap-4">
                <PlayerAvatar player={outcome.player} size="md" />
                <div className="space-y-1">
                  <div
                    className={`inline-flex items-center gap-2 font-display text-4xl sm:text-5xl font-extrabold tracking-wider uppercase ${
                      outcome.status === 'SOLD' ? 'text-emerald-400' : 'text-slate-300'
                    }`}
                  >
                    <Gavel className="h-8 w-8" aria-hidden="true" />
                    {outcome.status === 'SOLD' ? 'SOLD!' : 'UNSOLD'}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                    {outcome.player.name}
                  </h2>
                  <p className="text-sm text-slate-300">
                    {outcome.player.role} · {outcome.player.nationality} · Base {formatLakhs(outcome.player.basePrice)}
                  </p>
                </div>

                {outcome.status === 'SOLD' && outcome.winningTeamName && (
                  <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-emerald-500/30 bg-[#090D16] px-5 py-3">
                    <TeamCrest
                      shortCode={outcome.winningTeamShortCode || 'TEAM'}
                      color={outcome.winningTeamColor || '#10B981'}
                      size="md"
                    />
                    <div className="text-left">
                      <div className="text-xs text-slate-400">Acquired by {outcome.winningTeamName}</div>
                      <div className="font-mono-num text-xl font-bold text-amber-400">
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
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-400/50 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/25 whitespace-nowrap"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Re-Auction Immediately
                    </button>
                  )}
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => onSend({ type: 'auction:next_lot' })}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
                    >
                      <FastForward className="h-4 w-4" aria-hidden="true" />
                      Next Player Now
                    </button>
                  )}
                  {!isHost && (
                    <div className="text-xs text-slate-400">Advancing to next lot shortly...</div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : null}

          {/* FRANCHISE SQUAD & PURSE MATRIX */}
          <div className="rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-bold text-white">
                Franchise Purses & Squad Balance ({state.teams.length} Teams)
              </h2>
              <span className="text-xs text-slate-400">
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
                        ? 'border-emerald-500/60 bg-emerald-500/10'
                        : isSelected
                          ? 'border-amber-400/60 bg-white/[0.05]'
                          : 'border-white/10 bg-[#090D16] hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TeamCrest shortCode={team.shortCode} color={team.color} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">
                            {team.name}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {team.controlType === 'bot' ? 'AI Bot' : team.ownerName || 'Human'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono-num text-sm font-bold text-amber-400">
                          {formatLakhsCompact(team.purse)}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-400">
                          {team.squad.length}/{state.config.maxSquadSize} · OS {overseas}/{state.config.maxOverseas}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] font-mono-num text-slate-400 border-t border-white/5 pt-1.5">
                      <span>BAT {roles.Batter}</span>
                      <span>BWL {roles.Bowler}</span>
                      <span>AR {roles['All-Rounder']}</span>
                      <span>WK {roles.Wicketkeeper}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected Franchise Roster Drawer */}
            {inspectedTeam && (
              <div className="rounded-xl border border-white/10 bg-[#090D16] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <TeamCrest shortCode={inspectedTeam.shortCode} color={inspectedTeam.color} size="sm" />
                    <span className="font-semibold text-white">{inspectedTeam.name} Squad</span>
                    <span className="text-xs text-slate-400 font-mono-num">
                      ({inspectedTeam.squad.length} signed · {Math.max(0, state.config.minSquadSize - inspectedTeam.squad.length)} needed for min {state.config.minSquadSize})
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 font-mono-num">
                    Spent {formatLakhsCompact(inspectedTeam.startingPurse - inspectedTeam.purse)} · Remaining {formatLakhsCompact(inspectedTeam.purse)}
                  </div>
                </div>

                {inspectedTeam.squad.length === 0 ? (
                  <p className="text-xs text-slate-500">No players signed yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {inspectedTeam.squad.map((item) => (
                      <div
                        key={item.player.id}
                        className="flex items-center justify-between rounded-lg border border-white/10 bg-[#111827] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{item.player.name}</div>
                          <div className="text-slate-400">
                            {item.player.role} · {item.player.isOverseas ? 'OS' : 'IND'}
                          </div>
                        </div>
                        <span className="ml-2 font-mono-num font-bold text-amber-400 shrink-0">
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
            <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-bold text-white">Auctioneer Controls</h2>
                <span className="text-xs text-slate-400">Host</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {state.phase === 'LIVE' ? (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:pause' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 whitespace-nowrap"
                  >
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    Pause Clock
                  </button>
                ) : state.phase === 'PAUSED' ? (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:resume' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Resume Clock
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'auction:next_lot' })}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
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
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    +5s
                  </button>
                  <button
                    type="button"
                    disabled={!lot}
                    onClick={() => onSend({ type: 'auction:extend_timer', extraSeconds: 10 })}
                    className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    +10s
                  </button>
                </div>

                <button
                  type="button"
                  disabled={!lot || !lot.leadingTeamId}
                  onClick={() => onSend({ type: 'auction:hammer_now' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 whitespace-nowrap"
                >
                  <Gavel className="h-3.5 w-3.5" aria-hidden="true" />
                  Hammer Sold
                </button>

                <button
                  type="button"
                  disabled={!lot}
                  onClick={() => onSend({ type: 'auction:skip_lot' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                  Skip / Unsold
                </button>

                <button
                  type="button"
                  disabled={!lot || lot.bidHistory.length === 0}
                  onClick={() => onSend({ type: 'auction:undo_bid' })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-40 whitespace-nowrap"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Undo Last Bid
                </button>

                {!confirmEnd ? (
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 whitespace-nowrap"
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
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-500 whitespace-nowrap"
                  >
                    Confirm Finish?
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tabbed Live Feed: Bids / Log / Unsold / Queue */}
          <div className="rounded-2xl border border-white/10 bg-[#111827] overflow-hidden">
            <div className="grid grid-cols-4 border-b border-white/10 bg-[#090D16] p-1 gap-1">
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
                  className={`rounded-md py-2 px-1.5 text-[11px] font-semibold transition-colors truncate ${
                    deskTab === key
                      ? 'bg-[#1F2937] text-white'
                      : 'text-slate-400 hover:text-slate-200'
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
                    <div className="py-8 text-center text-xs text-slate-500">
                      No bids placed yet on this lot.
                    </div>
                  ) : (
                    lot.bidHistory.map((b, idx) => (
                      <div
                        key={b.id}
                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                          idx === 0
                            ? 'border-amber-400/40 bg-amber-500/10'
                            : 'border-white/10 bg-[#090D16]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <TeamCrest shortCode={b.teamShortCode} color={b.teamColor} size="sm" />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-white">
                              {b.teamName} {b.isBot ? '(AI)' : ''}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(b.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              {b.botReason ? ` · ${b.botReason}` : ''}
                            </div>
                          </div>
                        </div>
                        <div className="font-mono-num font-bold text-amber-400 shrink-0">
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
                    <div className="py-8 text-center text-xs text-slate-500">No events logged yet.</div>
                  ) : (
                    state.eventLog.map((evt) => (
                      <div
                        key={evt.id}
                        className="rounded-lg border border-white/5 bg-[#090D16] px-3 py-2 text-xs space-y-0.5"
                      >
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
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
                                ? 'text-slate-400'
                                : 'text-slate-200'
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
                    <div className="py-8 text-center text-xs text-slate-500">
                      No unsold players yet.
                    </div>
                  ) : (
                    state.unsoldPool.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#090D16] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-white">{p.name}</div>
                          <div className="text-slate-400">
                            {p.role} · {p.nationality} · Base {formatLakhs(p.basePrice)}
                          </div>
                        </div>
                        {isHost && (
                          <button
                            type="button"
                            onClick={() => onSend({ type: 'auction:reauction_player', playerId: p.id })}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25 shrink-0"
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
                    <div className="py-8 text-center text-xs text-slate-500">
                      Queue is empty.
                    </div>
                  ) : (
                    <>
                      {(showAllQueue ? state.playerQueue : state.playerQueue.slice(0, 40)).map((p, idx) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-lg border border-white/10 bg-[#090D16] px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-medium text-white">
                              {idx + 1}. {p.name}
                            </div>
                            <div className="text-slate-400">
                              {p.set} · {p.role} · {p.nationality}
                            </div>
                          </div>
                          <span className="font-mono-num text-slate-300 shrink-0">
                            {formatLakhs(p.basePrice)}
                          </span>
                        </div>
                      ))}
                      {!showAllQueue && state.playerQueue.length > 40 && (
                        <button
                          type="button"
                          onClick={() => setShowAllQueue(true)}
                          className="w-full rounded-lg border border-white/15 bg-white/5 py-2 text-xs font-semibold text-amber-300 hover:bg-white/10"
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
