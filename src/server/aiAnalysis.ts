import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  formatLakhsCompact,
  getTeamOverseasCount,
  getTeamRoleCounts,
  getTeamTacticalCounts,
  type AuctionRoomState,
  type AuctionWinnerAnalysis,
  type ConfidenceLevel,
  type Team,
  type TeamAnalysisEntry,
  type TeamAnalysisMetrics,
  type TeamCriteriaScores,
} from '../shared/types.ts';

const MODEL_NAME = 'gemini-4-hydrogen';
const PREDICTION_DISCLAIMER =
  'AI prediction based on final squad balance, player roles, and remaining budget — not a guaranteed match or tournament result.';

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function evaluateTeamRubric(team: Team, state: AuctionRoomState): {
  overallScore: number;
  criteria: TeamCriteriaScores;
  metrics: TeamAnalysisMetrics;
} {
  const { config } = state;
  const roles = getTeamRoleCounts(team);
  const tactical = getTeamTacticalCounts(team);
  const overseasCount = getTeamOverseasCount(team);
  const squadSize = team.squad.length;
  const spentLakhs = team.startingPurse - team.purse;
  const avgRating =
    squadSize > 0
      ? round1(team.squad.reduce((sum, item) => sum + item.player.rating, 0) / squadSize)
      : 0;

  const avgRoleRating = (filterFn: (t: Team['squad'][number]) => boolean): number => {
    const sub = team.squad.filter(filterFn);
    if (sub.length === 0) return 0;
    return sub.reduce((s, item) => s + item.player.rating, 0) / sub.length;
  };

  // 1. Batting Depth (0-100)
  const batReq = Math.max(1, config.roleRequirements.Batter);
  const pureBatters = roles.Batter;
  const wkBatters = roles.Wicketkeeper;
  const battingUnitCount = pureBatters + wkBatters + Math.floor(roles['All-Rounder'] * 0.5);
  const batCoverage = Math.min(1, pureBatters / batReq) * 40;
  const openerBonus = tactical.openers >= 2 ? 15 : tactical.openers === 1 ? 9 : 0;
  const finisherBonus = tactical.middleFinishers >= 2 ? 15 : tactical.middleFinishers === 1 ? 9 : 0;
  const batQuality =
    battingUnitCount > 0
      ? clamp(((avgRoleRating((s) => s.player.role === 'Batter' || s.player.role === 'Wicketkeeper') - 65) / 30) * 30, 0, 30)
      : 0;
  const battingDepth = round1(clamp(batCoverage + openerBonus + finisherBonus + batQuality, 0, 100));

  // 2. Bowling Coverage (0-100)
  const bowlReq = Math.max(1, config.roleRequirements.Bowler);
  const bowlCoverage = Math.min(1, roles.Bowler / bowlReq) * 40;
  const ppBonus = tactical.powerplayPacers >= 1 ? 12 : 0;
  const deathBonus = tactical.deathBowlers >= 1 ? 12 : 0;
  const spinBonus = tactical.spinners >= 1 ? 10 : 0;
  const bowlQuality =
    roles.Bowler > 0
      ? clamp(((avgRoleRating((s) => s.player.role === 'Bowler') - 65) / 30) * 26, 0, 26)
      : 0;
  const bowlingCoverage = round1(clamp(bowlCoverage + ppBonus + deathBonus + spinBonus + bowlQuality, 0, 100));

  // 3. All-Rounder Balance (0-100)
  const arReq = Math.max(1, config.roleRequirements['All-Rounder']);
  const arBase = Math.min(1, roles['All-Rounder'] / arReq) * 55;
  const hasPaceAr = team.squad.some((s) => s.player.tacticalRole === 'Pace All-Rounder');
  const hasSpinAr = team.squad.some((s) => s.player.tacticalRole === 'Spin All-Rounder');
  const arMix = (hasPaceAr ? 12 : 0) + (hasSpinAr ? 12 : 0);
  const arQuality =
    roles['All-Rounder'] > 0
      ? clamp(((avgRoleRating((s) => s.player.role === 'All-Rounder') - 65) / 30) * 21, 0, 21)
      : 0;
  const allRounderBalance = round1(clamp(arBase + arMix + arQuality, 0, 100));

  // 4. Wicketkeeper Availability (0-100)
  const wkReq = Math.max(1, config.roleRequirements.Wicketkeeper);
  const wkBase = roles.Wicketkeeper >= wkReq ? 55 : 0;
  const wkBackup = roles.Wicketkeeper >= wkReq + 1 ? 15 : 0;
  const wkQuality =
    roles.Wicketkeeper > 0
      ? clamp(((avgRoleRating((s) => s.player.role === 'Wicketkeeper') - 65) / 30) * 30, 0, 30)
      : 0;
  const wicketkeeperAvailability = round1(clamp(wkBase + wkBackup + wkQuality, 0, 100));

  // 5. Squad Depth (0-100)
  const metMinSquad = squadSize >= config.minSquadSize;
  const minRatio = Math.min(1, squadSize / Math.max(1, config.minSquadSize));
  const extraDepth =
    metMinSquad && config.maxSquadSize > config.minSquadSize
      ? ((squadSize - config.minSquadSize) / (config.maxSquadSize - config.minSquadSize)) * 20
      : 0;
  const avgSquadQuality = squadSize > 0 ? clamp(((avgRating - 65) / 30) * 25, 0, 25) : 0;
  const minComplianceBonus = metMinSquad ? 15 : 0;
  const squadDepth = round1(clamp(minRatio * 40 + minComplianceBonus + extraDepth + avgSquadQuality, 0, 100));

  // 6. Remaining Purse & Capital Efficiency (0-100)
  // Rewards keeping healthy tactical reserve without wildly underspending an empty squad
  const pursePct = team.startingPurse > 0 ? team.purse / team.startingPurse : 0;
  const spentPct = 1 - pursePct;
  let purseScore = 0;
  if (!metMinSquad) {
    purseScore = clamp(pursePct * 45, 0, 45);
  } else {
    // Sweet spot: 65%-95% purse utilized efficiently with 5%-35% reserve
    const reserveScore = clamp((pursePct / 0.25) * 50, 0, 50);
    const deploymentScore = clamp((spentPct / 0.85) * 50, 0, 50);
    purseScore = reserveScore + deploymentScore;
  }
  const remainingPurse = round1(clamp(purseScore, 0, 100));

  // Weighted composite score
  const overallScore = round1(
    battingDepth * 0.22 +
      bowlingCoverage * 0.22 +
      allRounderBalance * 0.18 +
      wicketkeeperAvailability * 0.14 +
      squadDepth * 0.14 +
      remainingPurse * 0.10,
  );

  return {
    overallScore,
    criteria: {
      battingDepth,
      bowlingCoverage,
      allRounderBalance,
      wicketkeeperAvailability,
      squadDepth,
      remainingPurse,
    },
    metrics: {
      squadSize,
      minSquadSize: config.minSquadSize,
      metMinSquad,
      overseasCount,
      spentLakhs,
      remainingPurseLakhs: team.purse,
      avgRating,
      roleCounts: roles,
    },
  };
}

function computeBaselineConfidence(
  evaluated: { team: Team; overallScore: number; criteria: TeamCriteriaScores; metrics: TeamAnalysisMetrics }[],
  state: AuctionRoomState,
  exactTie: boolean,
): { percent: number; level: ConfidenceLevel; defaultReason: string } {
  const first = evaluated[0];
  const second = evaluated[1];
  if (!first || exactTie) {
    return {
      percent: 50,
      level: 'Low',
      defaultReason: 'Top contenders are tied on rubric score, squad compliance, and purse efficiency.',
    };
  }

  const margin = second ? Math.max(0, first.overallScore - second.overallScore) : 14;
  const roleReqs = state.config.roleRequirements;
  const rolesMet =
    first.metrics.roleCounts.Batter >= roleReqs.Batter &&
    first.metrics.roleCounts.Bowler >= roleReqs.Bowler &&
    first.metrics.roleCounts['All-Rounder'] >= roleReqs['All-Rounder'] &&
    first.metrics.roleCounts.Wicketkeeper >= roleReqs.Wicketkeeper;

  let raw = 56 + Math.min(26, margin * 2.1);
  if (first.metrics.metMinSquad) raw += 6;
  else raw -= 10;
  if (rolesMet) raw += 5;
  else raw -= 6;

  const percent = Math.round(clamp(raw, 48, 93));
  const level: ConfidenceLevel = percent >= 78 ? 'High' : percent >= 63 ? 'Moderate' : 'Low';
  const marginText = second
    ? `${margin.toFixed(1)}-point lead over ${second.team.name}`
    : 'clear lead on overall squad construction';
  const quotaText =
    first.metrics.metMinSquad && rolesMet
      ? 'with minimum squad size and all role quotas fulfilled'
      : 'with minor roster quota gaps remaining';

  return {
    percent,
    level,
    defaultReason: `${level} confidence based on a ${marginText} ${quotaText}.`,
  };
}

function compareTeamsDeterministic(
  a: { team: Team; overallScore: number; criteria: TeamCriteriaScores; metrics: TeamAnalysisMetrics },
  b: { team: Team; overallScore: number; criteria: TeamCriteriaScores; metrics: TeamAnalysisMetrics },
): number {
  if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
  if (b.metrics.metMinSquad !== a.metrics.metMinSquad) return b.metrics.metMinSquad ? 1 : -1;
  const bBowlAr = b.criteria.bowlingCoverage + b.criteria.allRounderBalance;
  const aBowlAr = a.criteria.bowlingCoverage + a.criteria.allRounderBalance;
  if (bBowlAr !== aBowlAr) return bBowlAr - aBowlAr;
  if (b.metrics.remainingPurseLakhs !== a.metrics.remainingPurseLakhs) {
    return b.metrics.remainingPurseLakhs - a.metrics.remainingPurseLakhs;
  }
  return a.team.id.localeCompare(b.team.id);
}

export async function generateAuctionWinnerAnalysis(state: AuctionRoomState): Promise<{
  ok: true;
  analysis: AuctionWinnerAnalysis;
} | {
  ok: false;
  status: number;
  code: string;
  message: string;
}> {
  if (state.phase !== 'COMPLETED') {
    return {
      ok: false,
      status: 400,
      code: 'AUCTION_NOT_COMPLETED',
      message: 'AI winner analysis is only available after the auction finishes.',
    };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      ok: false,
      status: 503,
      code: 'GEMINI_KEY_MISSING',
      message:
        'GEMINI_API_KEY is not configured on the server. Add GEMINI_API_KEY in Render environment variables (or Settings > Secrets) and retry.',
    };
  }

  const evaluated = state.teams.map((team) => ({
    team,
    ...evaluateTeamRubric(team, state),
  }));

  evaluated.sort(compareTeamsDeterministic);

  const first = evaluated[0];
  const second = evaluated[1];
  const exactTie =
    Boolean(second) &&
    first.overallScore === second.overallScore &&
    first.metrics.metMinSquad === second.metrics.metMinSquad &&
    first.criteria.bowlingCoverage + first.criteria.allRounderBalance ===
      second.criteria.bowlingCoverage + second.criteria.allRounderBalance &&
    first.metrics.remainingPurseLakhs === second.metrics.remainingPurseLakhs;

  const scoreTieResolvedByTieBreaker =
    Boolean(second) && !exactTie && first.overallScore === second.overallScore;

  const teamPayload = evaluated.map((entry, idx) => ({
    rank: idx + 1,
    teamId: entry.team.id,
    teamName: entry.team.name,
    shortCode: entry.team.shortCode,
    controlType: entry.team.controlType,
    overallScore: entry.overallScore,
    criteriaScores: entry.criteria,
    squadCount: entry.metrics.squadSize,
    minSquadRequired: entry.metrics.minSquadSize,
    metMinSquad: entry.metrics.metMinSquad,
    overseasCount: entry.metrics.overseasCount,
    maxOverseasAllowed: state.config.maxOverseas,
    remainingPurse: formatLakhsCompact(entry.metrics.remainingPurseLakhs),
    spentPurse: formatLakhsCompact(entry.metrics.spentLakhs),
    avgScoutRating: entry.metrics.avgRating,
    roleCounts: entry.metrics.roleCounts,
    roleMinimumsRequired: state.config.roleRequirements,
    signedPlayers: entry.team.squad.map((s) => ({
      name: s.player.name,
      role: s.player.role,
      tacticalRole: s.player.tacticalRole,
      nationality: s.player.nationality,
      isOverseas: s.player.isOverseas,
      rating: s.player.rating,
      soldPrice: formatLakhsCompact(s.soldPrice),
    })),
  }));

  const tieContext = exactTie
    ? `Exact tie between ${first.team.name} and ${second.team.name} on composite score (${first.overallScore}), minimum squad compliance, bowling+all-rounder balance, and remaining purse.`
    : scoreTieResolvedByTieBreaker
      ? `Composite score tie at ${first.overallScore} resolved deterministically via tie-breaker order: (1) minimum squad size compliance, (2) combined bowling coverage + all-rounder balance, (3) remaining purse.`
      : `Clear composite score lead (${first.overallScore}${second ? ` vs runner-up ${second.overallScore}` : ''}).`;

  const baselineConfidence = computeBaselineConfidence(evaluated, state, exactTie);

  const prompt = [
    'You are an impartial cricket auction analyst evaluating the FINAL SQUADS and REMAINING BUDGETS at the end of a completed Real Auction 26 session.',
    'Analyze every team’s final squad, player roles, tactical balance, spending, and remaining purse, then recommend the strongest overall team (#1 ranked) as the AI-predicted winner.',
    'Keep it grounded strictly in the auction data supplied below. Do NOT invent player stats or guarantee match results.',
    '',
    'Scoring rubric applied equally to all teams (0–100):',
    '- Batting Depth (22%), Bowling Coverage (22%), All-Rounder Balance (18%), Wicketkeeper Availability (14%), Squad Depth (14%), Remaining Purse Efficiency (10%).',
    `Baseline confidence anchor: ${baselineConfidence.level} (${baselineConfidence.percent}%) — ${baselineConfidence.defaultReason}`,
    `Tie status: ${tieContext}`,
    '',
    `Auction Room ${state.roomCode} Data:`,
    JSON.stringify(teamPayload),
  ].join('\n');

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction:
          'Return concise, accurate JSON recommending the #1 team as an AI prediction (never a guarantee). Explicitly explain why they lead based on squad balance, player roles, and spending vs remaining budget using actual signed players and purse numbers from the payload.',
        responseMimeType: 'application/json',
        seed: 42,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: {
              type: Type.STRING,
              description: 'Short headline recommending the predicted winning team.',
            },
            overallVerdict: {
              type: Type.STRING,
              description:
                '2-3 concise sentences explaining the prediction based on squad balance, player roles, and spending/remaining budget.',
            },
            confidencePercent: {
              type: Type.INTEGER,
              description: 'Calibrated prediction confidence percentage between 45 and 95 (never 100).',
            },
            confidenceReason: {
              type: Type.STRING,
              description: 'One short sentence explaining the confidence level.',
            },
            balanceSummary: {
              type: Type.STRING,
              description: 'One concise sentence on the predicted winner’s squad balance and depth.',
            },
            rolesSummary: {
              type: Type.STRING,
              description: 'One concise sentence on batters, bowlers, all-rounders, and wicketkeeper coverage.',
            },
            spendingSummary: {
              type: Type.STRING,
              description: 'One concise sentence on purse spent, value buys, and remaining budget.',
            },
            tieBreakerNote: {
              type: Type.STRING,
              description: 'Clear explanation of margin or tie-breaker outcome.',
            },
            teamAnalyses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  teamId: { type: Type.STRING },
                  strengths: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  gaps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  verdict: { type: Type.STRING },
                },
                required: ['teamId', 'strengths', 'gaps', 'verdict'],
              },
            },
          },
          required: [
            'headline',
            'overallVerdict',
            'confidencePercent',
            'confidenceReason',
            'balanceSummary',
            'rolesSummary',
            'spendingSummary',
            'tieBreakerNote',
            'teamAnalyses',
          ],
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      return {
        ok: false,
        status: 502,
        code: 'AI_EMPTY_RESPONSE',
        message: 'Gemini returned an empty evaluation. Please retry.',
      };
    }

    const parsed = JSON.parse(rawText) as {
      headline: string;
      overallVerdict: string;
      confidencePercent: number;
      confidenceReason: string;
      balanceSummary: string;
      rolesSummary: string;
      spendingSummary: string;
      tieBreakerNote: string;
      teamAnalyses: { teamId: string; strengths: string[]; gaps: string[]; verdict: string }[];
    };

    const byTeamId = new Map(parsed.teamAnalyses.map((item) => [item.teamId, item]));
    const rankings: TeamAnalysisEntry[] = evaluated.map((entry, idx) => {
      const aiTeam = byTeamId.get(entry.team.id);
      if (!aiTeam) {
        throw new Error(`Missing AI analysis entry for team ${entry.team.id}`);
      }
      return {
        rank: idx + 1,
        teamId: entry.team.id,
        teamName: entry.team.name,
        teamShortCode: entry.team.shortCode,
        teamColor: entry.team.color,
        controlType: entry.team.controlType,
        ownerName: entry.team.ownerName,
        overallScore: entry.overallScore,
        criteria: entry.criteria,
        metrics: entry.metrics,
        strengths: aiTeam.strengths.slice(0, 4),
        gaps: aiTeam.gaps.slice(0, 4),
        verdict: aiTeam.verdict,
      };
    });

    const aiPct = Number.isFinite(parsed.confidencePercent)
      ? clamp(Math.round(parsed.confidencePercent), 45, 95)
      : baselineConfidence.percent;
    const blendedPct = exactTie
      ? 50
      : Math.round(clamp(aiPct * 0.4 + baselineConfidence.percent * 0.6, 48, 94));
    const confidenceLevel: ConfidenceLevel = exactTie
      ? 'Low'
      : blendedPct >= 78
        ? 'High'
        : blendedPct >= 63
          ? 'Moderate'
          : 'Low';

    const r = first.metrics.roleCounts;
    const fallbackBalance = `${first.metrics.squadSize} players signed (${first.metrics.overseasCount}/${state.config.maxOverseas} overseas) with avg rating ${first.metrics.avgRating}.`;
    const fallbackRoles = `${r.Batter} Batters, ${r.Bowler} Bowlers, ${r['All-Rounder']} All-Rounders, and ${r.Wicketkeeper} Wicketkeepers.`;
    const fallbackSpending = `Spent ${formatLakhsCompact(first.metrics.spentLakhs)} with ${formatLakhsCompact(first.metrics.remainingPurseLakhs)} remaining in budget.`;

    const analysis: AuctionWinnerAnalysis = {
      roomCode: state.roomCode,
      generatedAt: Date.now(),
      model: MODEL_NAME,
      winnerTeamId: first.team.id,
      winnerTeamName: first.team.name,
      winnerTeamShortCode: first.team.shortCode,
      winnerTeamColor: first.team.color,
      confidenceLevel,
      confidencePercent: blendedPct,
      confidenceReason: parsed.confidenceReason?.trim() || baselineConfidence.defaultReason,
      balanceSummary: parsed.balanceSummary?.trim() || fallbackBalance,
      rolesSummary: parsed.rolesSummary?.trim() || fallbackRoles,
      spendingSummary: parsed.spendingSummary?.trim() || fallbackSpending,
      predictionDisclaimer: PREDICTION_DISCLAIMER,
      isTie: exactTie,
      tieBreakerNote: parsed.tieBreakerNote || tieContext,
      headline: parsed.headline,
      overallVerdict: parsed.overallVerdict,
      criteriaSummary:
        'Evaluated identically across Batting Depth (22%), Bowling Coverage (22%), All-Rounder Balance (18%), Wicketkeeper Availability (14%), Squad Depth (14%), and Remaining Purse Efficiency (10%).',
      rankings,
    };

    return { ok: true, analysis };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Gemini AI winner analysis failed:', msg);
    if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      return {
        ok: false,
        status: 429,
        code: 'AI_RATE_LIMITED',
        message: 'Gemini AI quota temporarily reached. Please wait a moment and retry.',
      };
    }
    if (msg.includes('403') || msg.includes('400') || msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
      return {
        ok: false,
        status: 502,
        code: 'GEMINI_KEY_INVALID',
        message: 'Gemini API key was rejected. Verify GEMINI_API_KEY in server settings and retry.',
      };
    }
    return {
      ok: false,
      status: 502,
      code: 'AI_UNAVAILABLE',
      message: 'AI winner analysis is temporarily unavailable. Please retry in a few seconds.',
    };
  }
}
