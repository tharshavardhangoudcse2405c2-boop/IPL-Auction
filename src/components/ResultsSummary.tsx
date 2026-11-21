import { useState } from 'react';
import { Check, Copy, Download, RotateCcw, Settings2, Trophy } from 'lucide-react';
import {
  formatLakhs,
  formatLakhsCompact,
  getTeamOverseasCount,
  getTeamRoleCounts,
  type AuctionRoomState,
  type ClientMessage,
} from '../shared/types.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface ResultsSummaryProps {
  state: AuctionRoomState;
  clientId: string;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
}

export function ResultsSummary({ state, clientId, onSend, onLeave }: ResultsSummaryProps) {
  const [copiedSummary, setCopiedSummary] = useState(false);

  const me = state.participants.find((p) => p.clientId === clientId);
  const isHost = Boolean(me?.isHost);

  const topSignings = [...state.soldHistory]
    .sort((a, b) => b.soldPrice - a.soldPrice)
    .slice(0, 5);

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const rows = [
      ['Team', 'ShortCode', 'Control', 'Player', 'Role', 'Nationality', 'Overseas', 'Set', 'BasePriceLakhs', 'SoldPriceLakhs'],
    ];
    for (const team of state.teams) {
      for (const item of team.squad) {
        rows.push([
          `"${team.name.replace(/"/g, '""')}"`,
          team.shortCode,
          team.controlType,
          `"${item.player.name.replace(/"/g, '""')}"`,
          item.player.role,
          item.player.nationality,
          item.player.isOverseas ? 'Yes' : 'No',
          item.player.set,
          String(item.player.basePrice),
          String(item.soldPrice),
        ]);
      }
    }
    downloadBlob(rows.map((r) => r.join(',')).join('\n'), `creasehammer-auction-${state.roomCode}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportJson = () => {
    const payload = {
      roomCode: state.roomCode,
      exportedAt: new Date().toISOString(),
      config: state.config,
      teams: state.teams.map((t) => ({
        name: t.name,
        shortCode: t.shortCode,
        controlType: t.controlType,
        spentLakhs: t.startingPurse - t.purse,
        remainingPurseLakhs: t.purse,
        overseasCount: getTeamOverseasCount(t),
        roleBalance: getTeamRoleCounts(t),
        squad: t.squad.map((s) => ({
          name: s.player.name,
          role: s.player.role,
          nationality: s.player.nationality,
          isOverseas: s.player.isOverseas,
          soldPriceLakhs: s.soldPrice,
        })),
      })),
      unsoldPlayers: state.unsoldPool.map((p) => p.name),
    };
    downloadBlob(JSON.stringify(payload, null, 2), `creasehammer-auction-${state.roomCode}.json`, 'application/json');
  };

  const handleCopySummary = async () => {
    const lines: string[] = [
      `CreaseHammer Cricket Auction Results (Room ${state.roomCode})`,
      `Sold: ${state.soldHistory.length} | Unsold: ${state.unsoldPool.length}`,
      '',
    ];
    for (const t of state.teams) {
      const roles = getTeamRoleCounts(t);
      lines.push(
        `${t.name} (${t.shortCode}) — ${t.squad.length} players | Spent ${formatLakhsCompact(t.startingPurse - t.purse)} | Left ${formatLakhsCompact(t.purse)} | OS ${getTeamOverseasCount(t)}/${state.config.maxOverseas} | BAT ${roles.Batter} BWL ${roles.Bowler} AR ${roles['All-Rounder']} WK ${roles.Wicketkeeper}`,
      );
      for (const s of t.squad) {
        lines.push(`  - ${s.player.name} (${s.player.role}): ${formatLakhs(s.soldPrice)}`);
      }
      lines.push('');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2200);
    } catch {
      // Clipboard restricted
    }
  };

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {/* Results Hero Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider text-amber-400 uppercase">
            <Trophy className="h-4 w-4" aria-hidden="true" />
            Auction Concluded · Room {state.roomCode}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-white">
            Final Franchise Squads & Purse Ledger
          </h1>
          <p className="text-sm text-slate-400">
            {state.soldHistory.length} players sold across {state.teams.length} franchises · {state.unsoldPool.length} unsold
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 whitespace-nowrap"
          >
            {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSummary ? 'Copied Summary' : 'Copy Shareable Text'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export JSON
          </button>
          {isHost && (
            <>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: true })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Rematch (Same Rules)
              </button>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: false })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/15 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 whitespace-nowrap"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                New Setup
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-lg border border-white/15 px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 whitespace-nowrap"
          >
            Home
          </button>
        </div>
      </div>

      {/* Top Signings Strip */}
      {topSignings.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-3">
          <h2 className="font-display text-xl font-bold text-white">Highest Bids of the Auction</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topSignings.map((item, idx) => (
              <div
                key={item.player.id}
                className="rounded-xl border border-white/10 bg-[#090D16] p-3.5 space-y-1.5"
              >
                <div className="text-[11px] font-mono-num text-slate-400">#{idx + 1} Signing</div>
                <div className="truncate font-semibold text-white">{item.player.name}</div>
                <div className="text-xs text-slate-400">{item.player.role} · {item.player.nationality}</div>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono-num text-sm font-bold text-amber-400">
                    {formatLakhsCompact(item.soldPrice)}
                  </span>
                  <span className="font-mono-num text-xs font-semibold text-slate-300">
                    {item.winningTeamShortCode}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Franchise Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {state.teams.map((team) => {
          const spent = team.startingPurse - team.purse;
          const overseas = getTeamOverseasCount(team);
          const roles = getTeamRoleCounts(team);
          const meetsMinSize = team.squad.length >= state.config.minSquadSize;

          return (
            <div
              key={team.id}
              className="flex flex-col rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <TeamCrest shortCode={team.shortCode} color={team.color} size="lg" />
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-xl font-bold text-white">{team.name}</h3>
                    <div className="text-xs text-slate-400">
                      {team.controlType === 'bot' ? 'AI Managed' : team.ownerName || 'Human'} ·{' '}
                      <span className={meetsMinSize ? 'text-emerald-400' : 'text-amber-400'}>
                        {team.squad.length}/{state.config.maxSquadSize} Players
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial & Balance Metrics */}
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-white/10 bg-[#090D16] p-3 text-xs">
                <div>
                  <div className="text-slate-400">Spent</div>
                  <div className="font-mono-num font-bold text-white">{formatLakhsCompact(spent)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Purse Left</div>
                  <div className="font-mono-num font-bold text-amber-400">{formatLakhsCompact(team.purse)}</div>
                </div>
                <div>
                  <div className="text-slate-400">Overseas</div>
                  <div className="font-mono-num font-bold text-white">
                    {overseas}/{state.config.maxOverseas}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5 text-center text-[11px] font-mono-num">
                {(
                  [
                    ['BAT', roles.Batter, state.config.roleRequirements.Batter],
                    ['BWL', roles.Bowler, state.config.roleRequirements.Bowler],
                    ['AR', roles['All-Rounder'], state.config.roleRequirements['All-Rounder']],
                    ['WK', roles.Wicketkeeper, state.config.roleRequirements.Wicketkeeper],
                  ] as const
                ).map(([label, count, req]) => (
                  <div
                    key={label}
                    className={`rounded-md border px-2 py-1.5 ${
                      count >= req
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    {label} {count}/{req}
                  </div>
                ))}
              </div>

              {/* Squad List */}
              <div className="flex-1 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {team.squad.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">No players signed.</div>
                ) : (
                  team.squad.map((item) => (
                    <div
                      key={item.player.id}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-[#090D16] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-white">{item.player.name}</div>
                        <div className="text-slate-400">
                          {item.player.role} · {item.player.nationality}
                        </div>
                      </div>
                      <span className="ml-2 font-mono-num font-semibold text-amber-400 shrink-0">
                        {formatLakhs(item.soldPrice)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
