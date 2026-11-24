import { useState } from 'react';
import {
  ArrowLeft,
  Bot,
  Check,
  Globe,
  Monitor,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DEFAULT_CONFIG,
  FRANCHISE_TEMPLATES,
  REAL_PLAYER_POOL,
  SET_ORDER,
} from '../shared/data.ts';
import {
  formatLakhs,
  type AuctionConfig,
  type BotDifficulty,
  type GameMode,
  type PlayerSet,
  type PoolPreset,
  type Team,
} from '../shared/types.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface CreateAuctionPageProps {
  defaultHostName?: string;
  onCreateRoom: (playerName: string, config: AuctionConfig, customTeams: Partial<Team>[]) => void;
  onNavigate: (path: string) => void;
  isConnecting: boolean;
}

interface EditableTeamSlot {
  name: string;
  shortCode: string;
  color: string;
  controlType: 'human' | 'bot';
}

function buildInitialTeamSlots(count: number, mode: GameMode): EditableTeamSlot[] {
  return Array.from({ length: count }, (_, idx) => {
    const tpl = FRANCHISE_TEMPLATES[idx % FRANCHISE_TEMPLATES.length];
    return {
      name: tpl.name,
      shortCode: tpl.shortCode,
      color: tpl.color,
      controlType:
        mode === 'solo' ? (idx === 0 ? 'human' : 'bot') :
        mode === 'local' ? 'human' :
        'human',
    };
  });
}

export function CreateAuctionPage({
  defaultHostName = 'Auctioneer',
  onCreateRoom,
  onNavigate,
  isConnecting,
}: CreateAuctionPageProps) {
  const [hostName, setHostName] = useState(defaultHostName || 'Auctioneer');
  const [config, setConfig] = useState<AuctionConfig>(DEFAULT_CONFIG);
  const [teamSlots, setTeamSlots] = useState<EditableTeamSlot[]>(() =>
    buildInitialTeamSlots(DEFAULT_CONFIG.teamCount, DEFAULT_CONFIG.mode),
  );
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);

  const handleModeChange = (mode: GameMode) => {
    setConfig((prev) => ({ ...prev, mode }));
    setTeamSlots((prev) =>
      prev.map((slot, idx) => ({
        ...slot,
        controlType:
          mode === 'solo' ? (idx === 0 ? 'human' : 'bot') :
          mode === 'local' ? 'human' :
          'human',
      })),
    );
  };

  const handleTeamCountChange = (nextCount: number) => {
    const clamped = Math.max(2, Math.min(12, nextCount));
    setConfig((prev) => ({ ...prev, teamCount: clamped }));
    setTeamSlots((prev) => {
      if (clamped <= prev.length) return prev.slice(0, clamped);
      const extra = Array.from({ length: clamped - prev.length }, (_, offset) => {
        const idx = prev.length + offset;
        const tpl = FRANCHISE_TEMPLATES[idx % FRANCHISE_TEMPLATES.length];
        return {
          name: tpl.name,
          shortCode: tpl.shortCode,
          color: tpl.color,
          controlType: config.mode === 'solo' ? ('bot' as const) : ('human' as const),
        };
      });
      return [...prev, ...extra];
    });
  };

  const toggleSet = (setName: PlayerSet) => {
    setConfig((prev) => {
      const exists = prev.enabledSets.includes(setName);
      if (exists && prev.enabledSets.length === 1) return prev;
      const next = exists
        ? prev.enabledSets.filter((s) => s !== setName)
        : SET_ORDER.filter((s) => s === setName || prev.enabledSets.includes(s));
      return { ...prev, enabledSets: next };
    });
  };

  const handleLaunch = () => {
    const customTeams: Partial<Team>[] = teamSlots.map((slot) => ({
      name: slot.name,
      shortCode: slot.shortCode,
      color: slot.color,
      controlType: slot.controlType,
    }));
    onCreateRoom(hostName.trim() || defaultHostName || 'Auctioneer', config, customTeams);
  };

  const poolCountLabel =
    config.poolPreset === 'quick_25'
      ? 'Up to 25 players'
      : config.poolPreset === 'standard_40'
        ? 'Up to 40 players'
        : config.poolPreset === 'mega_60'
          ? 'Up to 60 players'
          : `All ${REAL_PLAYER_POOL.length} players`;

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
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => onNavigate('/players')}
            className="text-[#CFEAE0] hover:underline underline-offset-4"
          >
            Inspect Player Pool ({REAL_PLAYER_POOL.length})
          </button>
          <span className="text-[#5B91A3]" aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => onNavigate('/rules')}
            className="text-[#CFEAE0]/80 hover:text-[#CFEAE0] hover:underline underline-offset-4"
          >
            Rules & Increments
          </button>
        </div>
      </div>

      {/* Mode Selection Strip */}
      <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-6">
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/85">
            Step 1 · Select Auction Format
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
            Create Auction Room
          </h1>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            type="button"
            onClick={() => handleModeChange('solo')}
            className={`text-left rounded-xl border p-4 transition-colors ${
              config.mode === 'solo'
                ? 'border-[#CFEAE0] bg-[#131B2B]'
                : 'border-[#5B91A3]/35 bg-[#131B2B]/55 hover:bg-[#131B2B]/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <Bot className="h-5 w-5 text-[#5B91A3]" aria-hidden="true" />
              {config.mode === 'solo' && <Check className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />}
            </div>
            <div className="mt-3 font-bold text-[#CFEAE0]">Solo vs. Bots</div>
            <div className="mt-1 text-xs text-[#CFEAE0]/75">
              Lead one franchise against 1–11 AI bidders with strategic role & purse logic.
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('online')}
            className={`text-left rounded-xl border p-4 transition-colors ${
              config.mode === 'online'
                ? 'border-[#CFEAE0] bg-[#131B2B]'
                : 'border-[#5B91A3]/35 bg-[#131B2B]/55 hover:bg-[#131B2B]/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <Globe className="h-5 w-5 text-[#5B91A3]" aria-hidden="true" />
              {config.mode === 'online' && <Check className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />}
            </div>
            <div className="mt-3 font-bold text-[#CFEAE0]">Online Multiplayer</div>
            <div className="mt-1 text-xs text-[#CFEAE0]/75">
              Share a room code or invite link for synced multi-device franchise bidding.
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('local')}
            className={`text-left rounded-xl border p-4 transition-colors ${
              config.mode === 'local'
                ? 'border-[#CFEAE0] bg-[#131B2B]'
                : 'border-[#5B91A3]/35 bg-[#131B2B]/55 hover:bg-[#131B2B]/80'
            }`}
          >
            <div className="flex items-center justify-between">
              <Monitor className="h-5 w-5 text-[#5B91A3]" aria-hidden="true" />
              {config.mode === 'local' && <Check className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />}
            </div>
            <div className="mt-3 font-bold text-[#CFEAE0]">Shared Screen</div>
            <div className="mt-1 text-xs text-[#CFEAE0]/75">
              Every team gets an open Bid button on one device. Zero pass-and-play.
            </div>
          </button>
        </div>
      </section>

      {/* Main Pre-Auction Configurator */}
      <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#CFEAE0]/15 pb-5">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#CFEAE0]">
              Step 2 · Configure Teams & Rules
            </h2>
            <p className="mt-1 text-sm text-[#CFEAE0]/80">
              Mode:{' '}
              <span className="text-[#CFEAE0] font-semibold">
                {config.mode === 'solo'
                  ? 'Solo vs. AI Bots'
                  : config.mode === 'online'
                    ? 'Online Multiplayer Lobby'
                    : 'Shared-Screen Local Multiplayer'}
              </span>
              {' · '}
              {config.teamCount} Franchises
              {' · '}
              {formatLakhs(config.startingPurse)} Starting Purse
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAdvancedRules((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-4 py-2.5 text-sm font-semibold text-[#CFEAE0] hover:bg-[#1B293D] transition-colors whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {showAdvancedRules ? 'Hide Squad Limits' : 'Squad & Role Limits'}
            </button>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-2.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              {isConnecting ? 'Creating Room...' : config.mode === 'online' ? 'Create Online Lobby' : 'Enter Auction Room'}
            </button>
          </div>
        </div>

        {/* Core Parameters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Host / Lead Name</span>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value.slice(0, 24))}
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2.5 text-sm text-[#CFEAE0] focus:border-[#CFEAE0] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Teams (2–12)</span>
            <div className="flex items-center gap-2 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2">
              <input
                type="range"
                min={2}
                max={12}
                value={config.teamCount}
                onChange={(e) => handleTeamCountChange(Number(e.target.value))}
                className="w-full accent-[#5B91A3]"
              />
              <span className="font-mono-num w-8 text-right text-sm font-bold text-[#CFEAE0]">
                {config.teamCount}
              </span>
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Auction Clock</span>
            <select
              value={config.timerSeconds}
              onChange={(e) => setConfig((prev) => ({ ...prev, timerSeconds: Number(e.target.value) }))}
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2.5 text-sm text-[#CFEAE0] focus:border-[#CFEAE0] focus:outline-none"
            >
              <option value={10}>10 sec (Blitz)</option>
              <option value={15}>15 sec (Standard)</option>
              <option value={20}>20 sec (Tactical)</option>
              <option value={30}>30 sec (Relaxed)</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">AI Bot Difficulty</span>
            <select
              value={config.botDifficulty}
              onChange={(e) => setConfig((prev) => ({ ...prev, botDifficulty: e.target.value as BotDifficulty }))}
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2.5 text-sm text-[#CFEAE0] focus:border-[#CFEAE0] focus:outline-none"
            >
              <option value="easy">Easy (Basic Bidding)</option>
              <option value="medium">Medium (Strategic Role Fill)</option>
              <option value="hard">Hard (Aggressive Target)</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Player Pool ({poolCountLabel})</span>
            <select
              value={config.poolPreset}
              onChange={(e) => setConfig((prev) => ({ ...prev, poolPreset: e.target.value as PoolPreset }))}
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3 py-2.5 text-sm text-[#CFEAE0] focus:border-[#CFEAE0] focus:outline-none"
            >
              <option value="quick_25">Quick Draft (25)</option>
              <option value="standard_40">Standard Auction (40)</option>
              <option value="mega_60">Mega Draft (60)</option>
              <option value="full_pool">Full 2026 IPL Pool ({REAL_PLAYER_POOL.length})</option>
            </select>
          </label>
        </div>

        {/* Selectable Sets */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[#CFEAE0]">Auction Sets Included</div>
          <div className="flex flex-wrap gap-2">
            {SET_ORDER.map((setName) => {
              const active = config.enabledSets.includes(setName);
              return (
                <button
                  key={setName}
                  type="button"
                  onClick={() => toggleSet(setName)}
                  className={`rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-[#CFEAE0] bg-[#5B91A3] text-[#131B2B]'
                      : 'border-[#5B91A3]/35 bg-[#131B2B]/70 text-[#CFEAE0]/75 hover:text-[#CFEAE0]'
                  }`}
                >
                  {setName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Advanced Squad & Purse Rules */}
        {showAdvancedRules && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] p-4">
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Starting Purse</span>
              <select
                value={config.startingPurse}
                onChange={(e) => setConfig((p) => ({ ...p, startingPurse: Number(e.target.value) }))}
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 text-sm text-[#CFEAE0]"
              >
                <option value={8000}>₹80 Cr</option>
                <option value={10000}>₹100 Cr</option>
                <option value={12000}>₹120 Cr (IPL)</option>
                <option value={15000}>₹150 Cr</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Min Squad</span>
              <input
                type="number"
                min={4}
                max={18}
                value={config.minSquadSize}
                onChange={(e) => setConfig((p) => ({ ...p, minSquadSize: Number(e.target.value) }))}
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Max Squad</span>
              <input
                type="number"
                min={config.minSquadSize}
                max={25}
                value={config.maxSquadSize}
                onChange={(e) => setConfig((p) => ({ ...p, maxSquadSize: Number(e.target.value) }))}
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Max Overseas</span>
              <input
                type="number"
                min={1}
                max={10}
                value={config.maxOverseas}
                onChange={(e) => setConfig((p) => ({ ...p, maxOverseas: Number(e.target.value) }))}
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Min Batters</span>
              <input
                type="number"
                min={0}
                max={6}
                value={config.roleRequirements.Batter}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    roleRequirements: { ...p.roleRequirements, Batter: Number(e.target.value) },
                  }))
                }
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Min Bowlers</span>
              <input
                type="number"
                min={0}
                max={6}
                value={config.roleRequirements.Bowler}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    roleRequirements: { ...p.roleRequirements, Bowler: Number(e.target.value) },
                  }))
                }
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#CFEAE0]/80">Min Keepers</span>
              <input
                type="number"
                min={0}
                max={3}
                value={config.roleRequirements.Wicketkeeper}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    roleRequirements: { ...p.roleRequirements, Wicketkeeper: Number(e.target.value) },
                  }))
                }
                className="w-full rounded-lg border border-[#5B91A3]/40 bg-[#2F4A63] px-2.5 py-1.5 font-mono-num text-sm text-[#CFEAE0]"
              />
            </label>
          </div>
        )}

        {/* Franchise Lineup Editor */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-bold text-[#CFEAE0]">
              Franchise Lineup ({teamSlots.length} Teams)
            </div>
            <div className="text-xs text-[#CFEAE0]/75">
              Rename any franchise, edit short codes, or toggle Human vs. AI Bot control.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamSlots.map((slot, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-3"
              >
                <TeamCrest shortCode={slot.shortCode} color={slot.color} size="md" />
                <div className="min-w-0 flex-1 space-y-1">
                  <input
                    type="text"
                    value={slot.name}
                    onChange={(e) => {
                      const val = e.target.value.slice(0, 32);
                      setTeamSlots((prev) => prev.map((t, i) => (i === idx ? { ...t, name: val } : t)));
                    }}
                    aria-label={`Team ${idx + 1} Name`}
                    className="w-full bg-transparent text-sm font-semibold text-[#CFEAE0] focus:outline-none border-b border-transparent focus:border-[#5B91A3]"
                  />
                  <div className="flex items-center gap-2 text-xs text-[#CFEAE0]/70">
                    <input
                      type="text"
                      value={slot.shortCode}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase().slice(0, 5);
                        setTeamSlots((prev) => prev.map((t, i) => (i === idx ? { ...t, shortCode: val } : t)));
                      }}
                      aria-label={`Team ${idx + 1} Code`}
                      className="w-12 rounded bg-[#2F4A63] px-1.5 py-0.5 font-mono-num text-[11px] uppercase text-[#CFEAE0] focus:outline-none"
                    />
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-num">{formatLakhs(config.startingPurse)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setTeamSlots((prev) =>
                      prev.map((t, i) =>
                        i === idx
                          ? { ...t, controlType: t.controlType === 'human' ? 'bot' : 'human' }
                          : t,
                      ),
                    )
                  }
                  className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                    slot.controlType === 'human'
                      ? 'border-[#5B91A3] bg-[#5B91A3] text-[#131B2B]'
                      : 'border-[#5B91A3]/35 bg-[#2F4A63] text-[#CFEAE0]'
                  }`}
                >
                  {slot.controlType === 'human' ? 'Human' : 'AI Bot'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
