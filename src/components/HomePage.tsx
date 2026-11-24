import { ArrowRight, Globe, Play } from 'lucide-react';
import { REAL_PLAYER_POOL } from '../shared/data.ts';
import type { AuctionRoomState } from '../shared/types.ts';

interface HomePageProps {
  activeRoom: AuctionRoomState | null;
  onNavigate: (path: string) => void;
}

export function HomePage({ activeRoom, onNavigate }: HomePageProps) {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Active Room Resume Banner if user already has an active room */}
      {activeRoom && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[#5B91A3]/60 bg-[#2F4A63] p-5 shadow-lg">
          <div className="space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]">
              Active Auction Session · Room {activeRoom.roomCode}
            </div>
            <div className="text-sm text-[#CFEAE0]/85">
              Phase: <strong className="text-[#CFEAE0]">{activeRoom.phase}</strong> · {activeRoom.teams.length} Franchises ·{' '}
              {activeRoom.soldHistory.length} Sold
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              onNavigate(
                activeRoom.phase === 'COMPLETED'
                  ? `/room/${activeRoom.roomCode}/winner`
                  : `/room/${activeRoom.roomCode}`,
              )
            }
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-2.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] whitespace-nowrap shrink-0"
          >
            Resume Room {activeRoom.roomCode}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Unified Hero Showcase: Auction Hall Image + Description + 2 Primary Actions */}
      <section className="relative overflow-hidden rounded-2xl border border-[#5B91A3]/40 bg-[#131B2B] shadow-2xl min-h-[500px] sm:min-h-[560px] lg:min-h-[600px] flex flex-col justify-end">
        <img
          src="/assets/aistudio/Gemini_Generated_Image_49qvl149qvl149qv_7e38d83f.png"
          alt="Real Auction 26 live franchise auction hall"
          className="absolute inset-0 h-full w-full object-cover object-center"
        />

        {/* Measured directional gradient scrims for crisp WCAG AA contrast over photography */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#131B2B]/95 via-[#131B2B]/75 to-[#131B2B]/25"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden lg:block bg-gradient-to-r from-[#131B2B]/95 via-[#131B2B]/70 to-transparent"
        />

        <div className="relative z-10 max-w-2xl p-6 sm:p-10 lg:p-14 space-y-5">
          <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]">
            2–12 Franchises · ₹120 Crore Purse · {REAL_PLAYER_POOL.length} 2026 IPL Auction Players
          </div>

          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#CFEAE0] leading-[1.02] [text-wrap:balance]">
            Command the Gavel. Build Your Championship XI.
          </h1>

          <p className="max-w-xl text-base text-[#CFEAE0]/90 leading-relaxed">
            Launch an IPL-style franchise auction instantly across online multiplayer rooms, solo battles against strategic AI bots, or open shared-screen tables — concluding with an AI post-auction winner evaluation.
          </p>

          <div className="pt-2 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/create')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#5B91A3] px-6 py-3.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] transition-colors whitespace-nowrap shrink-0 shadow-lg"
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
              Create Auction Room
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/join')}
              className="inline-flex items-center gap-2 rounded-xl border border-[#5B91A3]/70 bg-[#131B2B]/90 px-6 py-3.5 text-sm font-bold text-[#CFEAE0] hover:bg-[#1B293D] transition-colors whitespace-nowrap shrink-0 backdrop-blur-sm"
            >
              <Globe className="h-4 w-4" aria-hidden="true" />
              Join With Room Code
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
