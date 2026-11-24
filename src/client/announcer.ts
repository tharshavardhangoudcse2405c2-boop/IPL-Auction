import { type LotOutcome, type Player, type TacticalRole } from '../shared/types.ts';

export type AnnouncementKind = 'lot' | 'bid' | 'result';

interface QueuedAnnouncement {
  id: string;
  kind: AnnouncementKind;
  text: string;
  dedupeKey: string;
}

export interface AnnouncerPreferences {
  muted: boolean;
  volume: number; // 0..1
}

export interface AnnouncerStatus {
  supported: boolean;
  muted: boolean;
  volume: number;
  speaking: boolean;
  autoplayBlocked: boolean;
  lastSpokenText: string;
}

const PREFS_STORAGE_KEY = 'ra26_voice_announcer_v1';

const ROLE_SPOKEN_MAP: Record<TacticalRole, string> = {
  'Opening Batter': 'opening batter',
  'Top/Middle Batter': 'top or middle order batter',
  Finisher: 'finisher',
  'Powerplay Pacer': 'powerplay pacer',
  'Death Bowler': 'death bowler',
  'Wrist Spinner': 'wrist spinner',
  'Finger Spinner': 'finger spinner',
  'Pace All-Rounder': 'pace all-rounder',
  'Spin All-Rounder': 'spin all-rounder',
  'Wicketkeeper-Batter': 'wicketkeeper batter',
};

export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance !== 'undefined'
  );
}

export function loadAnnouncerPreferences(): AnnouncerPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { muted: false, volume: 0.9 };
    const parsed = JSON.parse(raw) as Partial<AnnouncerPreferences>;
    const volume =
      typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
        ? Math.max(0, Math.min(1, parsed.volume))
        : 0.9;
    return {
      muted: Boolean(parsed.muted),
      volume,
    };
  } catch {
    return { muted: false, volume: 0.9 };
  }
}

export function saveAnnouncerPreferences(prefs: AnnouncerPreferences): void {
  try {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        muted: Boolean(prefs.muted),
        volume: Math.max(0, Math.min(1, prefs.volume)),
      }),
    );
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function formatAmountForSpeech(lakhs: number): string {
  if (!Number.isFinite(lakhs) || lakhs <= 0) return 'zero';
  if (lakhs >= 100) {
    const cr = lakhs / 100;
    const formatted = Number.isInteger(cr)
      ? cr.toFixed(0)
      : cr.toFixed(2).replace(/\.?0+$/, '');
    return `${formatted} crore`;
  }
  return `${Math.round(lakhs)} lakh`;
}

export function formatPlayerRoleForSpeech(player: Pick<Player, 'role' | 'tacticalRole'>): string {
  return ROLE_SPOKEN_MAP[player.tacticalRole] || player.role.toLowerCase();
}

export function buildNewPlayerAnnouncement(player: Player): string {
  const spokenRole = formatPlayerRoleForSpeech(player);
  return `Next player: ${player.name}, ${spokenRole}.`;
}

export function buildBidAnnouncement(teamName: string, amountLakhs: number): string {
  return `${teamName} bid ${formatAmountForSpeech(amountLakhs)}.`;
}

export function buildLeadChangeAnnouncement(teamName: string, amountLakhs: number): string {
  return `${teamName} now lead at ${formatAmountForSpeech(amountLakhs)}.`;
}

export function buildOutcomeAnnouncement(outcome: LotOutcome): string {
  if (outcome.status === 'SOLD' && outcome.winningTeamName) {
    return `Sold! ${outcome.player.name} to ${outcome.winningTeamName} for ${formatAmountForSpeech(outcome.soldPrice)}.`;
  }
  return `${outcome.player.name} goes unsold.`;
}

function pickBestVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const pool = englishVoices.length > 0 ? englishVoices : voices;

  // Prefer Indian English voices for natural IPL names and "crore"/"lakh" pronunciation
  const langPriority = ['en-in', 'en-gb', 'en-au', 'en-us'];
  for (const prefix of langPriority) {
    const matches = pool.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    if (matches.length > 0) {
      const preferred =
        matches.find((v) => /natural|google|samantha|rishi|neerja|daniel|karen/i.test(v.name)) ||
        matches.find((v) => v.localService) ||
        matches[0];
      if (preferred) return preferred;
    }
  }

  return pool.find((v) => v.default) || pool[0] || null;
}

class AuctionVoiceAnnouncer {
  private queue: QueuedAnnouncement[] = [];
  private currentItem: QueuedAnnouncement | null = null;
  private watchdogTimer: number | null = null;
  private prefs: AnnouncerPreferences = loadAnnouncerPreferences();
  private autoplayBlocked = false;
  private lastSpokenText = '';
  private recentKeys = new Map<string, number>();
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private listeners = new Set<(status: AnnouncerStatus) => void>();
  private voicesBound = false;

  constructor() {
    this.bindVoicesChanged();
  }

  private bindVoicesChanged(): void {
    if (this.voicesBound || !isSpeechSynthesisSupported()) return;
    this.voicesBound = true;
    try {
      this.refreshVoice();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        this.refreshVoice();
      });
    } catch {
      // Ignore browser quirks
    }
  }

  private refreshVoice(): void {
    if (!isSpeechSynthesisSupported()) return;
    try {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        this.cachedVoice = pickBestVoice(voices);
      }
    } catch {
      this.cachedVoice = null;
    }
  }

  subscribe(listener: (status: AnnouncerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus(): AnnouncerStatus {
    return {
      supported: isSpeechSynthesisSupported(),
      muted: this.prefs.muted,
      volume: this.prefs.volume,
      speaking: Boolean(this.currentItem),
      autoplayBlocked: this.autoplayBlocked,
      lastSpokenText: this.lastSpokenText,
    };
  }

  private emitStatus(): void {
    const snap = this.getStatus();
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  setMuted(muted: boolean): void {
    this.prefs = { ...this.prefs, muted };
    saveAnnouncerPreferences(this.prefs);
    if (muted) {
      this.clearAllSpeech();
    } else {
      this.autoplayBlocked = false;
      this.unlockFromGesture();
    }
    this.emitStatus();
  }

  setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.prefs = { ...this.prefs, volume: clamped };
    saveAnnouncerPreferences(this.prefs);
    if (clamped === 0) {
      this.clearAllSpeech();
    }
    this.emitStatus();
  }

  unlockFromGesture(): void {
    if (!isSpeechSynthesisSupported()) return;
    try {
      this.refreshVoice();
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      if (this.autoplayBlocked) {
        this.autoplayBlocked = false;
        this.emitStatus();
      }
      if (!this.prefs.muted && this.prefs.volume > 0 && !this.currentItem && this.queue.length > 0) {
        this.pumpQueue();
      }
    } catch {
      // Ignore browser restrictions
    }
  }

  clearAllSpeech(): void {
    this.queue = [];
    this.currentItem = null;
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (isSpeechSynthesisSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancellation errors
      }
    }
    this.emitStatus();
  }

  enqueue(kind: AnnouncementKind, text: string, dedupeKey: string): void {
    const cleanText = text.trim();
    if (!cleanText) return;

    // Update live accessible transcript even if muted or speech is unsupported
    this.lastSpokenText = cleanText;

    if (!isSpeechSynthesisSupported() || this.prefs.muted || this.prefs.volume <= 0) {
      this.emitStatus();
      return;
    }

    const now = Date.now();
    // Deduplicate identical announcements within a 2.5s window
    const lastTs = this.recentKeys.get(dedupeKey);
    if (lastTs && now - lastTs < 2500) {
      return;
    }
    this.recentKeys.set(dedupeKey, now);
    if (this.recentKeys.size > 120) {
      for (const [k, ts] of this.recentKeys.entries()) {
        if (now - ts > 15000) this.recentKeys.delete(k);
      }
    }

    if (kind === 'result' || kind === 'lot') {
      // Drop any pending unplayed bid announcements from older state so we never speak stale bids after a lot change/close
      this.queue = this.queue.filter((item) => item.kind !== 'bid');
    } else if (kind === 'bid') {
      // Coalesce rapid queued bid announcements so speech stays current with live bidding
      this.queue = this.queue.filter((item) => item.kind !== 'bid');
    }

    // Avoid duplicating an identical queued item
    if (
      this.currentItem?.dedupeKey === dedupeKey ||
      this.queue.some((item) => item.dedupeKey === dedupeKey)
    ) {
      return;
    }

    this.queue.push({
      id: `utt-${now}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      text: cleanText,
      dedupeKey,
    });

    if (this.queue.length > 3) {
      this.queue = this.queue.slice(-3);
    }

    if (!this.currentItem) {
      this.pumpQueue();
    } else {
      this.emitStatus();
    }
  }

  private pumpQueue(): void {
    if (this.currentItem || this.queue.length === 0) {
      this.emitStatus();
      return;
    }

    if (!isSpeechSynthesisSupported() || this.prefs.muted || this.prefs.volume <= 0) {
      this.queue = [];
      this.emitStatus();
      return;
    }

    const next = this.queue.shift()!;
    this.currentItem = next;
    this.emitStatus();

    try {
      const utterance = new window.SpeechSynthesisUtterance(next.text);
      if (!this.cachedVoice) {
        this.refreshVoice();
      }
      if (this.cachedVoice) {
        utterance.voice = this.cachedVoice;
        utterance.lang = this.cachedVoice.lang;
      } else {
        utterance.lang = 'en-IN';
      }
      utterance.volume = this.prefs.volume;
      utterance.rate = next.kind === 'bid' ? 1.08 : 1.02;
      utterance.pitch = 1.0;

      const finish = (blockedError = false) => {
        if (this.currentItem?.id !== next.id) return;
        if (this.watchdogTimer !== null) {
          window.clearTimeout(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        this.currentItem = null;
        if (blockedError) {
          this.autoplayBlocked = true;
          this.queue = [];
          this.emitStatus();
          return;
        }
        this.pumpQueue();
      };

      utterance.onend = () => finish(false);
      utterance.onerror = (evt) => {
        const errCode = (evt as { error?: string }).error || '';
        const blocked = errCode === 'not-allowed';
        finish(blocked);
      };

      // Safety watchdog in case a browser speech engine drops the onend event
      const estimatedMs = Math.max(2500, Math.min(8000, next.text.length * 95 + 1200));
      this.watchdogTimer = window.setTimeout(() => {
        if (this.currentItem?.id === next.id) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Ignore
          }
          finish(false);
        }
      }, estimatedMs);

      window.speechSynthesis.speak(utterance);
    } catch {
      if (this.watchdogTimer !== null) {
        window.clearTimeout(this.watchdogTimer);
        this.watchdogTimer = null;
      }
      this.currentItem = null;
      this.emitStatus();
    }
  }
}

export const auctionAnnouncer = new AuctionVoiceAnnouncer();
