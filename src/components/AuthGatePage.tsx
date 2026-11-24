import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Mail,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch, type ApiErrorPayload } from '../client/api.ts';
import type { AuthChannel, AuthProvidersStatus, AuthUser } from '../shared/types.ts';

interface AuthGatePageProps {
  providers: AuthProvidersStatus;
  onAuthenticated: (user: AuthUser) => void;
}

interface RequestOtpResponse extends ApiErrorPayload {
  ok: boolean;
  channel?: AuthChannel;
  maskedTarget?: string;
  expiresInSeconds?: number;
  resendAfterSeconds?: number;
}

interface VerifyOtpResponse extends ApiErrorPayload {
  ok: boolean;
  user?: AuthUser;
}

const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'US / Canada (+1)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+64', label: 'New Zealand (+64)' },
  { code: '+27', label: 'South Africa (+27)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+880', label: 'Bangladesh (+880)' },
  { code: '+92', label: 'Pakistan (+92)' },
  { code: 'OTHER', label: 'Other (+code)' },
] as const;

export function AuthGatePage({ providers, onAuthenticated }: AuthGatePageProps) {
  const [channel, setChannel] = useState<AuthChannel>(() =>
    !providers.email && providers.sms ? 'phone' : 'email',
  );
  const [step, setStep] = useState<'request' | 'verify'>('request');

  const [emailInput, setEmailInput] = useState('');
  const [countryPreset, setCountryPreset] = useState('+91');
  const [customDialCode, setCustomDialCode] = useState('+');
  const [phoneLocal, setPhoneLocal] = useState('');

  const [otpCode, setOtpCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [maskedTarget, setMaskedTarget] = useState('');
  const [submittedTarget, setSubmittedTarget] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const buildTargetString = (): string => {
    if (channel === 'email') {
      return emailInput.trim();
    }
    const localDigits = phoneLocal.trim();
    if (localDigits.startsWith('+')) {
      return localDigits.replace(/[\s\-().]/g, '');
    }
    const prefix = countryPreset === 'OTHER' ? customDialCode.trim() : countryPreset;
    const normalizedPrefix = prefix.startsWith('+') ? prefix : `+${prefix}`;
    return `${normalizedPrefix}${localDigits}`.replace(/[\s\-().]/g, '');
  };

  const isCoreReady = providers.database && providers.authSecret;
  const isSelectedProviderReady = channel === 'email' ? providers.email : providers.sms;

  const handleChannelSwitch = (next: AuthChannel) => {
    setChannel(next);
    setStep('request');
    setOtpCode('');
    setErrorMsg(null);
    setInfoMsg(null);
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const target = step === 'verify' && submittedTarget ? submittedTarget : buildTargetString();
    if (!target) {
      setErrorMsg(
        channel === 'email'
          ? 'Enter your email address to receive a login code.'
          : 'Enter your mobile number with country code to receive an SMS code.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<RequestOtpResponse>('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ channel, target }),
      });

      if (res.ok && res.data.ok) {
        setSubmittedTarget(target);
        setMaskedTarget(res.data.maskedTarget || target);
        setStep('verify');
        setOtpCode('');
        setResendCooldown(res.data.resendAfterSeconds ?? 45);
        setInfoMsg(
          channel === 'email'
            ? `A 6-digit verification code was sent to ${res.data.maskedTarget || target}.`
            : `A 6-digit verification code was sent by SMS to ${res.data.maskedTarget || target}.`,
        );
      } else {
        if (typeof res.data.retryAfterSeconds === 'number' && res.data.retryAfterSeconds > 0) {
          setResendCooldown(res.data.retryAfterSeconds);
        }
        setErrorMsg(res.data.message || 'Unable to send verification code. Please check your input.');
      }
    } catch {
      setErrorMsg('Network error while requesting a verification code. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const code = otpCode.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) {
      setErrorMsg('Enter the exact 6-digit numeric code sent to you.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<VerifyOtpResponse>('/api/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          target: submittedTarget,
          code,
          displayName: displayName.trim() || undefined,
        }),
      });

      if (res.ok && res.data.ok && res.data.user) {
        onAuthenticated(res.data.user);
      } else {
        setErrorMsg(res.data.message || 'Verification failed. Check the code and try again.');
      }
    } catch {
      setErrorMsg('Network error while verifying your code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#131B2B] text-[#CFEAE0] flex flex-col">
      <header className="border-b border-[#5B91A3]/30 bg-[#1B273B]">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6">
          <div className="font-display text-2xl font-extrabold tracking-tight text-[#CFEAE0]">
            Real Auction 26
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#CFEAE0]/80">
            <ShieldCheck className="h-4 w-4 text-[#5B91A3]" aria-hidden="true" />
            Verified Access
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-md space-y-5">
          <div className="rounded-2xl border border-[#5B91A3]/40 bg-[#2F4A63] p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/80">
                Franchise Manager Sign In
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0] leading-tight">
                Sign in to Real Auction 26
              </h1>
              <p className="text-sm text-[#CFEAE0]/85 leading-relaxed">
                Verify with a one-time code via Email or Phone SMS. Your session stays active across page reloads and links directly to your team seat.
              </p>
            </div>

            {!isCoreReady && (
              <div
                role="alert"
                className="rounded-xl border border-amber-400/50 bg-[#131B2B] p-4 text-xs text-amber-100 space-y-1.5"
              >
                <div className="flex items-center gap-2 font-bold text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Server Authentication Setup Required
                </div>
                <p className="leading-relaxed text-[#CFEAE0]/85">
                  Configure <strong className="font-mono-num text-white">{providers.missingDatabaseVars.join(', ')}</strong> in your Render environment variables to enable login and persistent sessions. See <strong className="text-white">AUTH_SETUP.md</strong>.
                </p>
              </div>
            )}

            {/* Channel Toggle */}
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#131B2B] p-1.5 border border-[#5B91A3]/30">
              <button
                type="button"
                onClick={() => handleChannelSwitch('email')}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${
                  channel === 'email'
                    ? 'bg-[#5B91A3] text-[#131B2B]'
                    : 'text-[#CFEAE0]/80 hover:text-[#CFEAE0]'
                }`}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email OTP
              </button>
              <button
                type="button"
                onClick={() => handleChannelSwitch('phone')}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-bold transition-colors ${
                  channel === 'phone'
                    ? 'bg-[#5B91A3] text-[#131B2B]'
                    : 'text-[#CFEAE0]/80 hover:text-[#CFEAE0]'
                }`}
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                Phone SMS OTP
              </button>
            </div>

            {isCoreReady && !isSelectedProviderReady && (
              <div
                role="status"
                className="rounded-xl border border-amber-400/45 bg-[#131B2B] p-3.5 text-xs text-amber-100 space-y-1"
              >
                <div className="font-bold text-amber-300">
                  {channel === 'email' ? 'Email delivery not configured yet' : 'SMS delivery not configured yet'}
                </div>
                <p className="text-[#CFEAE0]/85 leading-relaxed">
                  Add{' '}
                  <strong className="font-mono-num text-white">
                    {(channel === 'email' ? providers.missingEmailVars : providers.missingSmsVars).join(', ')}
                  </strong>{' '}
                  in Render Environment settings to send {channel === 'email' ? 'emails via Resend' : 'SMS via Twilio'}.
                  {channel === 'email' && providers.sms ? ' You can switch to Phone SMS OTP right now.' : ''}
                  {channel === 'phone' && providers.email ? ' You can switch to Email OTP right now.' : ''}
                </p>
              </div>
            )}

            {infoMsg && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl border border-emerald-400/45 bg-[#131B2B] p-3.5 text-xs text-emerald-100"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">{infoMsg}</span>
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-rose-400/50 bg-rose-950/80 p-3.5 text-xs text-rose-100"
              >
                <AlertTriangle className="h-4 w-4 text-rose-300 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">{errorMsg}</span>
              </div>
            )}

            {step === 'request' ? (
              <form onSubmit={(e) => void handleRequestOtp(e)} className="space-y-4">
                {channel === 'email' ? (
                  <label className="block space-y-1.5">
                    <span className="text-xs font-semibold text-[#CFEAE0]">Email Address (Gmail or any inbox)</span>
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-3 text-sm text-[#CFEAE0] placeholder:text-[#CFEAE0]/35 focus:border-[#CFEAE0] focus:outline-none"
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-[#CFEAE0]">Country Code</span>
                      <select
                        value={countryPreset}
                        onChange={(e) => setCountryPreset(e.target.value)}
                        className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-3.5 py-3 text-sm text-[#CFEAE0] focus:border-[#CFEAE0] focus:outline-none"
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {countryPreset === 'OTHER' && (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-semibold text-[#CFEAE0]">Custom Country Code</span>
                        <input
                          type="text"
                          value={customDialCode}
                          onChange={(e) => setCustomDialCode(e.target.value)}
                          placeholder="+60"
                          className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-3 font-mono-num text-sm text-[#CFEAE0] placeholder:text-[#CFEAE0]/35 focus:border-[#CFEAE0] focus:outline-none"
                        />
                      </label>
                    )}

                    <label className="block space-y-1.5">
                      <span className="text-xs font-semibold text-[#CFEAE0]">Mobile Number</span>
                      <input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel-national"
                        required
                        value={phoneLocal}
                        onChange={(e) => setPhoneLocal(e.target.value)}
                        placeholder={countryPreset === '+91' ? '9876543210' : 'Phone digits without leading 0'}
                        className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-3 font-mono-num text-sm text-[#CFEAE0] placeholder:text-[#CFEAE0]/35 focus:border-[#CFEAE0] focus:outline-none"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !isCoreReady || !isSelectedProviderReady}
                  className="w-full rounded-xl bg-[#5B91A3] px-5 py-3.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting
                    ? 'Sending Verification Code...'
                    : channel === 'email'
                      ? 'Send Code to Email'
                      : 'Send Code via SMS'}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void handleVerifyOtp(e)} className="space-y-4">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-[#5B91A3]/35 bg-[#131B2B] px-3.5 py-2.5 text-xs">
                  <span className="text-[#CFEAE0]/80 truncate">
                    Verifying: <strong className="text-[#CFEAE0]">{maskedTarget}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setStep('request');
                      setOtpCode('');
                      setErrorMsg(null);
                      setInfoMsg(null);
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-[#5B91A3] hover:text-[#CFEAE0] shrink-0"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Change
                  </button>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#CFEAE0]">6-Digit Verification Code</span>
                  <div className="relative">
                    <KeyRound
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5B91A3]"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      required
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456"
                      className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] pl-10 pr-4 py-3 font-mono-num text-lg font-bold tracking-[0.3em] text-[#CFEAE0] placeholder:text-[#CFEAE0]/30 focus:border-[#CFEAE0] focus:outline-none"
                    />
                  </div>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-[#CFEAE0]">
                    Manager Display Name <span className="text-[#CFEAE0]/60">(optional)</span>
                  </span>
                  <input
                    type="text"
                    maxLength={32}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Rahul Dravid"
                    className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-2.5 text-sm text-[#CFEAE0] placeholder:text-[#CFEAE0]/35 focus:border-[#CFEAE0] focus:outline-none"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting || otpCode.length !== 6}
                  className="w-full rounded-xl bg-[#5B91A3] px-5 py-3.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Verifying Code...' : 'Verify & Sign In'}
                </button>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <span className="text-[#CFEAE0]/70">Didn&apos;t receive the code?</span>
                  <button
                    type="button"
                    disabled={submitting || resendCooldown > 0}
                    onClick={() => void handleRequestOtp()}
                    className="font-bold text-[#CFEAE0] underline underline-offset-4 hover:text-white disabled:opacity-45 disabled:no-underline"
                  >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
