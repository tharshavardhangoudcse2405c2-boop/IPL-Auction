export type GameMode = 'online' | 'solo' | 'local';
export type BotDifficulty = 'easy' | 'medium' | 'hard';
export type PlayerRole = 'Batter' | 'Bowler' | 'All-Rounder' | 'Wicketkeeper';
export type TacticalRole =
  | 'Opening Batter'
  | 'Top/Middle Batter'
  | 'Finisher'
  | 'Powerplay Pacer'
  | 'Death Bowler'
  | 'Wrist Spinner'
  | 'Finger Spinner'
  | 'Pace All-Rounder'
  | 'Spin All-Rounder'
  | 'Wicketkeeper-Batter';

export type PlayerSet = 'Marquee' | 'Batters' | 'All-Rounders' | 'Wicketkeepers' | 'Bowlers';
export type PoolPreset = 'quick_25' | 'standard_40' | 'mega_60' | 'full_pool';

export type RoomPhase = 'LOBBY' | 'LIVE' | 'PAUSED' | 'LOT_RESULT' | 'COMPLETED';

export interface PlayerStats {
  matches: number | null;
  runs: number | null;
  strikeRate: number | null;
  average: number | null;
  wickets: number | null;
  economy: number | null;
}

export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  tacticalRole: TacticalRole;
  set: PlayerSet;
  nationality: string;
  isOverseas: boolean;
  age: number | null;
  basePrice: number; // in Lakhs (100 Lakhs = 1 Crore)
  battingStyle: string;
  bowlingStyle: string;
  stats: PlayerStats;
  rating: number; // 65–97 scouting index
  specialty: string;
  wikiSlug?: string;
  photoUrl?: string;
}

export interface AcquiredPlayer {
  player: Player;
  soldPrice: number; // in Lakhs
  soldAt: number;
}

export interface RoleRequirements {
  Batter: number;
  Bowler: number;
  'All-Rounder': number;
  Wicketkeeper: number;
}

export interface AuctionConfig {
  mode: GameMode;
  teamCount: number; // 2..12
  startingPurse: number; // Default 12000 Lakhs (₹120 Cr)
  minSquadSize: number;
  maxSquadSize: number;
  maxOverseas: number;
  timerSeconds: number; // e.g., 10, 15, 20, 30
  antiSnipeSeconds: number; // e.g., 5
  botDifficulty: BotDifficulty;
  poolPreset: PoolPreset;
  enabledSets: PlayerSet[];
  roleRequirements: RoleRequirements;
}

export interface Team {
  id: string;
  name: string;
  shortCode: string;
  color: string;
  accentColor: string;
  controlType: 'human' | 'bot';
  ownerClientId: string | null;
  ownerName: string | null;
  purse: number; // remaining in Lakhs
  startingPurse: number;
  squad: AcquiredPlayer[];
  isReady: boolean;
}

export interface BidEntry {
  id: string;
  teamId: string;
  teamName: string;
  teamShortCode: string;
  teamColor: string;
  amount: number; // in Lakhs
  timestamp: number;
  isBot: boolean;
  botReason?: string;
}

export interface AuctionEvent {
  id: string;
  type: 'info' | 'bid' | 'sold' | 'unsold' | 'pause' | 'resume' | 'reauction' | 'system';
  message: string;
  timestamp: number;
  teamColor?: string;
}

export interface CurrentLot {
  player: Player;
  lotNumber: number;
  totalLots: number;
  currentBid: number; // 0 when no bid yet
  leadingTeamId: string | null;
  bidHistory: BidEntry[];
  lotEndsAt: number; // epoch ms when timer expires (while LIVE)
  remainingMsWhenPaused: number | null;
  openedAt: number;
}

export interface LotOutcome {
  player: Player;
  status: 'SOLD' | 'UNSOLD';
  soldPrice: number;
  winningTeamId: string | null;
  winningTeamName: string | null;
  winningTeamColor: string | null;
  winningTeamShortCode: string | null;
  timestamp: number;
}

export interface Participant {
  clientId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  teamId: string | null;
  isReady: boolean;
  joinedAt: number;
}

export interface TeamCriteriaScores {
  battingDepth: number;
  bowlingCoverage: number;
  allRounderBalance: number;
  wicketkeeperAvailability: number;
  squadDepth: number;
  remainingPurse: number;
}

export interface TeamAnalysisMetrics {
  squadSize: number;
  minSquadSize: number;
  metMinSquad: boolean;
  overseasCount: number;
  spentLakhs: number;
  remainingPurseLakhs: number;
  avgRating: number;
  roleCounts: RoleRequirements;
}

export interface TeamAnalysisEntry {
  rank: number;
  teamId: string;
  teamName: string;
  teamShortCode: string;
  teamColor: string;
  controlType: 'human' | 'bot';
  ownerName: string | null;
  overallScore: number;
  criteria: TeamCriteriaScores;
  metrics: TeamAnalysisMetrics;
  strengths: string[];
  gaps: string[];
  verdict: string;
}

export type ConfidenceLevel = 'High' | 'Moderate' | 'Low';

export interface AuctionWinnerAnalysis {
  roomCode: string;
  generatedAt: number;
  model: string;
  winnerTeamId: string;
  winnerTeamName: string;
  winnerTeamShortCode: string;
  winnerTeamColor: string;
  confidenceLevel: ConfidenceLevel;
  confidencePercent: number;
  confidenceReason: string;
  balanceSummary: string;
  rolesSummary: string;
  spendingSummary: string;
  predictionDisclaimer: string;
  isTie: boolean;
  tieBreakerNote: string;
  headline: string;
  overallVerdict: string;
  criteriaSummary: string;
  rankings: TeamAnalysisEntry[];
}

export interface AuctionRoomState {
  roomCode: string;
  phase: RoomPhase;
  config: AuctionConfig;
  teams: Team[];
  participants: Participant[];
  playerQueue: Player[];
  unsoldPool: Player[];
  soldHistory: LotOutcome[];
  currentLot: CurrentLot | null;
  lastOutcome: LotOutcome | null;
  eventLog: AuctionEvent[];
  winnerAnalysis: AuctionWinnerAnalysis | null;
  serverTime: number;
  createdAt: number;
}

export interface FranchiseTemplate {
  id: string;
  name: string;
  shortCode: string;
  color: string;
  accentColor: string;
  city: string;
}

export const MIN_PLAYER_RESERVE_LAKHS = 30;

export function formatLakhs(lakhs: number): string {
  if (lakhs <= 0) return '₹0';
  if (lakhs >= 100) {
    const cr = lakhs / 100;
    const formatted = Number.isInteger(cr) ? cr.toFixed(0) : cr.toFixed(2).replace(/\.?0+$/, '');
    return `₹${formatted} Cr`;
  }
  return `₹${lakhs} L`;
}

export function formatLakhsCompact(lakhs: number): string {
  if (lakhs <= 0) return '₹0';
  if (lakhs >= 100) {
    const cr = lakhs / 100;
    return `₹${cr.toFixed(2)} Cr`;
  }
  return `₹${lakhs} L`;
}

export function getBidIncrement(currentBidLakhs: number): number {
  if (currentBidLakhs < 100) return 10;
  if (currentBidLakhs < 200) return 20;
  if (currentBidLakhs < 500) return 25;
  if (currentBidLakhs < 1000) return 50;
  return 100;
}

export function getNextValidBid(lot: CurrentLot): number {
  if (lot.currentBid === 0 || !lot.leadingTeamId) {
    return lot.player.basePrice;
  }
  return lot.currentBid + getBidIncrement(lot.currentBid);
}

export function getTeamRoleCounts(team: Team): RoleRequirements {
  const counts: RoleRequirements = {
    Batter: 0,
    Bowler: 0,
    'All-Rounder': 0,
    Wicketkeeper: 0,
  };
  for (const item of team.squad) {
    counts[item.player.role] += 1;
  }
  return counts;
}

export interface TacticalCounts {
  openers: number;
  middleFinishers: number;
  deathBowlers: number;
  powerplayPacers: number;
  spinners: number;
  allRounders: number;
  keepers: number;
}

export function getTeamTacticalCounts(team: Team): TacticalCounts {
  const counts: TacticalCounts = {
    openers: 0,
    middleFinishers: 0,
    deathBowlers: 0,
    powerplayPacers: 0,
    spinners: 0,
    allRounders: 0,
    keepers: 0,
  };
  for (const { player } of team.squad) {
    switch (player.tacticalRole) {
      case 'Opening Batter':
        counts.openers += 1;
        break;
      case 'Top/Middle Batter':
      case 'Finisher':
        counts.middleFinishers += 1;
        break;
      case 'Death Bowler':
        counts.deathBowlers += 1;
        break;
      case 'Powerplay Pacer':
        counts.powerplayPacers += 1;
        break;
      case 'Wrist Spinner':
      case 'Finger Spinner':
        counts.spinners += 1;
        break;
      case 'Pace All-Rounder':
      case 'Spin All-Rounder':
        counts.allRounders += 1;
        break;
      case 'Wicketkeeper-Batter':
        counts.keepers += 1;
        break;
    }
  }
  return counts;
}

export function getTeamOverseasCount(team: Team): number {
  return team.squad.filter((item) => item.player.isOverseas).length;
}

export function getMaxAffordableBid(team: Team, config: AuctionConfig): number {
  const slotsLeftForMin = Math.max(0, config.minSquadSize - team.squad.length - 1);
  const reserveNeeded = slotsLeftForMin * MIN_PLAYER_RESERVE_LAKHS;
  return Math.max(0, team.purse - reserveNeeded);
}

export interface BidEligibility {
  canBid: boolean;
  reason: string | null;
  nextBid: number;
  maxAffordable: number;
}

export function evaluateTeamBidEligibility(
  team: Team,
  lot: CurrentLot | null,
  config: AuctionConfig,
  phase: RoomPhase,
): BidEligibility {
  if (!lot || phase !== 'LIVE') {
    return { canBid: false, reason: phase === 'PAUSED' ? 'Paused' : 'Lot closed', nextBid: 0, maxAffordable: 0 };
  }

  const nextBid = getNextValidBid(lot);
  const maxAffordable = getMaxAffordableBid(team, config);

  if (lot.leadingTeamId === team.id) {
    return { canBid: false, reason: 'Leading bid', nextBid, maxAffordable };
  }
  if (team.squad.length >= config.maxSquadSize) {
    return { canBid: false, reason: 'Squad full', nextBid, maxAffordable };
  }
  if (lot.player.isOverseas && getTeamOverseasCount(team) >= config.maxOverseas) {
    return { canBid: false, reason: 'Overseas limit', nextBid, maxAffordable };
  }
  if (team.purse < nextBid) {
    return { canBid: false, reason: 'Insufficient purse', nextBid, maxAffordable };
  }
  if (nextBid > maxAffordable) {
    return {
      canBid: false,
      reason: `Reserve ₹${((team.purse - maxAffordable) / 100).toFixed(2)} Cr for min squad`,
      nextBid,
      maxAffordable,
    };
  }

  return { canBid: true, reason: null, nextBid, maxAffordable };
}

export interface VoicePeerState {
  clientId: string;
  name: string;
  teamShortCode: string | null;
  joined: boolean;
  micActive: boolean;
  speaking: boolean;
}

export type VoiceSignalPayload =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | {
      kind: 'ice';
      candidate: {
        candidate: string;
        sdpMid?: string | null;
        sdpMLineIndex?: number | null;
        usernameFragment?: string | null;
      };
    };

export type ClientMessage =
  | { type: 'room:create'; clientName: string; clientId: string; sessionToken?: string; config: AuctionConfig; customTeams?: Partial<Team>[] }
  | { type: 'room:join'; roomCode: string; clientName: string; clientId: string; sessionToken?: string }
  | { type: 'room:update_config'; config: Partial<AuctionConfig> }
  | { type: 'room:update_team'; teamId: string; name?: string; shortCode?: string; color?: string; controlType?: 'human' | 'bot' }
  | { type: 'room:claim_team'; teamId: string | null }
  | { type: 'room:fill_bots' }
  | { type: 'room:toggle_ready'; ready: boolean }
  | { type: 'auction:start' }
  | { type: 'auction:bid'; teamId: string; expectedAmount: number }
  | { type: 'auction:pause' }
  | { type: 'auction:resume' }
  | { type: 'auction:extend_timer'; extraSeconds: number }
  | { type: 'auction:hammer_now' }
  | { type: 'auction:skip_lot' }
  | { type: 'auction:undo_bid' }
  | { type: 'auction:reauction_player'; playerId: string }
  | { type: 'auction:next_lot' }
  | { type: 'auction:end_early' }
  | { type: 'auction:rematch'; keepSettings: boolean }
  | { type: 'voice:presence'; joined: boolean; micActive: boolean; speaking: boolean }
  | { type: 'voice:signal'; targetClientId: string; signal: VoiceSignalPayload }
  | { type: 'ping'; clientSentAt?: number };

export type ServerMessage =
  | { type: 'room:joined'; roomCode: string; clientId: string; sessionToken: string; state: AuctionRoomState }
  | { type: 'room:state'; state: AuctionRoomState }
  | { type: 'bid:accepted'; teamId: string; amount: number; lotEndsAt: number; serverTime: number }
  | { type: 'bid:rejected'; reason: string; teamId: string }
  | { type: 'voice:peers'; peers: VoicePeerState[] }
  | { type: 'voice:signal'; fromClientId: string; signal: VoiceSignalPayload }
  | { type: 'room:error'; message: string; code?: string }
  | { type: 'pong'; serverTime: number; clientSentAt?: number };
