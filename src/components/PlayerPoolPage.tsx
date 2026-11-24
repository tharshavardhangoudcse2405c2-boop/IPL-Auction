import { useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { REAL_PLAYER_POOL, SET_ORDER } from '../shared/data.ts';
import { formatLakhs, type PlayerRole, type PlayerSet } from '../shared/types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface PlayerPoolPageProps {
  onNavigate: (path: string) => void;
}

export function PlayerPoolPage({ onNavigate }: PlayerPoolPageProps) {
  const [search, setSearch] = useState('');
  const [setFilter, setSetFilter] = useState<'All' | PlayerSet>('All');
  const [roleFilter, setRoleFilter] = useState<'All' | PlayerRole>('All');
  const [showAll, setShowAll] = useState(false);

  const filteredPlayers = useMemo(() => {
    return REAL_PLAYER_POOL.filter((p) => {
      if (setFilter !== 'All' && p.set !== setFilter) return false;
      if (roleFilter !== 'All' && p.role !== roleFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.nationality.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q) ||
        p.tacticalRole.toLowerCase().includes(q)
      );
    });
  }, [search, setFilter, roleFilter]);

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#CFEAE0]/80 hover:text-[#CFEAE0]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Home
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/create')}
          className="rounded-xl bg-[#5B91A3] px-4 py-2 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9]"
        >
          Launch Auction With This Pool
        </button>
      </div>

      <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-5 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#CFEAE0]/15 pb-5">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/80">
              Verified Cricketer Directory
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
              2026 IPL Auction Pool ({REAL_PLAYER_POOL.length} Players)
            </h1>
            <p className="mt-1 text-xs text-[#CFEAE0]/80">
              Active 2026 IPL auction stars and signings organized into Marquee, Batters, All-Rounders, Wicketkeepers, and Bowlers.
            </p>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-[#CFEAE0]/50" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowAll(false);
              }}
              placeholder="Search player, country, role..."
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] py-2.5 pl-10 pr-3 text-xs text-[#CFEAE0] placeholder:text-[#CFEAE0]/40 focus:border-[#CFEAE0] focus:outline-none"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', ...SET_ORDER] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSetFilter(s);
                  setShowAll(false);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                  setFilter === s
                    ? 'bg-[#5B91A3] text-[#131B2B]'
                    : 'bg-[#131B2B]/70 text-[#CFEAE0]/80 hover:text-[#CFEAE0]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(['All', 'Batter', 'Bowler', 'All-Rounder', 'Wicketkeeper'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRoleFilter(r);
                  setShowAll(false);
                }}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  roleFilter === r
                    ? 'border-[#CFEAE0] bg-[#131B2B] text-[#CFEAE0]'
                    : 'border-[#5B91A3]/35 text-[#CFEAE0]/70 hover:text-[#CFEAE0]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="text-[11px] font-mono-num text-[#CFEAE0]/75">
          Showing {showAll ? filteredPlayers.length : Math.min(60, filteredPlayers.length)} of {filteredPlayers.length} matching cricketers
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(showAll ? filteredPlayers : filteredPlayers.slice(0, 60)).map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-3.5"
            >
              <PlayerAvatar player={p} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#CFEAE0]">{p.name}</div>
                <div className="text-xs text-[#CFEAE0]/75 truncate">
                  {p.tacticalRole} · {p.nationality}
                  {p.age !== null ? ` · ${p.age}y` : ''} · {p.set}
                </div>
                <div className="mt-1 font-mono-num text-[11px] text-[#CFEAE0]/70">
                  {p.stats.matches !== null ? `${p.stats.matches} IPL M` : 'IPL Player'}
                  {p.stats.runs !== null ? ` · ${p.stats.runs}R (SR ${p.stats.strikeRate ?? '—'})` : ''}
                  {p.stats.wickets !== null && p.stats.wickets > 0 ? ` · ${p.stats.wickets}W` : ''}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-[#CFEAE0]/60">Base</div>
                <div className="font-mono-num text-xs font-bold text-[#CFEAE0]">
                  {formatLakhs(p.basePrice)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!showAll && filteredPlayers.length > 60 && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="rounded-xl bg-[#5B91A3] px-5 py-2.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9]"
            >
              Show All {filteredPlayers.length} Players
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
