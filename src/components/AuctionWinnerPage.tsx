import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  ChevronDown,
  ChevronUp,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Settings2,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { apiFetch, type ApiErrorPayload } from '../client/api.ts';
import { playWinnerFanfareSound } from '../client/audio.ts';
import {
  formatLakhsCompact,
  type AuctionRoomState,
  type AuctionWinnerAnalysis,
  type ClientMessage,
} from '../shared/types.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface AuctionWinnerPageProps {
  state: AuctionRoomState;
  clientId: string;
  sessionToken: string;
  muted: boolean;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
  onViewResults: () => void;
}

interface AiAnalysisResponse extends ApiErrorPayload {
  ok: boolean;
  analysis?: AuctionWinnerAnalysis;
}

const CRITERIA_LABELS: { key: keyof AuctionWinnerAnalysis['rankings'][number]['criteria']; label: string; weight: string }[] = [
  { key: 'battingDepth', label: 'Batting Depth', weight: '22%' },
  { key: 'bowlingCoverage', label: 'Bowling Coverage', weight: '22%' },
  { key: 'allRounderBalance', label: 'All-Rounder Balance', weight: '18%' },
  { key: 'wicketkeeperAvailability', label: 'Wicketkeeper', weight: '14%' },
  { key: 'squadDepth', label: 'Squad Depth', weight: '14%' },
  { key: 'remainingPurse', label: 'Purse Efficiency', weight: '10%' },
];

export function AuctionWinnerPage({
  state,
  clientId,
  sessionToken,
  muted,
  onSend,
  onLeave,
  onViewResults,
}: AuctionWinnerPageProps) {
  const [analysis, setAnalysis] = useState<AuctionWinnerAnalysis | null>(state.winnerAnalysis);
  const [loading, setLoading] = useState<boolean>(!state.winnerAnalysis);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(
    state.winnerAnalysis?.winnerTeamId ?? null,
  );
  const [showAllTeamsAnalysis, setShowAllTeamsAnalysis] = useState<boolean>(false);
  const fanfarePlayedRef = useRef(false);

  const me = state.participants.find((p) => p.clientId === clientId);
  const isHost = Boolean(me?.isHost);

  useEffect(() => {
    if (analysis && !fanfarePlayedRef.current) {
      fanfarePlayedRef.current = true;
      playWinnerFanfareSound(muted);
    }
  }, [analysis, muted]);

  useEffect(() => {
    if (state.winnerAnalysis) {
      setAnalysis(state.winnerAnalysis);
      setLoading(false);
      setErrorMsg(null);
      setExpandedTeamId((cur) => cur ?? state.winnerAnalysis?.winnerTeamId ?? null);
    }
  }, [state.winnerAnalysis]);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<AiAnalysisResponse>(
        `/api/rooms/${encodeURIComponent(state.roomCode)}/ai-analysis`,
        {
          method: 'POST',
          body: JSON.stringify({ clientId, sessionToken }),
        },
      );
      if (res.ok && res.data.ok && res.data.analysis) {
        setAnalysis(res.data.analysis);
        setExpandedTeamId(res.data.analysis.winnerTeamId);
      } else {
        setErrorMsg(
          res.data.message || 'AI squad evaluation could not be completed. Please retry.',
        );
      }
    } catch {
      setErrorMsg('Network error while contacting the AI winner analyzer. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [state.roomCode, clientId, sessionToken]);

  useEffect(() => {
    if (!state.winnerAnalysis && state.phase === 'COMPLETED') {
      void runAnalysis();
    }
  }, [state.winnerAnalysis, state.phase, runAnalysis]);

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 shadow-xl">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#CFEAE0]">
            <Sparkles className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />
            Post-Auction AI Prediction · Room {state.roomCode}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
            AI Predicted Winner &amp; Squad Analysis
          </h1>
          <p className="text-xs sm:text-sm text-[#CFEAE0]/80">
            Analyzes each franchise’s completed squad balance, player roles, and remaining budget. Clearly an AI prediction, not a guaranteed result.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onViewResults}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#5B91A3] px-4 py-2.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap"
          >
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            Final Squads Ledger
          </button>
          {isHost && (
            <>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: true })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-3.5 py-2.5 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Rematch
              </button>
              <button
                type="button"
                onClick={() => onSend({ type: 'auction:rematch', keepSettings: false })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-3.5 py-2.5 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D] whitespace-nowrap"
              >
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                New Setup
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-xl border border-[#CFEAE0]/25 px-3.5 py-2.5 text-xs font-semibold text-[#CFEAE0]/85 hover:bg-[#131B2B] whitespace-nowrap"
          >
            Home
          </button>
        </div>
      </div>

      {/* Loading / Error / Results */}
      {loading && (
        <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-10 text-center space-y-3 shadow-xl">
          <Sparkles className="mx-auto h-8 w-8 text-[#CFEAE0] animate-pulse" aria-hidden="true" />
          <h2 className="font-display text-2xl font-bold text-[#CFEAE0]">
            Evaluating All {state.teams.length} Completed Squads...
          </h2>
          <p className="text-xs text-[#CFEAE0]/80 max-w-md mx-auto">
            Scoring Batting Depth, Bowling Coverage, All-Rounder Balance, Wicketkeeper Availability, Squad Depth, and Purse Efficiency on equal rules.
          </p>
        </div>
      )}

      {!loading && errorMsg && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-400/50 bg-[#2F4A63] p-6 sm:p-8 space-y-4 shadow-xl"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-6 w-6 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1.5">
              <h2 className="font-display text-2xl font-bold text-[#CFEAE0]">
                AI Winner Analysis Unavailable
              </h2>
              <p className="text-sm text-[#CFEAE0]/90 leading-relaxed">{errorMsg}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runAnalysis()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-2.5 text-xs font-extrabold text-[#131B2B] hover:bg-[#70A7B9]"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry AI Analysis
            </button>
            <button
              type="button"
              onClick={onViewResults}
              className="rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-4 py-2.5 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D]"
            >
              Inspect Final Squads Anyway
            </button>
          </div>
        </div>
      )}

      {!loading && analysis && (
        <>
          {/* AI Predicted Winner Spotlight Card */}
          {(() => {
            const topEntry = analysis.rankings[0];
            const confidenceLevel = analysis.confidenceLevel ?? 'Moderate';
            const confidencePercent = analysis.confidencePercent ?? 70;
            const confidenceColor =
              confidenceLevel === 'High'
                ? 'text-emerald-300'
                : confidenceLevel === 'Moderate'
                  ? 'text-[#CFEAE0]'
                  : 'text-amber-300';
            const barColor =
              confidenceLevel === 'High'
                ? 'bg-emerald-400'
                : confidenceLevel === 'Moderate'
                  ? 'bg-[#5B91A3]'
                  : 'bg-amber-300';

            return (
              <section className="rounded-2xl border-2 border-[#CFEAE0]/60 bg-[#2F4A63] p-6 sm:p-8 shadow-2xl space-y-5">
                {/* Explicit AI Prediction Notice */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/40 bg-[#131B2B]/90 px-4 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-2 font-bold uppercase tracking-wider text-amber-200">
                    <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    AI Prediction — Not a Guaranteed Result
                  </span>
                  <span className="text-[#CFEAE0]/80">
                    {analysis.predictionDisclaimer ||
                      'AI prediction based on final squad balance, player roles, and remaining budget — not a guaranteed match or tournament result.'}
                  </span>
                </div>

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#131B2B] border border-[#5B91A3]/50 shrink-0">
                      <Trophy className="h-8 w-8 text-[#CFEAE0]" aria-hidden="true" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/85">
                        {analysis.isTie
                          ? 'AI Predicted Joint Contenders (Exact Tie)'
                          : 'AI Predicted Winner (Strongest Overall Squad)'}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <TeamCrest
                          shortCode={analysis.winnerTeamShortCode}
                          color={analysis.winnerTeamColor}
                          size="md"
                        />
                        <h2 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
                          {analysis.winnerTeamName}
                        </h2>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-stretch gap-3 shrink-0">
                    <div className="rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-5 py-3 min-w-[175px] space-y-1.5">
                      <div className="text-[11px] uppercase tracking-wider text-[#CFEAE0]/70">
                        Confidence Level
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`font-display text-2xl font-extrabold ${confidenceColor}`}>
                          {confidenceLevel}
                        </span>
                        <span className="font-mono-num text-base font-bold text-[#CFEAE0]">
                          {confidencePercent}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2F4A63]">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${confidencePercent}%` }}
                        />
                      </div>
                    </div>

                    {topEntry && (
                      <div className="rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-5 py-3 text-center flex flex-col justify-center">
                        <div className="text-[11px] uppercase tracking-wider text-[#CFEAE0]/70">
                          Squad Score
                        </div>
                        <div className="font-mono-num text-3xl font-extrabold text-[#CFEAE0]">
                          {topEntry.overallScore.toFixed(1)}
                          <span className="text-sm font-normal text-[#CFEAE0]/65"> / 100</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[#5B91A3]/35 bg-[#131B2B]/80 p-4 sm:p-5 space-y-4">
                  <div className="space-y-1.5">
                    <div className="font-bold text-base text-[#CFEAE0]">{analysis.headline}</div>
                    <p className="text-sm text-[#CFEAE0]/85 leading-relaxed">{analysis.overallVerdict}</p>
                  </div>

                  {/* Squad Balance, Player Roles, and Spending Breakdown */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="rounded-lg border border-[#5B91A3]/25 bg-[#2F4A63]/45 p-3 space-y-1">
                      <div className="font-bold uppercase tracking-wider text-[#CFEAE0]/80">
                        Squad Balance
                      </div>
                      <p className="text-[#CFEAE0]/90 leading-relaxed">
                        {analysis.balanceSummary ||
                          (topEntry
                            ? `${topEntry.metrics.squadSize} players (${topEntry.metrics.overseasCount}/${state.config.maxOverseas} overseas), avg rating ${topEntry.metrics.avgRating}.`
                            : 'Balanced core across departments.')}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#5B91A3]/25 bg-[#2F4A63]/45 p-3 space-y-1">
                      <div className="font-bold uppercase tracking-wider text-[#CFEAE0]/80">
                        Player Roles
                      </div>
                      <p className="text-[#CFEAE0]/90 leading-relaxed">
                        {analysis.rolesSummary ||
                          (topEntry
                            ? `BAT ${topEntry.metrics.roleCounts.Batter} · BWL ${topEntry.metrics.roleCounts.Bowler} · AR ${topEntry.metrics.roleCounts['All-Rounder']} · WK ${topEntry.metrics.roleCounts.Wicketkeeper}.`
                            : 'Strong coverage across key cricket roles.')}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#5B91A3]/25 bg-[#2F4A63]/45 p-3 space-y-1">
                      <div className="font-bold uppercase tracking-wider text-[#CFEAE0]/80">
                        Spending &amp; Budget
                      </div>
                      <p className="text-[#CFEAE0]/90 leading-relaxed">
                        {analysis.spendingSummary ||
                          (topEntry
                            ? `Spent ${formatLakhsCompact(topEntry.metrics.spentLakhs)} with ${formatLakhsCompact(topEntry.metrics.remainingPurseLakhs)} remaining.`
                            : 'Efficient purse utilization.')}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 text-xs text-[#CFEAE0]/75 border-t border-[#5B91A3]/20 space-y-1">
                    {analysis.confidenceReason && (
                      <div>
                        <strong>Confidence Basis:</strong> {analysis.confidenceReason}
                      </div>
                    )}
                    <div>
                      <strong>Ranking Margin / Tie-Breaker:</strong> {analysis.tieBreakerNote}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-[#CFEAE0]/75">
                  {analysis.criteriaSummary}
                </div>
              </section>
            );
          })()}

          {/* Ranked Leaderboard + Team-by-Team Analysis */}
          <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-5 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-[#CFEAE0]">
                  Ranked Franchise Breakdown ({analysis.rankings.length} Teams)
                </h2>
                <p className="text-xs text-[#CFEAE0]/75">
                  Click any team row to inspect its 6 rubric scores, squad metrics, strengths, and roster gaps.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAllTeamsAnalysis((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/55 bg-[#131B2B] px-3.5 py-2 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D]"
              >
                <Award className="h-3.5 w-3.5" aria-hidden="true" />
                {showAllTeamsAnalysis ? 'Collapse Team Cards' : 'Expand All Team Analyses'}
              </button>
            </div>

            <div className="space-y-3">
              {analysis.rankings.map((entry) => {
                const isExpanded = showAllTeamsAnalysis || expandedTeamId === entry.teamId;
                return (
                  <div
                    key={entry.teamId}
                    className={`rounded-xl border transition-colors ${
                      entry.rank === 1
                        ? 'border-[#CFEAE0]/60 bg-[#131B2B]'
                        : 'border-[#5B91A3]/35 bg-[#131B2B]/90'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedTeamId((cur) => (cur === entry.teamId ? null : entry.teamId))
                      }
                      className="flex w-full flex-wrap items-center justify-between gap-4 p-4 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-lg font-mono-num text-sm font-extrabold shrink-0 ${
                            entry.rank === 1
                              ? 'bg-[#5B91A3] text-[#131B2B]'
                              : 'bg-[#2F4A63] text-[#CFEAE0]'
                          }`}
                        >
                          #{entry.rank}
                        </span>
                        <TeamCrest
                          shortCode={entry.teamShortCode}
                          color={entry.teamColor}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-bold text-sm sm:text-base text-[#CFEAE0]">
                            {entry.teamName}
                          </div>
                          <div className="text-xs text-[#CFEAE0]/70 font-mono-num">
                            {entry.metrics.squadSize} Players ({entry.metrics.metMinSquad ? 'Min Met' : `Below Min ${entry.metrics.minSquadSize}`}) · Left{' '}
                            {formatLakhsCompact(entry.metrics.remainingPurseLakhs)} · Avg Rating {entry.metrics.avgRating}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-[#CFEAE0]/65">Score</div>
                          <div className="font-mono-num text-lg font-extrabold text-[#CFEAE0]">
                            {entry.overallScore.toFixed(1)}
                          </div>
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-[#CFEAE0]/75" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-[#CFEAE0]/75" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[#5B91A3]/25 p-4 sm:p-5 space-y-4">
                        {/* 6 Equal Rubric Bars */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                          {CRITERIA_LABELS.map(({ key, label, weight }) => {
                            const val = entry.criteria[key];
                            return (
                              <div
                                key={key}
                                className="rounded-lg border border-[#5B91A3]/25 bg-[#2F4A63]/45 p-2.5 space-y-1.5"
                              >
                                <div className="flex items-center justify-between text-[11px] text-[#CFEAE0]/80">
                                  <span>{label}</span>
                                  <span className="font-mono-num text-[#CFEAE0]/60">{weight}</span>
                                </div>
                                <div className="font-mono-num text-sm font-bold text-[#CFEAE0]">
                                  {val.toFixed(1)}
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#131B2B]">
                                  <div
                                    className="h-full bg-[#5B91A3]"
                                    style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <p className="text-xs sm:text-sm text-[#CFEAE0]/90 leading-relaxed">
                          {entry.verdict}
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/25 p-3.5 space-y-1.5">
                            <div className="font-bold text-emerald-300">Key Squad Strengths</div>
                            {entry.strengths.length === 0 ? (
                              <div className="text-[#CFEAE0]/70">No notable strengths recorded.</div>
                            ) : (
                              <ul className="list-disc pl-4 space-y-1 text-[#CFEAE0]/90">
                                {entry.strengths.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="rounded-xl border border-amber-300/30 bg-amber-950/20 p-3.5 space-y-1.5">
                            <div className="font-bold text-amber-200">Areas to Watch / Gaps</div>
                            {entry.gaps.length === 0 ? (
                              <div className="text-[#CFEAE0]/70">No major structural gaps identified.</div>
                            ) : (
                              <ul className="list-disc pl-4 space-y-1 text-[#CFEAE0]/90">
                                {entry.gaps.map((g, i) => (
                                  <li key={i}>{g}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
