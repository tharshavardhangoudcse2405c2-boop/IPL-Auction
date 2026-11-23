// Synthesized Web Audio API broadcast sound effects (zero external audio dependencies)
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let unlockRegistered = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, audioCtx.currentTime);
    compressor.knee.setValueAtTime(18, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(6, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0.004, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.18, audioCtx.currentTime);

    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.9, audioCtx.currentTime);
    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getOutput(): AudioNode | null {
  const ctx = getCtx();
  if (!ctx) return null;
  return masterGain ?? ctx.destination;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const length = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buffer;
  return buffer;
}

export function unlockAudio(): void {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function setupAudioUnlock(): () => void {
  if (typeof window === 'undefined' || unlockRegistered) return () => {};
  unlockRegistered = true;
  const handleFirstGesture = () => {
    unlockAudio();
  };
  window.addEventListener('pointerdown', handleFirstGesture, { passive: true, capture: true });
  window.addEventListener('keydown', handleFirstGesture, { passive: true, capture: true });
  return () => {
    unlockRegistered = false;
    window.removeEventListener('pointerdown', handleFirstGesture, true);
    window.removeEventListener('keydown', handleFirstGesture, true);
  };
}

function playTone(
  freq: number,
  durationSec: number,
  type: OscillatorType = 'triangle',
  volume = 0.14,
  delaySec = 0,
  endFreq?: number,
): void {
  const ctx = getCtx();
  const out = getOutput();
  if (!ctx || !out) return;
  const startAt = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), startAt + durationSec);
  }
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain);
  gain.connect(out);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

function playGavelKnock(delaySec = 0, gainScale = 1): void {
  const ctx = getCtx();
  const out = getOutput();
  if (!ctx || !out) return;
  const startAt = ctx.currentTime + delaySec;

  // Woody strike crack (short bandpass-filtered noise burst)
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1450, startAt);
  filter.Q.setValueAtTime(2.6, startAt);
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.0001, startAt);
  nGain.gain.exponentialRampToValueAtTime(0.28 * gainScale, startAt + 0.004);
  nGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.055);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(out);
  noise.start(startAt);
  noise.stop(startAt + 0.065);

  // Resonant mahogany block body knock
  playTone(175, 0.09, 'triangle', 0.24 * gainScale, delaySec, 78);
  playTone(360, 0.045, 'sine', 0.1 * gainScale, delaySec, 190);
}

export function playClickSound(muted: boolean): void {
  if (muted) return;
  playTone(980, 0.032, 'sine', 0.06, 0, 680);
}

export function playSeatClaimSound(muted: boolean): void {
  if (muted) return;
  playTone(523.25, 0.09, 'triangle', 0.11, 0);
  playTone(783.99, 0.16, 'triangle', 0.13, 0.065);
}

export function playNewLotSound(muted: boolean): void {
  if (muted) return;
  // Broadcast spotlight intro sting
  playTone(440, 0.12, 'triangle', 0.1, 0);
  playTone(554.37, 0.14, 'triangle', 0.11, 0.075);
  playTone(659.25, 0.22, 'sine', 0.13, 0.15);
}

export function playBidSound(muted: boolean, isHuman = true): void {
  if (muted) return;
  if (isHuman) {
    // Crisp stadium paddle snap + rising accent
    playTone(740, 0.08, 'triangle', 0.14, 0);
    playTone(1108.73, 0.11, 'sine', 0.12, 0.04);
  } else {
    // Distinct rival AI counter-bid pulse
    playTone(493.88, 0.08, 'triangle', 0.11, 0);
    playTone(659.25, 0.1, 'sine', 0.09, 0.04);
  }
}

export function playTickSound(muted: boolean, urgent = false): void {
  if (muted) return;
  if (urgent) {
    playTone(1046.5, 0.05, 'sine', 0.1, 0);
    playTone(1318.5, 0.055, 'triangle', 0.09, 0.07);
  } else {
    playTone(760, 0.045, 'sine', 0.055, 0);
  }
}

export function playPauseResumeSound(muted: boolean, paused: boolean): void {
  if (muted) return;
  if (paused) {
    playTone(587.33, 0.11, 'sine', 0.1, 0);
    playTone(440, 0.16, 'sine', 0.1, 0.08);
  } else {
    playTone(440, 0.11, 'triangle', 0.1, 0);
    playTone(659.25, 0.16, 'triangle', 0.12, 0.08);
  }
}

export function playExtendTimerSound(muted: boolean): void {
  if (muted) return;
  playTone(587.33, 0.09, 'sine', 0.1, 0);
  playTone(880, 0.15, 'triangle', 0.11, 0.06);
}

export function playSoldSound(muted: boolean): void {
  if (muted) return;
  // Authentic auctioneer wooden gavel double-knock + major triad victory chime
  playGavelKnock(0, 1);
  playGavelKnock(0.13, 0.85);
  playTone(523.25, 0.22, 'triangle', 0.14, 0.24);
  playTone(659.25, 0.24, 'triangle', 0.13, 0.31);
  playTone(783.99, 0.28, 'triangle', 0.14, 0.38);
  playTone(1046.5, 0.42, 'sine', 0.14, 0.45);
}

export function playUnsoldSound(muted: boolean): void {
  if (muted) return;
  // Single heavy gavel tap + muted descending pass interval
  playGavelKnock(0, 0.8);
  playTone(349.23, 0.17, 'sine', 0.1, 0.14);
  playTone(261.63, 0.28, 'sine', 0.1, 0.27);
}

export function playRejectedSound(muted: boolean): void {
  if (muted) return;
  playTone(210, 0.1, 'sawtooth', 0.08, 0, 175);
  playTone(165, 0.14, 'sawtooth', 0.08, 0.09, 130);
}

export function playWinnerFanfareSound(muted: boolean): void {
  if (muted) return;
  playTone(523.25, 0.16, 'triangle', 0.12, 0);
  playTone(659.25, 0.16, 'triangle', 0.12, 0.09);
  playTone(783.99, 0.18, 'triangle', 0.13, 0.18);
  playTone(1046.5, 0.45, 'triangle', 0.15, 0.27);
  playTone(1318.51, 0.42, 'sine', 0.1, 0.33);
}
