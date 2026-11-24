import { useState } from 'react';
import { Check, Copy, Download, FileText, RotateCcw, Settings2, Sparkles, Trophy } from 'lucide-react';
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
  onViewWinner: () => void;
}

export function ResultsSummary({
  state,
  clientId,
  onSend,
  onLeave,
  onViewWinner,
}: ResultsSummaryProps) {
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
    downloadBlob(rows.map((r) => r.join(',')).join('\n'), `real-auction-26-${state.roomCode}.csv`, 'text/csv;charset=utf-8;');
  };

  const handleExportJson = () => {
    const payload = {
      app: 'Real Auction 26',
      roomCode: state.roomCode,
      exportedAt: new Date().toISOString(),
      config: state.config,
      winnerAnalysis: state.winnerAnalysis,
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
    downloadBlob(JSON.stringify(payload, null, 2), `real-auction-26-${state.roomCode}.json`, 'application/json');
  };

  const handleExportText = () => {
    const lines: string[] = [
      '========================================================================',
      `REAL AUCTION 26 — TEAM SQUAD DETAILS (ROOM ${state.roomCode})`,
      '========================================================================',
      `Exported: ${new Date().toLocaleString()}`,
      `Format: ${state.config.mode.toUpperCase()} | Teams: ${state.teams.length} | Starting Purse: ${formatLakhsCompact(state.config.startingPurse)}`,
      `Squad Limits: ${state.config.minSquadSize}-${state.config.maxSquadSize} Players | Max Overseas: ${state.config.maxOverseas}`,
      `Total Sold: ${state.soldHistory.length} | Unsold Pool: ${state.unsoldPool.length}`,
    ];

    if (state.winnerAnalysis) {
      lines.push(
        `AI Predicted Winner (Not a Guaranteed Result): ${state.winnerAnalysis.winnerTeamName} — Confidence: ${state.winnerAnalysis.confidenceLevel ?? 'Moderate'} (${state.winnerAnalysis.confidencePercent ?? 70}%)`,
      );
      if (state.winnerAnalysis.overallVerdict) {
        lines.push(`AI Summary: ${state.winnerAnalysis.overallVerdict}`);
      }
    }

    lines.push('');

    for (const team of state.teams) {
      const spent = team.startingPurse - team.purse;
      const overseas = getTeamOverseasCount(team);
      const roles = getTeamRoleCounts(team);
      const meetsMin = team.squad.length >= state.config.minSquadSize;

      lines.push('------------------------------------------------------------------------');
      lines.push(`${team.name} (${team.shortCode})`);
      lines.push(
        `Manager: ${team.controlType === 'bot' ? 'AI Managed' : team.ownerName || 'Human'} | Squad: ${team.squad.length}/${state.config.maxSquadSize} (${meetsMin ? 'Minimum Met' : `Below Min ${state.config.minSquadSize}`}) | Overseas: ${overseas}/${state.config.maxOverseas}`,
      );
      lines.push(
        `Budget: Starting ${formatLakhsCompact(team.startingPurse)} | Spent ${formatLakhsCompact(spent)} | Remaining ${formatLakhsCompact(team.purse)}`,
      );
      lines.push(
        `Roles: Batters ${roles.Batter} | Bowlers ${roles.Bowler} | All-Rounders ${roles['All-Rounder']} | Wicketkeepers ${roles.Wicketkeeper}`,
      );
      lines.push('');

      if (team.squad.length === 0) {
        lines.push('  (No players signed)');
      } else {
        team.squad.forEach((item, index) => {
          const idxStr = String(index + 1).padStart(2, ' ');
          const tag = item.player.isOverseas ? 'Overseas' : 'Domestic';
          lines.push(
            `  ${idxStr}. ${item.player.name} — ${item.player.role} (${item.player.tacticalRole}) | ${item.player.nationality} (${tag}) | Base: ${formatLakhs(item.player.basePrice)} | Sold: ${formatLakhs(item.soldPrice)}`,
          );
        });
      }
      lines.push('');
    }

    if (state.unsoldPool.length > 0) {
      lines.push('------------------------------------------------------------------------');
      lines.push(`UNSOLD PLAYERS (${state.unsoldPool.length})`);
      lines.push('------------------------------------------------------------------------');
      state.unsoldPool.forEach((p, index) => {
        const idxStr = String(index + 1).padStart(2, ' ');
        lines.push(`  ${idxStr}. ${p.name} — ${p.role} (${p.nationality}) | Base: ${formatLakhs(p.basePrice)}`);
      });
      lines.push('');
    }

    downloadBlob(
      lines.join('\n'),
      `real-auction-26-${state.roomCode}-squads.txt`,
      'text/plain;charset=utf-8;',
    );
  };

  const handleCopySummary = async () => {
    const lines: string[] = [
      `Real Auction 26 Results (Room ${state.roomCode})`,
      `Sold: ${state.soldHistory.length} | Unsold: ${state.unsoldPool.length}`,
      state.winnerAnalysis
        ? `AI Predicted Winner (not a guaranteed result): ${state.winnerAnalysis.winnerTeamName} — Confidence: ${state.winnerAnalysis.confidenceLevel ?? 'Moderate'} (${state.winnerAnalysis.confidencePercent ?? 70}%)`
        : '',
      '',
    ].filter((l) => l !== '');
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5 rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 shadow-xl">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-bold tracking-wider text-[#CFEAE0]/85 uppercase">
            <Trophy className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />
            Auction Concluded · Room {state.roomCode}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
            Final Franchise Squads & Purse Ledger
          </h1>
          <p className="text-sm text-[#CFEAE0]/80">
            {state.soldHistory.length} players sold across {state.teams.length} franchises · {state.unsoldPool.length} unsold
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onViewWinner}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#5B91A3] px-4 py-2 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            AI Winner Analysis
          </button>
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
          >
            {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSummary ? 'Copied Summary' : 'Copy Summary'}
          </button>
          <button
            type="button"
            onClick={handleExportText}
            aria-label="Download team squad details as formatted text file"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Download Squads (.txt)
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export JSON
          </button>
          {isHost && (
            <>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: true })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Rematch
              </button>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: false })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-3.5 py-2 text-xs font-semibold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                New Setup
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-xl border border-[#CFEAE0]/25 px-3.5 py-2 text-xs font-semibold text-[#CFEAE0]/85 hover:bg-[#131B2B] whitespace-nowrap"
          >
            Home
          </button>
        </div>
      </div>

      {/* AI Predicted Winner Callout (Post-Auction Only) */}
      {state.winnerAnalysis && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#CFEAE0]/45 bg-[#2F4A63] p-5 shadow-xl">
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-amber-200">
              AI Predicted Winner (Not a Guaranteed Result) · Confidence:{' '}
              {state.winnerAnalysis.confidenceLevel ?? 'Moderate'} ({state.winnerAnalysis.confidencePercent ?? 70}%)
            </div>
            <div className="font-display text-2xl font-extrabold text-[#CFEAE0]">
              {state.winnerAnalysis.winnerTeamName}
            </div>
            <p className="text-xs sm:text-sm text-[#CFEAE0]/85 leading-relaxed">
              {state.winnerAnalysis.overallVerdict}
            </p>
          </div>
          <button
            type="button"
            onClick={onViewWinner}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#5B91A3] px-4 py-2.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            View Full AI Prediction
          </button>
        </div>
      )}

      {/* Top Signings Strip */}
      {topSignings.length > 0 && (
        <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 space-y-3 shadow-xl">
          <h2 className="font-display text-xl font-bold text-[#CFEAE0]">Highest Bids of the Auction</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {topSignings.map((item, idx) => (
              <div
                key={item.player.id}
                className="rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-3.5 space-y-1.5"
              >
                <div className="text-[11px] font-mono-num text-[#5B91A3]">#{idx + 1} Signing</div>
                <div className="truncate font-bold text-[#CFEAE0]">{item.player.name}</div>
                <div className="text-xs text-[#CFEAE0]/70">{item.player.role} · {item.player.nationality}</div>
                <div className="flex items-center justify-between pt-1">
                  <span className="font-mono-num text-sm font-extrabold text-[#CFEAE0]">
                    {formatLakhsCompact(item.soldPrice)}
                  </span>
                  <span className="font-mono-num text-xs font-bold text-[#5B91A3]">
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
              className="flex flex-col rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-5 space-y-4 shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[#CFEAE0]/15 pb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <TeamCrest shortCode={team.shortCode} color={team.color} size="lg" />
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-xl font-bold text-[#CFEAE0]">{team.name}</h3>
                    <div className="text-xs text-[#CFEAE0]/75">
                      {team.controlType === 'bot' ? 'AI Managed' : team.ownerName || 'Human'} ·{' '}
                      <span className={meetsMinSize ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'}>
                        {team.squad.length}/{state.config.maxSquadSize} Players
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial & Balance Metrics */}
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-3 text-xs">
                <div>
                  <div className="text-[#CFEAE0]/65">Spent</div>
                  <div className="font-mono-num font-bold text-[#CFEAE0]">{formatLakhsCompact(spent)}</div>
                </div>
                <div>
                  <div className="text-[#CFEAE0]/65">Purse Left</div>
                  <div className="font-mono-num font-bold text-[#5B91A3]">{formatLakhsCompact(team.purse)}</div>
                </div>
                <div>
                  <div className="text-[#CFEAE0]/65">Overseas</div>
                  <div className="font-mono-num font-bold text-[#CFEAE0]">
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
                        ? 'border-emerald-400/40 bg-emerald-950/35 text-emerald-200'
                        : 'border-amber-300/35 bg-amber-950/30 text-amber-200'
                    }`}
                  >
                    {label} {count}/{req}
                  </div>
                ))}
              </div>

              {/* Squad List */}
              <div className="flex-1 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {team.squad.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[#CFEAE0]/60">No players signed.</div>
                ) : (
                  team.squad.map((item) => (
                    <div
                      key={item.player.id}
                      className="flex items-center justify-between rounded-lg border border-[#5B91A3]/25 bg-[#131B2B] px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-[#CFEAE0]">{item.player.name}</div>
                        <div className="text-[#CFEAE0]/70">
                          {item.player.role} · {item.player.nationality}
                        </div>
                      </div>
                      <span className="ml-2 font-mono-num font-bold text-[#5B91A3] shrink-0">
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
