import { useState } from 'react';
import { Check, Copy, Link2, Play, ShieldCheck, Users } from 'lucide-react';
import { playClickSound, playSeatClaimSound, unlockAudio } from '../client/audio.ts';
import { formatLakhs, type AuctionRoomState, type ClientMessage } from '../shared/types.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface LobbyRoomProps {
  state: AuctionRoomState;
  clientId: string;
  muted: boolean;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
}

export function LobbyRoom({ state, clientId, muted, onSend, onLeave }: LobbyRoomProps) {
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

  const inviteUrl = `${window.location.origin}/join?room=${state.roomCode}`;

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Room Header Card */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 shadow-xl">
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-[#CFEAE0]/85 uppercase tracking-wider">
            Pre-Auction Lobby ·{' '}
            {isOnline
              ? 'Online Multiplayer'
              : state.config.mode === 'local'
                ? 'Shared-Screen Local'
                : 'Solo vs. AI Bots'}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-extrabold text-[#CFEAE0]">
              Room <span className="font-mono-num text-white tracking-widest">{state.roomCode}</span>
            </h1>
            <button
              type="button"
              onClick={() => copyText(state.roomCode, 'code')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#5B91A3]/50 bg-[#131B2B] px-3 py-1.5 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? 'Copied Code' : 'Copy Code'}
            </button>
            <button
              type="button"
              onClick={() => copyText(inviteUrl, 'link')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#5B91A3]/50 bg-[#131B2B] px-3 py-1.5 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
            >
              {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Link2 className="h-3.5 w-3.5" />}
              {copiedLink ? 'Copied Link' : 'Copy Invite Link'}
            </button>
          </div>
          <p className="text-sm text-[#CFEAE0]/80">
            {state.playerQueue.length} players queued · {formatLakhs(state.config.startingPurse)} purse ·{' '}
            {state.config.minSquadSize}–{state.config.maxSquadSize} squad · Max {state.config.maxOverseas} overseas ·{' '}
            {state.config.timerSeconds}s clock
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!isHost && me && (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                playSeatClaimSound(muted);
                onSend({ type: 'room:toggle_ready', ready: !me.isReady });
              }}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors whitespace-nowrap shrink-0 ${
                me.isReady
                  ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                  : 'border-[#5B91A3]/50 bg-[#131B2B] text-[#CFEAE0] hover:bg-[#1B293D]'
              }`}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {me.isReady ? 'Ready' : 'Mark Ready'}
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-xl border border-[#CFEAE0]/25 bg-[#131B2B]/60 px-4 py-2.5 text-sm font-semibold text-[#CFEAE0]/85 hover:bg-[#131B2B] whitespace-nowrap shrink-0"
          >
            Leave Room
          </button>
          {isHost && (
            <button
              type="button"
              onClick={() => {
                unlockAudio();
                onSend({ type: 'auction:start' });
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-2.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              Start Live Auction
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Franchises + Participants & Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 space-y-4 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-[#CFEAE0]">
                Franchise Seats ({state.teams.length})
              </h2>
              <p className="text-xs text-[#CFEAE0]/80 mt-0.5">
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
                className="rounded-xl bg-[#5B91A3] px-3.5 py-2 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
              >
                Fill Open Seats with AI Bots
              </button>
            )}
          </div>

          {needsClaimInOnline && (
            <div
              role="status"
              className="rounded-xl border border-[#CFEAE0]/45 bg-[#131B2B] px-4 py-3 text-xs text-[#CFEAE0]"
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
                      ? 'border-[#CFEAE0] bg-[#131B2B]'
                      : 'border-[#5B91A3]/30 bg-[#131B2B]/80'
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
                            className="w-full rounded border border-[#5B91A3] bg-[#2F4A63] px-2 py-1 text-xs font-semibold text-[#CFEAE0] focus:outline-none"
                          />
                        </form>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate text-sm font-bold text-[#CFEAE0]">{team.name}</span>
                          {canEditName && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTeamId(team.id);
                                setEditingName(team.name);
                              }}
                              className="text-[11px] text-[#5B91A3] hover:text-[#CFEAE0] shrink-0"
                            >
                              Rename
                            </button>
                          )}
                        </div>
                      )}
                      <div className="text-xs text-[#CFEAE0]/70 truncate">
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
                        onClick={() => {
                          unlockAudio();
                          playClickSound(muted);
                          onSend({ type: 'room:claim_team', teamId: null });
                        }}
                        className="rounded-lg border border-[#5B91A3]/55 bg-[#2F4A63] px-3 py-1.5 text-xs font-bold text-[#CFEAE0] hover:bg-[#5B91A3] hover:text-[#131B2B] whitespace-nowrap"
                      >
                        Release
                      </button>
                    )}
                    {canClaim && (
                      <button
                        type="button"
                        onClick={() => {
                          unlockAudio();
                          playSeatClaimSound(muted);
                          onSend({ type: 'room:claim_team', teamId: team.id });
                        }}
                        className="rounded-lg bg-[#5B91A3] px-3 py-1.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
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
                        className="rounded-lg border border-[#5B91A3]/35 bg-[#2F4A63]/65 px-2.5 py-1.5 text-xs font-semibold text-[#CFEAE0] hover:bg-[#2F4A63] whitespace-nowrap"
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
          <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#CFEAE0]">Connected Managers</h2>
              <Users className="h-4 w-4 text-[#CFEAE0]/75" aria-hidden="true" />
            </div>
            <ul className="divide-y divide-[#5B91A3]/25 text-sm">
              {state.participants.map((p) => {
                const ownedTeam = state.teams.find((t) => t.id === p.teamId);
                return (
                  <li key={p.clientId} className="flex items-center justify-between py-2.5">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#CFEAE0] truncate">
                        {p.name} {p.clientId === clientId ? '(You)' : ''}
                      </div>
                      <div className="text-xs text-[#CFEAE0]/70">
                        {p.isHost ? 'Host & Auctioneer' : 'Franchise Manager'}
                        {ownedTeam ? ` · ${ownedTeam.shortCode}` : ''}
                      </div>
                    </div>
                    <span className={`text-xs font-bold ${p.connected ? 'text-emerald-300' : 'text-amber-300'}`}>
                      {p.connected ? (p.isReady || p.isHost ? 'Ready' : 'In Lobby') : 'Reconnecting'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 space-y-2.5 text-xs text-[#CFEAE0]/85 shadow-xl">
            <div className="font-display text-lg font-bold text-[#CFEAE0]">Active Auction Rules</div>
            <div className="flex justify-between py-1 border-b border-[#5B91A3]/25">
              <span className="text-[#CFEAE0]/70">Starting Purse</span>
              <span className="font-mono-num font-bold text-[#CFEAE0]">{formatLakhs(state.config.startingPurse)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#5B91A3]/25">
              <span className="text-[#CFEAE0]/70">Squad Size</span>
              <span className="font-mono-num font-bold text-[#CFEAE0]">{state.config.minSquadSize}–{state.config.maxSquadSize} players</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#5B91A3]/25">
              <span className="text-[#CFEAE0]/70">Overseas Limit</span>
              <span className="font-mono-num font-bold text-[#CFEAE0]">Max {state.config.maxOverseas}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#5B91A3]/25">
              <span className="text-[#CFEAE0]/70">Role Targets (Min)</span>
              <span className="font-mono-num font-bold text-[#CFEAE0]">
                {state.config.roleRequirements.Batter} BAT · {state.config.roleRequirements.Bowler} BWL · {state.config.roleRequirements['All-Rounder']} AR · {state.config.roleRequirements.Wicketkeeper} WK
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#CFEAE0]/70">Lot Clock / Anti-Snipe</span>
              <span className="font-mono-num font-bold text-[#CFEAE0]">{state.config.timerSeconds}s / +{state.config.antiSnipeSeconds}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
