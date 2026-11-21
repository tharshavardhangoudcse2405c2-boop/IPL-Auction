// Synthesized Web Audio API sound effects (zero external audio dependencies)
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(
  freq: number,
  durationSec: number,
  type: OscillatorType = 'triangle',
  volume = 0.12,
  delaySec = 0,
): void {
  const ctx = getCtx();
  if (!ctx) return;
  const startAt = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

export function playBidSound(muted: boolean, isHuman = true): void {
  if (muted) return;
  playTone(isHuman ? 660 : 520, 0.09, 'triangle', 0.1);
  playTone(isHuman ? 880 : 680, 0.11, 'sine', 0.08, 0.045);
}

export function playTickSound(muted: boolean, urgent = false): void {
  if (muted) return;
  playTone(urgent ? 960 : 720, 0.055, 'sine', urgent ? 0.08 : 0.04);
}

export function playSoldSound(muted: boolean): void {
  if (muted) return;
  // Crisp broadcast gavel double-knock + major triad chime
  playTone(180, 0.08, 'square', 0.09, 0);
  playTone(523.25, 0.18, 'triangle', 0.12, 0.06);
  playTone(659.25, 0.2, 'triangle', 0.11, 0.14);
  playTone(783.99, 0.34, 'triangle', 0.13, 0.22);
}

export function playUnsoldSound(muted: boolean): void {
  if (muted) return;
  playTone(340, 0.16, 'sine', 0.08, 0);
  playTone(255, 0.26, 'sine', 0.08, 0.13);
}

export function playRejectedSound(muted: boolean): void {
  if (muted) return;
  playTone(210, 0.12, 'sawtooth', 0.06, 0);
}
