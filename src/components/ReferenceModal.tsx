import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { REAL_PLAYER_POOL, SET_ORDER } from '../shared/data.ts';
import { formatLakhs, type PlayerSet } from '../shared/types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

interface ReferenceModalProps {
  activeTab: 'pool' | 'rules' | 'setup';
  onChangeTab: (tab: 'pool' | 'rules' | 'setup') => void;
  onClose: () => void;
}

export function ReferenceModal({ activeTab, onChangeTab, onClose }: ReferenceModalProps) {
  const [search, setSearch] = useState('');
  const [setFilter, setSetFilter] = useState<'All' | PlayerSet>('All');
  const [showAll, setShowAll] = useState(false);

  const filteredPlayers = useMemo(() => {
    return REAL_PLAYER_POOL.filter((p) => {
      if (setFilter !== 'All' && p.set !== setFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.nationality.toLowerCase().includes(q) ||
        p.role.toLowerCase().includes(q)
      );
    });
  }, [search, setFilter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Auction Reference & Setup Guide"
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#111827] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2">
            {(
              [
                ['pool', `Player Pool (${REAL_PLAYER_POOL.length})`],
                ['rules', 'Rules & Bid Increments'],
                ['setup', 'Setup & Architecture'],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => onChangeTab(tab)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'pool' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  {REAL_PLAYER_POOL.length} real IPL cricketers organized by auction set and tactical specialty.
                </p>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setShowAll(false);
                    }}
                    placeholder="Search player, country, role..."
                    className="w-full rounded-lg border border-white/15 bg-[#090D16] py-2 pl-9 pr-3 text-xs text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(['All', ...SET_ORDER] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setSetFilter(s);
                        setShowAll(false);
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        setFilter === s ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] font-mono-num text-slate-400">
                  Showing {showAll ? filteredPlayers.length : Math.min(60, filteredPlayers.length)} of {filteredPlayers.length}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(showAll ? filteredPlayers : filteredPlayers.slice(0, 60)).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#090D16] p-3"
                  >
                    <PlayerAvatar player={p} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{p.name}</div>
                      <div className="text-xs text-slate-400">
                        {p.tacticalRole} · {p.nationality}{p.age !== null ? ` · Age ${p.age}` : ''} · {p.set}
                      </div>
                      <div className="mt-1 font-mono-num text-[11px] text-slate-400">
                        {p.stats.matches !== null ? `${p.stats.matches} IPL M` : 'IPL Player'}
                        {p.stats.runs !== null ? ` · ${p.stats.runs}R (SR ${p.stats.strikeRate ?? '—'})` : ''}
                        {p.stats.wickets !== null && p.stats.wickets > 0 ? ` · ${p.stats.wickets}W` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-slate-500">Base</div>
                      <div className="font-mono-num text-xs font-bold text-amber-400">
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
                    className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
                  >
                    Show All {filteredPlayers.length} Players
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="space-y-6 text-sm text-slate-300">
              <div className="space-y-2">
                <h3 className="font-display text-xl font-bold text-white">Tiered IPL-Style Bid Increments</h3>
                <p className="text-xs text-slate-400">
                  When a player opens with no bids, the first valid bid equals their Base Price. Each subsequent bid increases automatically using the tier table below:
                </p>
                <div className="overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#090D16] text-slate-400">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Current Bid Range</th>
                        <th className="px-4 py-2.5 font-medium text-right">Next Bid Increment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-mono-num">
                      <tr>
                        <td className="px-4 py-2.5 text-white">Under ₹1.00 Crore</td>
                        <td className="px-4 py-2.5 text-right text-amber-400">+₹10 Lakh</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-white">₹1.00 Cr to ₹1.99 Cr</td>
                        <td className="px-4 py-2.5 text-right text-amber-400">+₹20 Lakh</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-white">₹2.00 Cr to ₹4.99 Cr</td>
                        <td className="px-4 py-2.5 text-right text-amber-400">+₹25 Lakh</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-white">₹5.00 Cr to ₹9.99 Cr</td>
                        <td className="px-4 py-2.5 text-right text-amber-400">+₹50 Lakh</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-white">₹10.00 Crore and above</td>
                        <td className="px-4 py-2.5 text-right text-amber-400">+₹1.00 Crore</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="rounded-xl border border-white/10 bg-[#090D16] p-4 space-y-1.5">
                  <div className="font-semibold text-white">Mandatory Purse Reserve</div>
                  <p className="text-slate-400 leading-relaxed">
                    To prevent a franchise from exhausting its ₹120 Cr purse before filling its minimum squad, the server reserves ₹30 Lakh for every remaining mandatory slot below the configured minimum squad size.
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#090D16] p-4 space-y-1.5">
                  <div className="font-semibold text-white">Open Clock & Anti-Snipe</div>
                  <p className="text-slate-400 leading-relaxed">
                    Teams that do not wish to bid simply wait for the clock to expire—no Pass button is required. Any valid bid placed inside the final 5 seconds resets the clock to 5 seconds so rivals can respond fairly.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'setup' && (
            <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
              <div className="rounded-xl border border-white/10 bg-[#090D16] p-4 space-y-2">
                <div className="text-sm font-semibold text-white">Player Portraits & AI Difficulty Tiers</div>
                <p className="text-slate-400">
                  Cricketer portraits are fetched safely via a same-origin Wikipedia/Wikimedia REST image cache (<code className="text-slate-200">/api/player-photo/:id</code>) with bundled studio portrait and SVG jersey fallbacks if offline. AI bots support Easy (basic rating/base value), Medium (strategic tactical role filling), and Hard (aggressive target bidding on elite stars and urgent squad gaps).
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#090D16] p-4 space-y-2">
                <div className="text-sm font-semibold text-white">Real-Time Architecture & Local/Cloud Setup</div>
                <p className="text-slate-400">
                  Multiplayer rooms, bid validation, simultaneous-bid conflict resolution, AI bot strategy, and countdown clocks run authoritatively on the Node.js Express + WebSocket server (<code className="text-slate-200">/ws</code> on port 3000). No external database keys or API tokens are required to run or play.
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-400">
                  <li>Development: <code className="text-slate-200">npm install && npm run dev</code></li>
                  <li>Production build: <code className="text-slate-200">npm run build && npm start</code></li>
                  <li>Optional environment variables (<code className="text-slate-200">.env.example</code>): <code className="text-slate-200">PORT</code> (defaults to 3000) and <code className="text-slate-200">APP_URL</code> for invite links.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
