import crypto from 'node:crypto';
import {
  DEFAULT_CONFIG,
  FRANCHISE_TEMPLATES,
  REAL_PLAYER_POOL,
  buildPlayerQueue,
} from '../shared/data.ts';
import {
  MIN_PLAYER_RESERVE_LAKHS,
  evaluateTeamBidEligibility,
  formatLakhs,
  getBidIncrement,
  getMaxAffordableBid,
  getNextValidBid,
  getTeamOverseasCount,
  getTeamRoleCounts,
  getTeamTacticalCounts,
  type AuctionConfig,
  type AuctionEvent,
  type AuctionRoomState,
  type BidEntry,
  type CurrentLot,
  type LotOutcome,
  type Participant,
  type Player,
  type Team,
} from '../shared/types.ts';

export interface RoomRuntime {
  state: AuctionRoomState;
  sessionTokens: Map<string, string>; // clientId -> sessionToken
  botLotValuations: Map<string, { maxWilling: number; reason: string }>; // `${lotNumber}:${playerId}:${teamId}`
  botReadyAt: Map<string, number>; // teamId -> epoch ms when bot can place next bid
  voicePeers: Map<string, { joined: boolean; micActive: boolean; speaking: boolean }>;
  autoAdvanceAt: number | null; // epoch ms during LOT_RESULT before opening next lot
  lastTickAt: number;
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export function makeServerClientId(): string {
  return `cli-${crypto.randomBytes(8).toString('hex')}`;
}

export function timingSafeTokenEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(0, chars.length)];
  }
  return code;
}

function pushEvent(state: AuctionRoomState, event: Omit<AuctionEvent, 'id' | 'timestamp'>): void {
  state.eventLog.unshift({
    id: makeId('evt'),
    timestamp: Date.now(),
    ...event,
  });
  if (state.eventLog.length > 150) {
    state.eventLog.length = 150;
  }
}

export function createTeamsFromConfig(
  config: AuctionConfig,
  hostClientId: string,
  hostName: string,
  customTeams?: Partial<Team>[],
): Team[] {
  const count = Math.max(2, Math.min(12, config.teamCount));
  const teams: Team[] = [];

  for (let i = 0; i < count; i++) {
    const tpl = FRANCHISE_TEMPLATES[i % FRANCHISE_TEMPLATES.length];
    const custom = customTeams?.[i];
    const isFirst = i === 0;
    const defaultControl: 'human' | 'bot' =
      config.mode === 'solo' ? (isFirst ? 'human' : 'bot') :
      'human';

    const controlType: 'human' | 'bot' =
      custom?.controlType === 'bot' || custom?.controlType === 'human'
        ? custom.controlType
        : defaultControl;

    let ownerClientId: string | null = null;
    let ownerName: string | null = null;

    if (controlType === 'bot') {
      ownerClientId = null;
      ownerName = 'AI Manager';
    } else if (config.mode === 'local') {
      ownerClientId = hostClientId;
      ownerName = hostName;
    } else if (config.mode === 'solo') {
      const alreadyHasHuman = teams.some((t) => t.controlType === 'human' && t.ownerClientId === hostClientId);
      if (!alreadyHasHuman) {
        ownerClientId = hostClientId;
        ownerName = hostName;
      } else {
        teams.push({
          id: `team-${i + 1}`,
          name: custom?.name?.trim() || tpl.name,
          shortCode: (custom?.shortCode?.trim() || tpl.shortCode).toUpperCase().slice(0, 5),
          color: custom?.color && /^#[0-9A-Fa-f]{6}$/.test(custom.color) ? custom.color : tpl.color,
          accentColor: tpl.accentColor,
          controlType: 'bot',
          ownerClientId: null,
          ownerName: 'AI Manager',
          purse: config.startingPurse,
          startingPurse: config.startingPurse,
          squad: [],
          isReady: true,
        });
        continue;
      }
    } else if (config.mode === 'online') {
      const alreadyOwnsOne = teams.some((t) => t.ownerClientId === hostClientId);
      if (!alreadyOwnsOne) {
        ownerClientId = hostClientId;
        ownerName = hostName;
      }
    }

    teams.push({
      id: `team-${i + 1}`,
      name: custom?.name?.trim().slice(0, 32) || tpl.name,
      shortCode: (custom?.shortCode?.trim() || tpl.shortCode).toUpperCase().slice(0, 5),
      color: custom?.color && /^#[0-9A-Fa-f]{6}$/.test(custom.color) ? custom.color : tpl.color,
      accentColor: tpl.accentColor,
      controlType,
      ownerClientId,
      ownerName,
      purse: config.startingPurse,
      startingPurse: config.startingPurse,
      squad: [],
      isReady: controlType === 'bot' || ownerClientId === hostClientId,
    });
  }

  return teams;
}

export function sanitizeConfig(raw: Partial<AuctionConfig>): AuctionConfig {
  const base = { ...DEFAULT_CONFIG, ...raw };
  const mode = base.mode === 'online' || base.mode === 'solo' || base.mode === 'local' ? base.mode : 'solo';
  const teamCount = Math.max(2, Math.min(12, Math.round(Number(base.teamCount) || 6)));
  const startingPurse = Math.max(4000, Math.min(25000, Math.round(Number(base.startingPurse) || 12000)));
  const maxLegalMinSquad = Math.max(4, Math.floor(startingPurse / MIN_PLAYER_RESERVE_LAKHS));
  const minSquadSize = Math.max(4, Math.min(18, maxLegalMinSquad, Math.round(Number(base.minSquadSize) || 8)));
  const maxSquadSize = Math.max(minSquadSize, Math.min(25, Math.round(Number(base.maxSquadSize) || 15)));
  const maxOverseas = Math.max(1, Math.min(maxSquadSize, Math.round(Number(base.maxOverseas) || 5)));
  const timerSeconds = Math.max(8, Math.min(45, Math.round(Number(base.timerSeconds) || 15)));
  const antiSnipeSeconds = Math.max(3, Math.min(10, Math.round(Number(base.antiSnipeSeconds) || 5)));
  const poolPreset =
    base.poolPreset === 'quick_25' ||
    base.poolPreset === 'standard_40' ||
    base.poolPreset === 'mega_60' ||
    base.poolPreset === 'full_pool'
      ? base.poolPreset
      : 'standard_40';
  const enabledSets = Array.isArray(base.enabledSets) && base.enabledSets.length > 0
    ? base.enabledSets
    : DEFAULT_CONFIG.enabledSets;

  const validDiff = base.botDifficulty === 'easy' || base.botDifficulty === 'medium' || base.botDifficulty === 'hard'
    ? base.botDifficulty
    : 'medium';

  return {
    ...base,
    mode,
    poolPreset,
    botDifficulty: validDiff,
    teamCount,
    startingPurse,
    minSquadSize,
    maxSquadSize,
    maxOverseas,
    timerSeconds,
    antiSnipeSeconds,
    enabledSets,
    roleRequirements: {
      Batter: Math.max(0, Math.min(8, Math.round(Number(base.roleRequirements?.Batter ?? 2)))),
      Bowler: Math.max(0, Math.min(8, Math.round(Number(base.roleRequirements?.Bowler ?? 2)))),
      'All-Rounder': Math.max(0, Math.min(6, Math.round(Number(base.roleRequirements?.['All-Rounder'] ?? 2)))),
      Wicketkeeper: Math.max(0, Math.min(4, Math.round(Number(base.roleRequirements?.Wicketkeeper ?? 1)))),
    },
  };
}

export function createRoomRuntime(
  roomCode: string,
  hostName: string,
  rawConfig: Partial<AuctionConfig>,
  customTeams?: Partial<Team>[],
): { runtime: RoomRuntime; hostClientId: string; sessionToken: string } {
  const config = sanitizeConfig(rawConfig);
  const now = Date.now();
  const hostClientId = makeServerClientId();
  const sessionToken = crypto.randomBytes(24).toString('hex');
  const safeHostName = hostName.trim().slice(0, 32) || 'Auctioneer';
  const teams = createTeamsFromConfig(config, hostClientId, safeHostName, customTeams);
  const playerQueue = buildPlayerQueue(config.enabledSets, config.poolPreset);
  const firstOwned = teams.find((t) => t.controlType === 'human' && t.ownerClientId === hostClientId);

  const hostParticipant: Participant = {
    clientId: hostClientId,
    name: safeHostName,
    isHost: true,
    connected: true,
    teamId: firstOwned?.id ?? null,
    isReady: true,
    joinedAt: now,
  };

  const state: AuctionRoomState = {
    roomCode,
    phase: 'LOBBY',
    config,
    teams,
    participants: [hostParticipant],
    playerQueue,
    unsoldPool: [],
    soldHistory: [],
    currentLot: null,
    lastOutcome: null,
    eventLog: [],
    winnerAnalysis: null,
    serverTime: now,
    createdAt: now,
  };

  pushEvent(state, {
    type: 'system',
    message: `Auction room ${roomCode} created by ${hostParticipant.name} (${config.teamCount} franchises, ${formatLakhs(config.startingPurse)} purse, AI: ${config.botDifficulty}).`,
  });

  const runtime: RoomRuntime = {
    state,
    sessionTokens: new Map([[hostClientId, sessionToken]]),
    botLotValuations: new Map(),
    botReadyAt: new Map(),
    voicePeers: new Map(),
    autoAdvanceAt: null,
    lastTickAt: now,
  };

  return { runtime, hostClientId, sessionToken };
}

export function joinRoom(
  runtime: RoomRuntime,
  incomingClientId: string | undefined,
  clientName: string,
  incomingToken?: string,
): { sessionToken: string; participant: Participant; reconnected: boolean } {
  const state = runtime.state;
  const now = Date.now();

  if (incomingClientId && incomingToken) {
    const expectedToken = runtime.sessionTokens.get(incomingClientId);
    const existing = state.participants.find((p) => p.clientId === incomingClientId);
    if (existing && expectedToken && timingSafeTokenEquals(incomingToken, expectedToken)) {
      existing.connected = true;
      if (clientName.trim()) {
        existing.name = clientName.trim().slice(0, 32);
      }
      for (const t of state.teams) {
        if (t.ownerClientId === existing.clientId) {
          t.ownerName = existing.name;
        }
      }
      pushEvent(state, {
        type: 'info',
        message: `${existing.name} reconnected to the room.`,
      });
      return { sessionToken: expectedToken, participant: existing, reconnected: true };
    }
  }

  const safeClientId = makeServerClientId();
  const sessionToken = crypto.randomBytes(24).toString('hex');
  runtime.sessionTokens.set(safeClientId, sessionToken);

  const cleanName = clientName.trim().slice(0, 32) || `Manager ${state.participants.length + 1}`;

  const participant: Participant = {
    clientId: safeClientId,
    name: cleanName,
    isHost: false,
    connected: true,
    teamId: null,
    isReady: false,
    joinedAt: now,
  };

  state.participants.push(participant);
  pushEvent(state, {
    type: 'info',
    message: `${cleanName} joined the room.`,
  });

  return { sessionToken, participant, reconnected: false };
}

export function updateLobbyConfig(runtime: RoomRuntime, clientId: string, partial: Partial<AuctionConfig>): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can modify auction rules.';
  if (state.phase !== 'LOBBY') return 'Rules can only be edited in the lobby.';

  const prevTeamCount = state.config.teamCount;
  const prevMode = state.config.mode;
  const prevPurse = state.config.startingPurse;
  const prevPoolKey = `${state.config.poolPreset}:${[...state.config.enabledSets].sort().join(',')}`;
  const nextConfig = sanitizeConfig({ ...state.config, ...partial });
  state.config = nextConfig;

  if (
    nextConfig.teamCount !== prevTeamCount ||
    nextConfig.mode !== prevMode ||
    nextConfig.startingPurse !== prevPurse
  ) {
    const preserved = state.teams;
    const host = state.participants.find((p) => p.isHost);
    state.teams = createTeamsFromConfig(
      nextConfig,
      host?.clientId ?? clientId,
      host?.name ?? 'Auctioneer',
      preserved,
    );
    for (const p of state.participants) {
      const owned = state.teams.find((t) => t.controlType === 'human' && t.ownerClientId === p.clientId);
      p.teamId = owned?.id ?? null;
      if (!p.isHost && !p.teamId) {
        p.isReady = false;
      }
    }
  }

  const nextPoolKey = `${nextConfig.poolPreset}:${[...nextConfig.enabledSets].sort().join(',')}`;
  if (nextPoolKey !== prevPoolKey) {
    state.playerQueue = buildPlayerQueue(nextConfig.enabledSets, nextConfig.poolPreset);
  }
  pushEvent(state, {
    type: 'system',
    message: `Rules updated: ${nextConfig.teamCount} teams · ${formatLakhs(nextConfig.startingPurse)} purse · ${nextConfig.minSquadSize}–${nextConfig.maxSquadSize} squad · ${nextConfig.timerSeconds}s clock · AI: ${nextConfig.botDifficulty}.`,
  });

  return null;
}

export function updateTeamSettings(
  runtime: RoomRuntime,
  clientId: string,
  payload: { teamId: string; name?: string; shortCode?: string; color?: string; controlType?: 'human' | 'bot' },
): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant) return 'Not an active room participant.';
  if (state.phase !== 'LOBBY') return 'Franchises can only be modified in the lobby.';

  const team = state.teams.find((t) => t.id === payload.teamId);
  if (!team) return 'Team not found.';

  const isOwner = team.ownerClientId === clientId;
  if (!participant.isHost && !isOwner) {
    return 'Only the host or franchise owner can edit this team.';
  }

  if (payload.name !== undefined && payload.name.trim()) {
    team.name = payload.name.trim().slice(0, 32);
  }
  if (payload.shortCode !== undefined && payload.shortCode.trim()) {
    team.shortCode = payload.shortCode.trim().toUpperCase().slice(0, 5);
  }
  if (payload.color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(payload.color)) {
    team.color = payload.color;
  }

  if (payload.controlType !== undefined && (payload.controlType === 'human' || payload.controlType === 'bot')) {
    if (!participant.isHost) {
      return 'Only the host can switch a franchise between Human and AI Bot.';
    }
    team.controlType = payload.controlType;
    if (payload.controlType === 'bot') {
      if (team.ownerClientId) {
        const owner = state.participants.find((p) => p.clientId === team.ownerClientId);
        if (owner && owner.teamId === team.id) {
          owner.teamId = null;
          if (!owner.isHost) owner.isReady = false;
        }
      }
      team.ownerClientId = null;
      team.ownerName = 'AI Manager';
      team.isReady = true;
    } else {
      if (state.config.mode === 'online') {
        team.ownerClientId = null;
        team.ownerName = null;
        team.isReady = false;
      } else if (state.config.mode === 'local') {
        const host = state.participants.find((p) => p.isHost);
        team.ownerClientId = host?.clientId ?? clientId;
        team.ownerName = host?.name ?? 'Local Player';
        team.isReady = true;
      } else if (state.config.mode === 'solo') {
        const host = state.participants.find((p) => p.isHost);
        const hostId = host?.clientId ?? clientId;
        const alreadyHasHuman = state.teams.some((t) => t.id !== team.id && t.controlType === 'human' && t.ownerClientId === hostId);
        if (alreadyHasHuman) {
          team.controlType = 'bot';
          return 'Solo mode permits one human-controlled franchise.';
        }
        team.ownerClientId = hostId;
        team.ownerName = host?.name ?? 'Solo Manager';
        team.isReady = true;
        if (host) host.teamId = team.id;
      }
    }
  }

  return null;
}

export function claimTeam(runtime: RoomRuntime, clientId: string, teamId: string | null): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant) return 'Participant not found.';
  if (state.phase !== 'LOBBY') return 'Teams can only be claimed or released in the lobby.';
  if (state.config.mode !== 'online') {
    return 'Team claiming is only used in online multiplayer lobbies.';
  }

  for (const t of state.teams) {
    if (t.ownerClientId === clientId) {
      t.ownerClientId = null;
      t.ownerName = t.controlType === 'bot' ? 'AI Manager' : null;
      t.isReady = t.controlType === 'bot';
    }
  }
  participant.teamId = null;

  if (!teamId) {
    if (!participant.isHost) participant.isReady = false;
    return null;
  }

  const target = state.teams.find((t) => t.id === teamId);
  if (!target) return 'Franchise not found.';
  if (target.controlType === 'bot') {
    return 'That franchise is assigned to an AI bot.';
  }
  if (target.ownerClientId && target.ownerClientId !== clientId) {
    return 'Franchise already claimed by another participant.';
  }
  const duplicateHolder = state.participants.find((p) => p.clientId !== clientId && p.teamId === target.id);
  if (duplicateHolder) {
    return 'Franchise already claimed by another participant.';
  }

  target.ownerClientId = clientId;
  target.ownerName = participant.name;
  target.isReady = participant.isReady || participant.isHost;
  participant.teamId = target.id;
  return null;
}

export function fillOpenSeatsWithBots(runtime: RoomRuntime, clientId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can assign AI bots to open seats.';
  if (state.phase !== 'LOBBY') return 'Can only assign AI bots in the lobby.';

  let converted = 0;
  for (const t of state.teams) {
    if (t.controlType === 'human' && !t.ownerClientId) {
      t.controlType = 'bot';
      t.ownerName = 'AI Manager';
      t.isReady = true;
      converted += 1;
    }
  }

  if (converted > 0) {
    pushEvent(state, {
      type: 'system',
      message: `Host assigned AI Managers to ${converted} open franchise ${converted === 1 ? 'seat' : 'seats'}.`,
    });
  }
  return null;
}

export function toggleParticipantReady(runtime: RoomRuntime, clientId: string, ready: boolean): void {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant) return;
  participant.isReady = ready;
  for (const t of state.teams) {
    if (t.ownerClientId === clientId) {
      t.isReady = ready;
    }
  }
}

export function startAuction(runtime: RoomRuntime, clientId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can start the auction.';
  if (state.phase !== 'LOBBY') return 'Auction has already started.';
  if (state.playerQueue.length === 0) return 'Player pool is empty. Enable at least one player set.';

  const activeBidders = state.teams.filter(
    (t) => t.controlType === 'bot' || (t.controlType === 'human' && Boolean(t.ownerClientId)),
  );
  if (activeBidders.length === 0) {
    return 'At least one claimed human team or AI bot is required to start the auction.';
  }

  pushEvent(state, {
    type: 'system',
    message: `Auction gavel drops! ${state.playerQueue.length} players queued across ${state.config.enabledSets.join(', ')}.`,
  });

  openNextLot(runtime);
  return null;
}

function canAnyEligibleTeamAffordAnyRemaining(state: AuctionRoomState): boolean {
  const minNextCost = Math.min(
    ...state.playerQueue.map((p) => p.basePrice),
    ...(state.currentLot ? [getNextValidBid(state.currentLot)] : [Infinity]),
  );
  for (const team of state.teams) {
    // Only count teams that can actually participate (bot or owned human team)
    const canParticipate = team.controlType === 'bot' || Boolean(team.ownerClientId);
    if (!canParticipate) continue;
    if (team.squad.length < state.config.maxSquadSize) {
      const maxAff = getMaxAffordableBid(team, state.config);
      if (maxAff >= minNextCost) return true;
    }
  }
  return false;
}

export function openNextLot(runtime: RoomRuntime): void {
  const state = runtime.state;
  runtime.autoAdvanceAt = null;
  runtime.botReadyAt.clear();

  const participatingTeams = state.teams.filter(
    (t) => t.controlType === 'bot' || Boolean(t.ownerClientId),
  );
  const allTeamsFull =
    participatingTeams.length > 0 &&
    participatingTeams.every((t) => t.squad.length >= state.config.maxSquadSize);

  if (state.playerQueue.length === 0 || allTeamsFull || !canAnyEligibleTeamAffordAnyRemaining(state)) {
    state.phase = 'COMPLETED';
    state.currentLot = null;
    pushEvent(state, {
      type: 'system',
      message: allTeamsFull
        ? 'All active franchises have reached maximum squad capacity. Auction concluded!'
        : 'Player pool complete. Final franchise squads locked!',
    });
    return;
  }

  const nextPlayer = state.playerQueue.shift()!;
  const lotNumber = state.soldHistory.length + state.unsoldPool.length + 1;
  const totalLots = lotNumber + state.playerQueue.length;
  const now = Date.now();

  const lot: CurrentLot = {
    player: nextPlayer,
    lotNumber,
    totalLots,
    currentBid: 0,
    leadingTeamId: null,
    bidHistory: [],
    lotEndsAt: now + state.config.timerSeconds * 1000,
    remainingMsWhenPaused: null,
    openedAt: now,
  };

  state.currentLot = lot;
  state.phase = 'LIVE';
  state.lastOutcome = null;

  pushEvent(state, {
    type: 'info',
    message: `Lot #${lotNumber}: ${nextPlayer.name} (${nextPlayer.tacticalRole} · ${nextPlayer.nationality}) enters at base ${formatLakhs(nextPlayer.basePrice)}.`,
  });

  scheduleBotsForCurrentLot(runtime, now);
}

function evaluateTacticalNeed(
  team: Team,
  player: Player,
  config: AuctionConfig,
): { multiplier: number; reason: string; isUrgentGap: boolean } {
  const broadCounts = getTeamRoleCounts(team);
  const tactical = getTeamTacticalCounts(team);
  const broadReq = config.roleRequirements[player.role] ?? 1;

  let multiplier = 1.0;
  let reason = 'Squad Balance';
  let isUrgentGap = false;

  switch (player.tacticalRole) {
    case 'Wicketkeeper-Batter':
      if (tactical.keepers === 0) {
        multiplier = 1.42;
        reason = 'Need Primary Wicketkeeper';
        isUrgentGap = true;
      } else if (tactical.keepers >= 2) {
        multiplier = 0.72;
        reason = 'Keeper Depth Filled';
      }
      break;
    case 'Opening Batter':
      if (tactical.openers < 2) {
        multiplier = tactical.openers === 0 ? 1.38 : 1.24;
        reason = 'Need Opening Batter';
        isUrgentGap = tactical.openers === 0;
      } else if (tactical.openers >= 3) {
        multiplier = 0.75;
        reason = 'Openers Covered';
      }
      break;
    case 'Death Bowler':
      if (tactical.deathBowlers < 2) {
        multiplier = tactical.deathBowlers === 0 ? 1.44 : 1.25;
        reason = 'Need Death Bowler';
        isUrgentGap = tactical.deathBowlers === 0;
      } else if (tactical.deathBowlers >= 3) {
        multiplier = 0.78;
        reason = 'Death Pace Covered';
      }
      break;
    case 'Powerplay Pacer':
      if (tactical.powerplayPacers === 0) {
        multiplier = 1.28;
        reason = 'Need New-Ball Pacer';
        isUrgentGap = true;
      } else if (tactical.powerplayPacers >= 2) {
        multiplier = 0.8;
      }
      break;
    case 'Wrist Spinner':
    case 'Finger Spinner':
      if (tactical.spinners === 0) {
        multiplier = 1.34;
        reason = 'Need Frontline Spinner';
        isUrgentGap = true;
      } else if (tactical.spinners >= 2) {
        multiplier = 0.74;
        reason = 'Spin Attack Covered';
      }
      break;
    case 'Finisher':
      if (tactical.middleFinishers < 2) {
        multiplier = 1.26;
        reason = 'Need Finisher';
      }
      break;
    case 'Pace All-Rounder':
    case 'Spin All-Rounder':
      if (tactical.allRounders < 2) {
        multiplier = 1.28;
        reason = `Need ${player.tacticalRole}`;
        isUrgentGap = tactical.allRounders === 0;
      } else if (tactical.allRounders >= 3) {
        multiplier = 0.78;
      }
      break;
    default:
      break;
  }

  if (broadCounts[player.role] < broadReq && multiplier < 1.25) {
    multiplier = Math.max(multiplier, 1.24);
    reason = `Min ${player.role} Quota`;
  } else if (broadCounts[player.role] >= broadReq + 2) {
    multiplier = Math.min(multiplier, 0.76);
  }

  return { multiplier, reason, isUrgentGap };
}

function computeBotValuation(
  runtime: RoomRuntime,
  team: Team,
  player: Player,
): { maxWilling: number; reason: string } {
  const key = `${runtime.state.currentLot?.lotNumber ?? 0}:${player.id}:${team.id}`;
  const cached = runtime.botLotValuations.get(key);
  if (cached !== undefined) return cached;

  const { config } = runtime.state;
  const maxAffordable = getMaxAffordableBid(team, config);
  if (maxAffordable < player.basePrice) {
    const zero = { maxWilling: 0, reason: 'Purse Reserve' };
    runtime.botLotValuations.set(key, zero);
    return zero;
  }

  const normalized = Math.max(0, (player.rating - 68) / 29);
  const fairMarketValue = 40 + Math.pow(normalized, 2.3) * 1550;

  const slotsRemainingToMin = Math.max(1, config.minSquadSize - team.squad.length);
  const avgPursePerSlot = maxAffordable / slotsRemainingToMin;
  const overseasUsed = getTeamOverseasCount(team);
  const overseasRemaining = Math.max(0, config.maxOverseas - overseasUsed);

  let valuation = fairMarketValue;
  let reason = 'Market Value';

  if (config.botDifficulty === 'easy') {
    const jitter = 0.65 + crypto.randomInt(0, 22) / 100;
    valuation = fairMarketValue * jitter;
    valuation = Math.min(valuation, maxAffordable * 0.28);
    if (crypto.randomInt(0, 100) < 20) {
      valuation = Math.min(valuation, player.basePrice * 1.4);
    }
    reason = 'Basic Value';
  } else if (config.botDifficulty === 'medium') {
    const need = evaluateTacticalNeed(team, player, config);
    valuation *= need.multiplier;
    reason = need.reason;

    if (player.isOverseas && overseasRemaining <= 1 && player.rating < 89) {
      valuation *= 0.64;
    }

    const shareCap =
      slotsRemainingToMin > 2
        ? Math.max(avgPursePerSlot * 1.85, maxAffordable * (player.rating >= 92 ? 0.42 : 0.3))
        : maxAffordable;

    const jitter = 0.9 + crypto.randomInt(0, 20) / 100;
    valuation = Math.min(valuation * jitter, shareCap);
  } else {
    const need = evaluateTacticalNeed(team, player, config);
    const isTargetStar = player.rating >= 90 || need.isUrgentGap;
    valuation *= need.multiplier * (isTargetStar ? 1.22 : 1.04);

    if (player.rating >= 93) {
      reason = `Target Star (${player.tacticalRole})`;
    } else if (need.isUrgentGap) {
      reason = `Priority Target: ${player.tacticalRole}`;
    } else {
      reason = need.reason;
    }

    if (player.isOverseas && overseasRemaining <= 1 && player.rating < 88) {
      valuation *= 0.55;
    }

    if (!player.isOverseas && player.rating >= 88) {
      valuation *= 1.12;
    }

    const shareCap =
      slotsRemainingToMin > 2
        ? Math.max(avgPursePerSlot * 2.4, maxAffordable * (isTargetStar ? 0.54 : 0.36))
        : maxAffordable;

    const jitter = 0.96 + crypto.randomInt(0, 22) / 100;
    valuation = Math.min(valuation * jitter, shareCap);
  }

  const maxWilling = Math.min(
    maxAffordable,
    Math.max(0, Math.round(valuation / 10) * 10),
  );

  const result = { maxWilling, reason };
  runtime.botLotValuations.set(key, result);
  return result;
}

export function scheduleBotsForCurrentLot(runtime: RoomRuntime, now: number): void {
  const state = runtime.state;
  if (state.phase !== 'LIVE' || !state.currentLot) return;

  const { botDifficulty } = state.config;
  const minDelay = botDifficulty === 'hard' ? 420 : botDifficulty === 'easy' ? 1200 : 700;
  const spread = botDifficulty === 'hard' ? 620 : botDifficulty === 'easy' ? 1400 : 950;

  for (const team of state.teams) {
    if (team.controlType !== 'bot') continue;
    const delay = minDelay + crypto.randomInt(0, spread);
    runtime.botReadyAt.set(team.id, now + delay);
  }
}

export function handlePlaceBid(
  runtime: RoomRuntime,
  teamId: string,
  expectedAmount: number,
  actorClientId: string,
  isBot = false,
  botReason?: string,
): { ok: boolean; reason?: string; amount?: number; lotEndsAt?: number } {
  const state = runtime.state;
  const lot = state.currentLot;
  const now = Date.now();

  if (state.phase !== 'LIVE' || !lot) {
    return { ok: false, reason: 'Bidding is not currently open.' };
  }

  // Strictly reject late bids that arrive after the countdown expired
  if (now >= lot.lotEndsAt) {
    return { ok: false, reason: 'Bidding window has expired for this lot.' };
  }

  if (typeof teamId !== 'string' || !teamId.trim()) {
    return { ok: false, reason: 'Invalid franchise specified.' };
  }

  if (!Number.isInteger(expectedAmount) || expectedAmount <= 0) {
    return { ok: false, reason: 'Invalid bid amount.' };
  }

  const team = state.teams.find((t) => t.id === teamId);
  if (!team) {
    return { ok: false, reason: 'Franchise not found in this room.' };
  }

  if (isBot) {
    if (team.controlType !== 'bot') {
      return { ok: false, reason: 'Only bot-controlled teams may place AI bids.' };
    }
  } else {
    const participant = state.participants.find((p) => p.clientId === actorClientId);
    if (!participant || !participant.connected) {
      return { ok: false, reason: 'You are not an active participant in this room.' };
    }

    if (team.controlType !== 'human') {
      return { ok: false, reason: 'That franchise is controlled by an AI bot.' };
    }

    if (state.config.mode === 'online') {
      if (!team.ownerClientId) {
        return { ok: false, reason: 'That franchise is unclaimed. Claim a franchise in the lobby before bidding.' };
      }
      if (team.ownerClientId !== participant.clientId || participant.teamId !== team.id) {
        return { ok: false, reason: 'In online mode you can only place bids for your own claimed franchise.' };
      }
    } else if (state.config.mode === 'solo') {
      if (team.ownerClientId !== participant.clientId) {
        return { ok: false, reason: 'You can only place bids for your own franchise.' };
      }
    } else if (state.config.mode === 'local') {
      // Shared-screen local mode: host/local operator controls human-assigned franchises
      if (!participant.isHost && team.ownerClientId !== participant.clientId) {
        return { ok: false, reason: 'Only the local room operator can place bids for shared-screen franchises.' };
      }
    }
  }

  const requiredBid = getNextValidBid(lot);
  if (expectedAmount !== requiredBid) {
    return {
      ok: false,
      reason: `Bid superseded — next valid ask is ${formatLakhs(requiredBid)}.`,
    };
  }

  const eligibility = evaluateTeamBidEligibility(team, lot, state.config, state.phase);
  if (!eligibility.canBid) {
    return { ok: false, reason: eligibility.reason || 'Team cannot bid.' };
  }

  lot.currentBid = requiredBid;
  lot.leadingTeamId = team.id;

  const entry: BidEntry = {
    id: makeId('bid'),
    teamId: team.id,
    teamName: team.name,
    teamShortCode: team.shortCode,
    teamColor: team.color,
    amount: requiredBid,
    timestamp: now,
    isBot,
    botReason: isBot ? botReason : undefined,
  };
  lot.bidHistory.unshift(entry);

  const antiSnipeMs = state.config.antiSnipeSeconds * 1000;
  if (lot.lotEndsAt - now < antiSnipeMs) {
    lot.lotEndsAt = now + antiSnipeMs;
  }

  const diffLabel =
    state.config.botDifficulty === 'hard'
      ? 'Hard'
      : state.config.botDifficulty === 'easy'
        ? 'Easy'
        : 'Medium';

  pushEvent(state, {
    type: 'bid',
    message: `${team.shortCode} bid ${formatLakhs(requiredBid)} for ${lot.player.name}${
      isBot ? ` (AI · ${diffLabel}${botReason ? ` · ${botReason}` : ''})` : ''
    }.`,
    teamColor: team.color,
  });

  scheduleBotsForCurrentLot(runtime, now);

  return { ok: true, amount: requiredBid, lotEndsAt: lot.lotEndsAt };
}

export function finalizeCurrentLot(runtime: RoomRuntime, forceUnsold = false): void {
  const state = runtime.state;
  const lot = state.currentLot;
  if (!lot || (state.phase !== 'LIVE' && state.phase !== 'PAUSED')) return;

  // Clear currentLot atomically first so double-finalization is impossible
  state.currentLot = null;

  const now = Date.now();
  const candidateWinner = !forceUnsold && lot.leadingTeamId
    ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null
    : null;

  const canAward =
    candidateWinner !== null &&
    lot.currentBid > 0 &&
    candidateWinner.purse >= lot.currentBid &&
    candidateWinner.squad.length < state.config.maxSquadSize &&
    !candidateWinner.squad.some((s) => s.player.id === lot.player.id) &&
    (!lot.player.isOverseas || getTeamOverseasCount(candidateWinner) < state.config.maxOverseas);

  let outcome: LotOutcome;

  if (canAward && candidateWinner) {
    candidateWinner.purse -= lot.currentBid;
    candidateWinner.squad.push({
      player: lot.player,
      soldPrice: lot.currentBid,
      soldAt: now,
    });

    outcome = {
      player: lot.player,
      status: 'SOLD',
      soldPrice: lot.currentBid,
      winningTeamId: candidateWinner.id,
      winningTeamName: candidateWinner.name,
      winningTeamColor: candidateWinner.color,
      winningTeamShortCode: candidateWinner.shortCode,
      timestamp: now,
    };

    state.soldHistory.unshift(outcome);
    pushEvent(state, {
      type: 'sold',
      message: `SOLD! ${lot.player.name} goes to ${candidateWinner.name} for ${formatLakhs(lot.currentBid)}. Purse left: ${formatLakhs(candidateWinner.purse)}.`,
      teamColor: candidateWinner.color,
    });
  } else {
    outcome = {
      player: lot.player,
      status: 'UNSOLD',
      soldPrice: 0,
      winningTeamId: null,
      winningTeamName: null,
      winningTeamColor: null,
      winningTeamShortCode: null,
      timestamp: now,
    };

    if (!state.unsoldPool.some((p) => p.id === lot.player.id)) {
      state.unsoldPool.push(lot.player);
    }
    pushEvent(state, {
      type: 'unsold',
      message: `UNSOLD: ${lot.player.name} (${formatLakhs(lot.player.basePrice)} base) added to the Unsold Pool.`,
    });
  }

  state.lastOutcome = outcome;
  state.phase = 'LOT_RESULT';
  runtime.autoAdvanceAt = now + 3500;
}

export function pauseAuction(runtime: RoomRuntime, clientId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can pause the auction.';
  if (state.phase !== 'LIVE' || !state.currentLot) return 'Auction is not live.';

  const now = Date.now();
  state.currentLot.remainingMsWhenPaused = Math.max(1000, state.currentLot.lotEndsAt - now);
  state.phase = 'PAUSED';
  pushEvent(state, { type: 'pause', message: `Auctioneer (${participant.name}) paused the clock.` });
  return null;
}

export function resumeAuction(runtime: RoomRuntime, clientId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can resume the auction.';
  if (state.phase !== 'PAUSED' || !state.currentLot) return 'Auction is not paused.';

  const now = Date.now();
  const rem = state.currentLot.remainingMsWhenPaused ?? state.config.timerSeconds * 1000;
  state.currentLot.lotEndsAt = now + rem;
  state.currentLot.remainingMsWhenPaused = null;
  state.phase = 'LIVE';
  scheduleBotsForCurrentLot(runtime, now);
  pushEvent(state, { type: 'resume', message: `Auction resumed by ${participant.name}.` });
  return null;
}

export function extendTimer(runtime: RoomRuntime, clientId: string, extraSeconds: number): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can extend the timer.';
  if (!state.currentLot || (state.phase !== 'LIVE' && state.phase !== 'PAUSED')) {
    return 'No active lot to extend.';
  }

  const addSec = Math.max(1, Math.min(30, Math.round(extraSeconds)));
  const addMs = addSec * 1000;
  if (state.phase === 'PAUSED' && state.currentLot.remainingMsWhenPaused !== null) {
    state.currentLot.remainingMsWhenPaused += addMs;
  } else if (state.phase === 'LIVE') {
    state.currentLot.lotEndsAt += addMs;
  }
  pushEvent(state, { type: 'system', message: `Auctioneer extended the timer by +${addSec}s.` });
  return null;
}

export function undoLastBid(runtime: RoomRuntime, clientId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can undo bids.';
  if (!state.currentLot || (state.phase !== 'LIVE' && state.phase !== 'PAUSED')) {
    return 'No active lot.';
  }
  if (state.currentLot.bidHistory.length === 0) {
    return 'No bids to undo on the current lot.';
  }

  const lot = state.currentLot;
  const removed = lot.bidHistory.shift()!;
  const previous = lot.bidHistory[0] ?? null;

  lot.currentBid = previous ? previous.amount : 0;
  lot.leadingTeamId = previous ? previous.teamId : null;

  const now = Date.now();
  if (state.phase === 'LIVE') {
    lot.lotEndsAt = Math.max(lot.lotEndsAt, now + 6000);
    scheduleBotsForCurrentLot(runtime, now);
  } else if (state.phase === 'PAUSED' && lot.remainingMsWhenPaused !== null) {
    lot.remainingMsWhenPaused = Math.max(lot.remainingMsWhenPaused, 6000);
  }

  pushEvent(state, {
    type: 'system',
    message: `Auctioneer reverted bid of ${formatLakhs(removed.amount)} by ${removed.teamShortCode} to resolve interruption.`,
  });
  return null;
}

export function reauctionPlayer(runtime: RoomRuntime, clientId: string, playerId: string): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can re-auction unsold players.';
  if (typeof playerId !== 'string' || !playerId) return 'Invalid player.';

  const idx = state.unsoldPool.findIndex((p) => p.id === playerId);
  if (idx === -1) return 'Player not found in the unsold pool.';

  const [player] = state.unsoldPool.splice(idx, 1);
  if (!state.playerQueue.some((p) => p.id === player.id) && !state.teams.some((t) => t.squad.some((s) => s.player.id === player.id))) {
    state.playerQueue.unshift(player);
  }

  pushEvent(state, {
    type: 'reauction',
    message: `${player.name} brought back from Unsold Pool for re-auction!`,
  });

  if (state.phase === 'LOT_RESULT' || state.phase === 'COMPLETED') {
    openNextLot(runtime);
  }
  return null;
}

export function rematchRoom(runtime: RoomRuntime, clientId: string, keepSettings: boolean): string | null {
  const state = runtime.state;
  const participant = state.participants.find((p) => p.clientId === clientId && p.connected);
  if (!participant?.isHost) return 'Only the host can start a rematch.';

  runtime.autoAdvanceAt = null;
  runtime.botLotValuations.clear();
  runtime.botReadyAt.clear();

  for (const team of state.teams) {
    team.purse = state.config.startingPurse;
    team.startingPurse = state.config.startingPurse;
    team.squad = [];
    const owner = team.ownerClientId
      ? state.participants.find((p) => p.clientId === team.ownerClientId)
      : null;
    team.isReady = team.controlType === 'bot' || Boolean(owner?.isReady || owner?.isHost);
  }

  state.playerQueue = buildPlayerQueue(state.config.enabledSets, state.config.poolPreset);
  state.unsoldPool = [];
  state.soldHistory = [];
  state.currentLot = null;
  state.lastOutcome = null;
  state.winnerAnalysis = null;
  state.eventLog = [];

  if (keepSettings) {
    pushEvent(state, {
      type: 'system',
      message: 'Rematch launched with the same franchises and auction rules!',
    });
    openNextLot(runtime);
  } else {
    state.phase = 'LOBBY';
    pushEvent(state, {
      type: 'system',
      message: 'Returned to room lobby to configure new auction settings.',
    });
  }

  return null;
}

export function tickRoom(runtime: RoomRuntime, now: number): boolean {
  const state = runtime.state;
  state.serverTime = now;
  runtime.lastTickAt = now;
  let changed = false;

  if (state.phase === 'LOT_RESULT' && runtime.autoAdvanceAt && now >= runtime.autoAdvanceAt) {
    openNextLot(runtime);
    return true;
  }

  if (state.phase === 'LIVE' && state.currentLot) {
    const lot = state.currentLot;
    if (now >= lot.lotEndsAt) {
      finalizeCurrentLot(runtime, false);
      return true;
    }

    const nextBid = getNextValidBid(lot);
    let candidateTeam: Team | null = null;
    let candidateReason = '';
    let earliestReady = Infinity;

    for (const team of state.teams) {
      if (team.controlType !== 'bot') continue;
      const readyAt = runtime.botReadyAt.get(team.id) ?? Infinity;
      if (now < readyAt) continue;

      const eligibility = evaluateTeamBidEligibility(team, lot, state.config, 'LIVE');
      if (!eligibility.canBid) continue;

      const { maxWilling, reason } = computeBotValuation(runtime, team, lot.player);
      if (nextBid <= maxWilling && readyAt < earliestReady) {
        earliestReady = readyAt;
        candidateTeam = team;
        candidateReason = reason;
      }
    }

    if (candidateTeam) {
      const res = handlePlaceBid(runtime, candidateTeam.id, nextBid, 'bot', true, candidateReason);
      if (res.ok) {
        changed = true;
      }
    }
  }

  return changed;
}

export function getFullPlayerPoolSummary(): { total: number; sets: Record<string, number> } {
  const sets: Record<string, number> = {};
  for (const p of REAL_PLAYER_POOL) {
    sets[p.set] = (sets[p.set] ?? 0) + 1;
  }
  return { total: REAL_PLAYER_POOL.length, sets };
}

export { getBidIncrement };
