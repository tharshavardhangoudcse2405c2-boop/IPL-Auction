import { useState } from 'react';
import {
  Bot,
  Check,
  Globe,
  Monitor,
  Play,
  SlidersHorizontal,
  Users,
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

interface LandingSetupProps {
  initialRoomCode?: string;
  onCreateRoom: (playerName: string, config: AuctionConfig, customTeams: Partial<Team>[]) => void;
  onJoinRoom: (roomCode: string, playerName: string) => void;
  onOpenReference: (tab: 'pool' | 'rules' | 'setup') => void;
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

export function LandingSetup({
  initialRoomCode = '',
  onCreateRoom,
  onJoinRoom,
  onOpenReference,
  isConnecting,
}: LandingSetupProps) {
  const [hostName, setHostName] = useState('Auctioneer');
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [joinName, setJoinName] = useState('');
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
    onCreateRoom(hostName.trim() || 'Auctioneer', config, customTeams);
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
    <div className="mx-auto max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8 space-y-10">
      {/* Hero Broadcast Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8">
          <div className="space-y-4">
            <div className="text-xs font-medium tracking-wider text-amber-400 uppercase">
              2–12 Franchises · ₹120 Crore Purse · Real-Time Broadcast Auction
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.02] [text-wrap:balance]">
              Command the Gavel. Build Your Championship XI.
            </h1>
            <p className="max-w-2xl text-base text-slate-300 leading-relaxed">
              Run a live IPL-style franchise auction online with friends across devices, solo against strategic AI managers, or openly on a single shared screen with dedicated team bid buttons.
            </p>
          </div>

          {/* 3 Game Mode Cards */}
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => handleModeChange('solo')}
              className={`text-left rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                config.mode === 'solo'
                  ? 'border-amber-400/70 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between">
                <Bot className="h-5 w-5 text-amber-400" aria-hidden="true" />
                {config.mode === 'solo' && <Check className="h-4 w-4 text-amber-400" aria-hidden="true" />}
              </div>
              <div className="mt-3 font-semibold text-white">Solo vs. Bots</div>
              <div className="mt-1 text-xs text-slate-400">
                Lead one franchise against 1–11 AI bidders with smart role & purse logic.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('online')}
              className={`text-left rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                config.mode === 'online'
                  ? 'border-amber-400/70 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between">
                <Globe className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                {config.mode === 'online' && <Check className="h-4 w-4 text-amber-400" aria-hidden="true" />}
              </div>
              <div className="mt-3 font-semibold text-white">Online Multiplayer</div>
              <div className="mt-1 text-xs text-slate-400">
                Share a room code or invite link for synced multi-device bidding.
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('local')}
              className={`text-left rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-amber-400 ${
                config.mode === 'local'
                  ? 'border-amber-400/70 bg-amber-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-center justify-between">
                <Monitor className="h-5 w-5 text-sky-400" aria-hidden="true" />
                {config.mode === 'local' && <Check className="h-4 w-4 text-amber-400" aria-hidden="true" />}
              </div>
              <div className="mt-3 font-semibold text-white">Shared Screen</div>
              <div className="mt-1 text-xs text-slate-400">
                Every team has an open Bid button on one device. Zero pass-and-play.
              </div>
            </button>
          </div>
        </div>

        {/* Right Visual Stage + Join Existing Room Card */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <div className="relative flex-1 min-h-[220px] overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
            <img
              src="/src/assets/images/auction_broadcast_backdrop_1795289107217.jpg"
              alt="Cricket auction television broadcast studio with warm amber spotlights"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#090D16] via-[#090D16]/45 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5">
              <div className="text-xs font-medium text-amber-300">
                Real IPL & International Cricketers · Verified Portraits
              </div>
              <div className="mt-1 text-sm text-slate-200">
                {REAL_PLAYER_POOL.length} real IPL cricketers across Marquee, Batters, All-Rounders, Wicketkeepers, and Bowlers with tactical AI opposition.
              </div>
            </div>
          </div>

          {/* Join Existing Online Room */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onJoinRoom(joinCode, joinName || 'Manager');
            }}
            className="rounded-2xl border border-white/10 bg-[#111827] p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold tracking-wide text-white">
                Join an Online Auction Room
              </h2>
              <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 8))}
                placeholder="Room Code (e.g. CH7K4M)"
                aria-label="Room Code"
                className="sm:col-span-5 rounded-lg border border-white/15 bg-[#090D16] px-3 py-2.5 font-mono-num text-sm uppercase tracking-widest text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <input
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value.slice(0, 24))}
                placeholder="Your Manager Name"
                aria-label="Your Manager Name"
                className="sm:col-span-4 rounded-lg border border-white/15 bg-[#090D16] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isConnecting || !joinCode.trim()}
                className="sm:col-span-3 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-45 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                Join Room
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Main Pre-Auction Configurator */}
      <section className="rounded-2xl border border-white/10 bg-[#111827] p-6 sm:p-8 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
              Configure Auction Room
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Mode: <span className="text-slate-200 font-medium">{config.mode === 'solo' ? 'Solo vs. AI Bots' : config.mode === 'online' ? 'Online Multiplayer Lobby' : 'Shared-Screen Local Multiplayer'}</span>
              {' · '}
              {config.teamCount} Franchises
              {' · '}
              {formatLakhs(config.startingPurse)} Starting Purse
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowAdvancedRules((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              {showAdvancedRules ? 'Hide Squad Limits' : 'Squad & Role Limits'}
            </button>
            <button
              type="button"
              onClick={handleLaunch}
              disabled={isConnecting}
              className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              {isConnecting ? 'Creating Room...' : config.mode === 'online' ? 'Create Online Lobby' : 'Enter Auction Room'}
            </button>
          </div>
        </div>

        {/* Core Parameters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Host / Lead Name</span>
            <input
              type="text"
              value={hostName}
              onChange={(e) => setHostName(e.target.value.slice(0, 24))}
              className="w-full rounded-lg border border-white/15 bg-[#090D16] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Teams (2–12)</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={2}
                max={12}
                value={config.teamCount}
                onChange={(e) => handleTeamCountChange(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <span className="font-mono-num w-8 text-right text-sm font-bold text-amber-400">
                {config.teamCount}
              </span>
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Auction Clock</span>
            <select
              value={config.timerSeconds}
              onChange={(e) => setConfig((prev) => ({ ...prev, timerSeconds: Number(e.target.value) }))}
              className="w-full rounded-lg border border-white/15 bg-[#090D16] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
            >
              <option value={10}>10 sec (Blitz)</option>
              <option value={15}>15 sec (Standard)</option>
              <option value={20}>20 sec (Tactical)</option>
              <option value={30}>30 sec (Relaxed)</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">AI Bot Difficulty</span>
            <select
              value={config.botDifficulty}
              onChange={(e) => setConfig((prev) => ({ ...prev, botDifficulty: e.target.value as BotDifficulty }))}
              className="w-full rounded-lg border border-white/15 bg-[#090D16] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
            >
              <option value="easy">Easy (Basic Bidding)</option>
              <option value="medium">Medium (Strategic Role Fill)</option>
              <option value="hard">Hard (Aggressive Target)</option>
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Player Pool ({poolCountLabel})</span>
            <select
              value={config.poolPreset}
              onChange={(e) => setConfig((prev) => ({ ...prev, poolPreset: e.target.value as PoolPreset }))}
              className="w-full rounded-lg border border-white/15 bg-[#090D16] px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
            >
              <option value="quick_25">Quick Draft (25)</option>
              <option value="standard_40">Standard Auction (40)</option>
              <option value="mega_60">Mega Draft (60)</option>
              <option value="full_pool">Full IPL Pool ({REAL_PLAYER_POOL.length})</option>
            </select>
          </label>
        </div>

        {/* Selectable Sets */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-300">Auction Sets Included</div>
          <div className="flex flex-wrap gap-2">
            {SET_ORDER.map((setName) => {
              const active = config.enabledSets.includes(setName);
              return (
                <button
                  key={setName}
                  type="button"
                  onClick={() => toggleSet(setName)}
                  className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-amber-400/70 bg-amber-500/15 text-amber-200'
                      : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-slate-200'
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
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4 rounded-xl border border-white/10 bg-[#090D16] p-4">
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Starting Purse</span>
              <select
                value={config.startingPurse}
                onChange={(e) => setConfig((p) => ({ ...p, startingPurse: Number(e.target.value) }))}
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 text-sm text-white"
              >
                <option value={8000}>₹80 Cr</option>
                <option value={10000}>₹100 Cr</option>
                <option value={12000}>₹120 Cr (IPL)</option>
                <option value={15000}>₹150 Cr</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Min Squad</span>
              <input
                type="number"
                min={4}
                max={18}
                value={config.minSquadSize}
                onChange={(e) => setConfig((p) => ({ ...p, minSquadSize: Number(e.target.value) }))}
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Max Squad</span>
              <input
                type="number"
                min={config.minSquadSize}
                max={25}
                value={config.maxSquadSize}
                onChange={(e) => setConfig((p) => ({ ...p, maxSquadSize: Number(e.target.value) }))}
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Max Overseas</span>
              <input
                type="number"
                min={1}
                max={10}
                value={config.maxOverseas}
                onChange={(e) => setConfig((p) => ({ ...p, maxOverseas: Number(e.target.value) }))}
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Min Batters</span>
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
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Min Bowlers</span>
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
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-slate-400">Min Keepers</span>
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
                className="w-full rounded-md border border-white/15 bg-[#111827] px-2.5 py-1.5 font-mono-num text-sm text-white"
              />
            </label>
          </div>
        )}

        {/* Franchise Lineup Editor */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-white">
              Franchise Lineup ({teamSlots.length} Teams)
            </div>
            <div className="text-xs text-slate-400">
              Rename any franchise, edit short codes, or toggle Human vs. AI Bot control.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {teamSlots.map((slot, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#090D16] p-3"
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
                    className="w-full bg-transparent text-sm font-medium text-white focus:outline-none border-b border-transparent focus:border-amber-400"
                  />
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="text"
                      value={slot.shortCode}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase().slice(0, 5);
                        setTeamSlots((prev) => prev.map((t, i) => (i === idx ? { ...t, shortCode: val } : t)));
                      }}
                      aria-label={`Team ${idx + 1} Code`}
                      className="w-12 rounded bg-white/5 px-1.5 py-0.5 font-mono-num text-[11px] uppercase text-slate-200 focus:outline-none"
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
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    slot.controlType === 'human'
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-white/15 bg-white/5 text-slate-300'
                  }`}
                >
                  {slot.controlType === 'human' ? 'Human' : 'AI Bot'}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Pre-Auction Rules Summary & Quick Links */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 border-t border-white/10 pt-5 text-xs text-slate-300">
          <div className="lg:col-span-8 space-y-1.5">
            <div className="font-semibold text-white">Pre-Auction Rules Summary</div>
            <p className="text-slate-400 leading-relaxed">
              Each team begins with <span className="text-slate-200 font-mono-num">{formatLakhs(config.startingPurse)}</span> and must finish with{' '}
              <span className="text-slate-200 font-mono-num">{config.minSquadSize}–{config.maxSquadSize}</span> players (max{' '}
              <span className="text-slate-200 font-mono-num">{config.maxOverseas}</span> overseas). Bid increments rise automatically
              (+₹10L under ₹1Cr, +₹20L to ₹2Cr, +₹25L to ₹5Cr, +₹50L to ₹10Cr, +₹1Cr above ₹10Cr). Teams always retain ₹30L per remaining mandatory slot. No pass button is needed—non-bidding teams simply sit out until the gavel falls.
            </p>
          </div>
          <div className="lg:col-span-4 flex flex-wrap items-center lg:justify-end gap-3">
            <button
              type="button"
              onClick={() => onOpenReference('pool')}
              className="text-amber-400 hover:text-amber-300 underline underline-offset-4 whitespace-nowrap"
            >
              Inspect Player Pool ({REAL_PLAYER_POOL.length})
            </button>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onOpenReference('rules')}
              className="text-slate-300 hover:text-white underline underline-offset-4 whitespace-nowrap"
            >
              Bid Increment Table
            </button>
            <span className="text-slate-600" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => onOpenReference('setup')}
              className="text-slate-300 hover:text-white underline underline-offset-4 whitespace-nowrap"
            >
              Setup & Licensing Notes
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
