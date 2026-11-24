import { BarChart3 } from 'lucide-react';
import { formatLakhs, type Player } from '../shared/types.ts';

export interface HoveredPlayerStats {
  player: Player;
  anchorRect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

interface PlayerStatsTooltipProps {
  hovered: HoveredPlayerStats | null;
}

export function PlayerStatsTooltip({ hovered }: PlayerStatsTooltipProps) {
  if (!hovered || typeof window === 'undefined') return null;

  const { player, anchorRect } = hovered;
  const tooltipWidth = 288;
  const edgeMargin = 12;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const left = Math.max(
    edgeMargin,
    Math.min(anchorRect.left, viewportWidth - tooltipWidth - edgeMargin),
  );
  const placeAbove = anchorRect.top >= 240;
  const top = placeAbove
    ? anchorRect.top - 8
    : Math.min(anchorRect.bottom + 8, Math.max(edgeMargin, viewportHeight - 230));

  return (
    <div
      role="tooltip"
      aria-label={`Stats for ${player.name}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      className={`pointer-events-none fixed z-50 w-72 rounded-xl border border-[#5B91A3]/75 bg-[#131B2B]/95 p-3.5 shadow-2xl backdrop-blur-md space-y-2.5 ${
        placeAbove ? '-translate-y-full' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#5B91A3]/25 pb-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[#5B91A3]">
          <BarChart3 className="h-3 w-3" aria-hidden="true" />
          Stats
        </span>
        <span className="text-[10px] font-semibold text-[#CFEAE0]/75">
          {player.set} Set · Rating {player.rating}
        </span>
      </div>

      <div>
        <div className="truncate font-display text-base font-bold text-[#CFEAE0] leading-tight">
          {player.name}
        </div>
        <div className="mt-0.5 text-[11px] text-[#CFEAE0]/75">
          {player.nationality} · {player.isOverseas ? 'Overseas' : 'Domestic'}
          {player.age !== null ? ` · Age ${player.age}` : ''}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[#5B91A3]/35 bg-[#2F4A63]/65 px-2.5 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#CFEAE0]/65">
            Base Price
          </div>
          <div className="mt-0.5 font-mono-num text-sm font-extrabold text-[#CFEAE0]">
            {formatLakhs(player.basePrice)}
          </div>
        </div>

        <div className="rounded-lg border border-[#5B91A3]/35 bg-[#2F4A63]/65 px-2.5 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#CFEAE0]/65">
            Player Role
          </div>
          <div className="mt-0.5 truncate text-xs font-extrabold text-[#CFEAE0]">
            {player.role}
          </div>
          <div className="truncate text-[10px] text-[#CFEAE0]/75">{player.tacticalRole}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 border-t border-[#5B91A3]/20 pt-2 text-[11px]">
        <div>
          <div className="text-[10px] text-[#CFEAE0]/60">Matches</div>
          <div className="font-mono-num font-bold text-[#CFEAE0]">
            {player.stats.matches !== null ? player.stats.matches : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#CFEAE0]/60">Runs / SR</div>
          <div className="font-mono-num font-bold text-[#CFEAE0]">
            {player.stats.runs !== null
              ? `${player.stats.runs}${player.stats.strikeRate !== null ? ` (${player.stats.strikeRate.toFixed(0)})` : ''}`
              : '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#CFEAE0]/60">Wkts / Econ</div>
          <div className="font-mono-num font-bold text-[#CFEAE0]">
            {player.stats.wickets !== null
              ? `${player.stats.wickets}${player.stats.economy !== null && player.stats.economy > 0 ? ` (${player.stats.economy.toFixed(1)})` : ''}`
              : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}
