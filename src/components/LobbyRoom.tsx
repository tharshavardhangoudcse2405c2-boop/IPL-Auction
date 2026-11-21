import { useState } from 'react';
import { Check, Copy, Link2, Play, ShieldCheck, Users } from 'lucide-react';
import { formatLakhs, type AuctionRoomState, type ClientMessage } from '../shared/types.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface LobbyRoomProps {
  state: AuctionRoomState;
  clientId: string;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
}

export function LobbyRoom({ state, clientId, onSend, onLeave }: LobbyRoomProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const me = state.participants.find((p) => p.clientId === clientId);
  const isHost = Boolean(me?.isHost);
  const isOnline = state.config.mode === 'online';
  const hasUnclaimedHumanSeats = state.teams.some(
    (t) => t.controlType === 'human' && !t.ownerClientId,
  );
  const needsClaimInOnline = isOnline && !me?.teamId;

  const copyText = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'code') {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      } else {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      }
    } catch {
      // Fallback ignored if clipboard blocked
    }
  };

  const commitRename = (teamId: string) => {
    const trimmed = editingName.trim();
    if (trimmed) {
      onSend({ type: 'room:update_team', teamId, name: trimmed });
    }
    setEditingTeamId(null);
    setEditingName('');
  };

  const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${state.roomCode}`;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Room Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-white/10 bg-[#111827] p-6">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-amber-400 uppercase tracking-wider">
            Pre-Auction Lobby · {isOnline ? 'Online Multiplayer' : state.config.mode === 'local' ? 'Shared-Screen Local' : 'Solo vs. AI Bots'}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold text-white">
              Room <span className="font-mono-num text-amber-400 tracking-widest">{state.roomCode}</span>
            </h1>
            <button
              type="button"
              onClick={() => copyText(state.roomCode, 'code')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? 'Copied Code' : 'Copy Code'}
            </button>
            <button
              type="button"
              onClick={() => copyText(inviteUrl, 'link')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
              {copiedLink ? 'Copied Link' : 'Copy Invite Link'}
            </button>
          </div>
          <p className="text-sm text-slate-400">
            {state.playerQueue.length} players queued · {formatLakhs(state.config.startingPurse)} purse · {state.config.minSquadSize}–{state.config.maxSquadSize} squad · Max {state.config.maxOverseas} overseas · {state.config.timerSeconds}s clock
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isHost && me && (
            <button
              type="button"
              onClick={() => onSend({ type: 'room:toggle_ready', ready: !me.isReady })}
              className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                me.isReady
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10'
              }`}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {me.isReady ? 'Ready' : 'Mark Ready'}
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5 whitespace-nowrap shrink-0"
          >
            Leave Room
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => onSend({ type: 'auction:start' })}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              Start Live Auction
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Franchises + Participants & Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 rounded-2xl border border-white/10 bg-[#111827] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Franchise Seats ({state.teams.length})
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {isOnline
                  ? 'Each online manager claims one franchise. Unclaimed open seats will not bid unless assigned to AI bots.'
                  : state.config.mode === 'local'
                    ? 'Shared-screen local auction: all human franchises bid openly on one screen.'
                    : 'Solo franchise vs. AI-managed rivals.'}
              </p>
            </div>
            {isHost && isOnline && hasUnclaimedHumanSeats && (
              <button
                type="button"
                onClick={() => onSend({ type: 'room:fill_bots' })}
                className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 whitespace-nowrap"
              >
                Fill Open Seats with AI Bots
              </button>
            )}
          </div>

          {needsClaimInOnline && (
            <div
              role="status"
              className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100"
            >
              You have not claimed a franchise yet. Click <strong>Claim</strong> on any open human seat below to bid once the auction begins.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {state.teams.map((team) => {
              const isMine = team.ownerClientId === clientId && team.controlType === 'human';
              const canClaim = isOnline && team.controlType === 'human' && !team.ownerClientId;
              const canEditName = isHost || isMine;
              const isEditing = editingTeamId === team.id;

              return (
                <div
                  key={team.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 ${
                    isMine
                      ? 'border-amber-400/60 bg-amber-500/10'
                      : 'border-white/10 bg-[#090D16]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <TeamCrest shortCode={team.shortCode} color={team.color} size="md" />
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            commitRename(team.id);
                          }}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            type="text"
                            value={editingName}
                            maxLength={32}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={() => commitRename(team.id)}
                            autoFocus
                            className="w-full rounded border border-amber-400/50 bg-[#111827] px-2 py-1 text-xs font-semibold text-white focus:outline-none"
                          />
                        </form>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm font-semibold text-white">{team.name}</span>
                          {canEditName && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTeamId(team.id);
                                setEditingName(team.name);
                              }}
                              className="text-[11px] text-slate-400 hover:text-amber-300 shrink-0"
                            >
                              Rename
                            </button>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-slate-400 truncate">
                        {team.controlType === 'bot'
                          ? `AI Manager · ${state.config.botDifficulty}`
                          : team.ownerName
                            ? `${team.ownerName}${isMine ? ' (You)' : ''}${team.isReady ? ' · Ready' : ' · Waiting'}`
                            : 'Open seat'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {isOnline && isMine && (
                      <button
                        type="button"
                        onClick={() => onSend({ type: 'room:claim_team', teamId: null })}
                        className="rounded-md border border-amber-400/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 whitespace-nowrap"
                      >
                        Release
                      </button>
                    )}
                    {canClaim && (
                      <button
                        type="button"
                        onClick={() => onSend({ type: 'room:claim_team', teamId: team.id })}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 whitespace-nowrap"
                      >
                        Claim
                      </button>
                    )}
                    {isHost && (
                      <button
                        type="button"
                        onClick={() =>
                          onSend({
                            type: 'room:update_team',
                            teamId: team.id,
                            controlType: team.controlType === 'bot' ? 'human' : 'bot',
                          })
                        }
                        className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 whitespace-nowrap"
                      >
                        {team.controlType === 'bot' ? 'Make Human' : 'Set AI Bot'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-5">
          <div className="rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-white">Connected Managers</h2>
              <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <ul className="divide-y divide-white/10 text-sm">
              {state.participants.map((p) => {
                const ownedTeam = state.teams.find((t) => t.id === p.teamId);
                return (
                  <li key={p.clientId} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium text-white truncate">
                        {p.name} {p.clientId === clientId ? '(You)' : ''}
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.isHost ? 'Host & Auctioneer' : 'Franchise Manager'}
                        {ownedTeam ? ` · ${ownedTeam.shortCode}` : ''}
                      </div>
                    </div>
                    <span className={`text-xs font-medium ${p.connected ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {p.connected ? (p.isReady || p.isHost ? 'Ready' : 'In Lobby') : 'Reconnecting'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-2.5 text-xs text-slate-300">
            <div className="font-display text-lg font-bold text-white">Active Auction Rules</div>
            <div className="flex justify-between py-1 border-b border-white/10">
              <span className="text-slate-400">Starting Purse</span>
              <span className="font-mono-num text-white">{formatLakhs(state.config.startingPurse)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/10">
              <span className="text-slate-400">Squad Size</span>
              <span className="font-mono-num text-white">{state.config.minSquadSize}–{state.config.maxSquadSize} players</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/10">
              <span className="text-slate-400">Overseas Limit</span>
              <span className="font-mono-num text-white">Max {state.config.maxOverseas}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-white/10">
              <span className="text-slate-400">Role Targets (Min)</span>
              <span className="font-mono-num text-white">
                {state.config.roleRequirements.Batter} BAT · {state.config.roleRequirements.Bowler} BWL · {state.config.roleRequirements['All-Rounder']} AR · {state.config.roleRequirements.Wicketkeeper} WK
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Lot Clock / Anti-Snipe</span>
              <span className="font-mono-num text-white">{state.config.timerSeconds}s / +{state.config.antiSnipeSeconds}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
