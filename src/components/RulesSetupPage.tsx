import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Server, Sparkles, XCircle } from 'lucide-react';
import { apiFetch } from '../client/api.ts';

interface RulesSetupPageProps {
  onNavigate: (path: string) => void;
}

interface HealthSummary {
  geminiConfigured?: boolean;
}

export function RulesSetupPage({ onNavigate }: RulesSetupPageProps) {
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<HealthSummary>('/api/health')
      .then((res) => {
        if (!cancelled && res.ok) {
          setGeminiConfigured(Boolean(res.data.geminiConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) setGeminiConfigured(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#CFEAE0]/80 hover:text-[#CFEAE0]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Home
      </button>

      {/* Auction Rules & Bid Increments */}
      <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-6 shadow-xl">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/80">
            Real Auction 26 Rulebook
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
            Auction Mechanics, AI Evaluation & Deployment Setup
          </h1>
        </div>

        <div className="space-y-3">
          <h2 className="font-display text-xl font-bold text-[#CFEAE0]">
            Tiered IPL-Style Bid Increments
          </h2>
          <p className="text-xs text-[#CFEAE0]/85 leading-relaxed">
            When a player opens with no bids, the first valid bid equals their Base Price. Each subsequent bid increases automatically by the bracket below:
          </p>
          <div className="overflow-hidden rounded-xl border border-[#5B91A3]/35 bg-[#131B2B]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#5B91A3]/25 text-[#CFEAE0]/75">
                <tr>
                  <th className="px-4 py-3 font-semibold">Current Bid Range</th>
                  <th className="px-4 py-3 font-semibold text-right">Next Bid Increment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#5B91A3]/20 font-mono-num">
                <tr>
                  <td className="px-4 py-2.5 text-[#CFEAE0]">Under ₹1.00 Crore</td>
                  <td className="px-4 py-2.5 text-right text-[#5B91A3] font-bold">+₹10 Lakh</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-[#CFEAE0]">₹1.00 Cr to ₹1.99 Cr</td>
                  <td className="px-4 py-2.5 text-right text-[#5B91A3] font-bold">+₹20 Lakh</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-[#CFEAE0]">₹2.00 Cr to ₹4.99 Cr</td>
                  <td className="px-4 py-2.5 text-right text-[#5B91A3] font-bold">+₹25 Lakh</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-[#CFEAE0]">₹5.00 Cr to ₹9.99 Cr</td>
                  <td className="px-4 py-2.5 text-right text-[#5B91A3] font-bold">+₹50 Lakh</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-[#CFEAE0]">₹10.00 Crore and above</td>
                  <td className="px-4 py-2.5 text-right text-[#5B91A3] font-bold">+₹1.00 Crore</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-4 space-y-1.5">
            <div className="font-bold text-[#CFEAE0]">Mandatory Purse Reserve</div>
            <p className="text-[#CFEAE0]/80 leading-relaxed">
              The server reserves ₹30 Lakh for every unfilled mandatory slot below your configured minimum squad size so a franchise cannot lock itself out of completing its squad.
            </p>
          </div>
          <div className="rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-4 space-y-1.5">
            <div className="font-bold text-[#CFEAE0]">Anti-Snipe Synced Clock</div>
            <p className="text-[#CFEAE0]/80 leading-relaxed">
              Non-bidding franchises simply wait for the clock to expire. Valid bids placed inside the final 5 seconds reset the timer to 5 seconds across all clients.
            </p>
          </div>
          <div className="rounded-xl border border-[#5B91A3]/30 bg-[#131B2B] p-4 space-y-1.5">
            <div className="font-bold text-[#CFEAE0]">Seat-Locked Online Bidding</div>
            <p className="text-[#CFEAE0]/80 leading-relaxed">
              In Online Multiplayer, each bid is verified server-side against your connected participant session and claimed franchise—preventing spoofed or rival-team bids.
            </p>
          </div>
        </div>
      </section>

      {/* AI Winner Evaluation Methodology */}
      <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-4 shadow-xl">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/85">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Post-Auction AI Winner Analysis
        </div>
        <h2 className="font-display text-2xl font-bold text-[#CFEAE0]">
          How the Best-Built Squad Is Ranked
        </h2>
        <p className="text-xs text-[#CFEAE0]/85 leading-relaxed">
          Once an auction finishes, Real Auction 26 runs a server-side Gemini AI evaluation using only the drafted players, roles, scout ratings, squad totals, and remaining purses from the completed room. All teams are scored on an identical weighted rubric:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono-num">
          {[
            ['Batting Depth', '22%'],
            ['Bowling Coverage', '22%'],
            ['All-Rounder Balance', '18%'],
            ['Wicketkeeper', '14%'],
            ['Squad Depth', '14%'],
            ['Remaining Purse', '10%'],
          ].map(([label, weight]) => (
            <div key={label} className="rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] p-3 text-center">
              <div className="text-[#CFEAE0] font-bold">{weight}</div>
              <div className="mt-1 text-[11px] font-sans text-[#CFEAE0]/75">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Deployment & Environment Variables Guide */}
      <section className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 space-y-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/85">
              <Server className="h-4 w-4" aria-hidden="true" />
              Production & Hosting Configuration
            </div>
            <h2 className="font-display text-2xl font-bold text-[#CFEAE0]">
              Server Environment Variables
            </h2>
          </div>

          {geminiConfigured !== null && (
            <div className="flex items-center gap-2 rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] px-3.5 py-2 text-xs">
              <span className="font-semibold text-[#CFEAE0]">Gemini AI Analysis:</span>
              {geminiConfigured ? (
                <span className="inline-flex items-center gap-1 font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-bold text-amber-300">
                  <XCircle className="h-4 w-4 text-amber-300" />
                  Needs GEMINI_API_KEY
                </span>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] p-4 text-xs text-[#CFEAE0]/85 space-y-3">
          <div className="font-bold text-[#CFEAE0]">Environment Variables</div>
          <ul className="space-y-1.5 list-disc pl-5 font-mono-num text-[11px]">
            <li>
              <strong className="text-[#CFEAE0]">GEMINI_API_KEY</strong>: Server-side API key required for post-auction AI Winner Analysis.
            </li>
            <li>
              <strong className="text-[#CFEAE0]">APP_URL</strong>: Public deployment URL used for invite links.
            </li>
            <li>
              <strong className="text-[#CFEAE0]">PORT</strong>: HTTP/WebSocket listen port (defaults to <code className="text-[#5B91A3]">3000</code>).
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
