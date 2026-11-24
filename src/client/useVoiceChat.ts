import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, VoicePeerState, VoiceSignalPayload } from '../shared/types.ts';
import type { VoiceServerMessage } from './useAuctionSocket.ts';

export type MicPermissionState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

interface PeerEntry {
  pc: RTCPeerConnection;
  audioSender: RTCRtpSender | null;
  remoteAudio: HTMLAudioElement | null;
  pendingIce: Array<RTCIceCandidateInit>;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
};

function isWebRtcSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.RTCPeerConnection === 'function';
}

function isMicSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

interface UseVoiceChatOptions {
  enabled: boolean;
  wsConnected: boolean;
  roomCode: string;
  clientId: string;
  onSend: (msg: ClientMessage) => void;
  addVoiceListener: (listener: (msg: VoiceServerMessage) => void) => () => void;
}

export function useVoiceChat({
  enabled,
  wsConnected,
  roomCode,
  clientId,
  onSend,
  addVoiceListener,
}: UseVoiceChatOptions) {
  const [isMicOn, setIsMicOn] = useState(false);
  const [isHoldTalking, setIsHoldTalking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [isIncomingMuted, setIsIncomingMuted] = useState(false);
  const [permissionState, setPermissionState] = useState<MicPermissionState>(() =>
    isMicSupported() ? 'idle' : 'unavailable',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [voicePeers, setVoicePeers] = useState<VoicePeerState[]>([]);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterTimerRef = useRef<number | null>(null);
  const lastVoiceDetectAtRef = useRef<number>(0);

  const desiredMicOnRef = useRef(false);
  const desiredHoldTalkRef = useRef(false);
  const isIncomingMutedRef = useRef(false);
  const myClientIdRef = useRef(clientId);
  const onSendRef = useRef(onSend);
  const lastSentPresenceRef = useRef<{ joined: boolean; micActive: boolean; speaking: boolean } | null>(null);

  myClientIdRef.current = clientId;
  onSendRef.current = onSend;
  isIncomingMutedRef.current = isIncomingMuted;

  const sendPresence = useCallback((joined: boolean, micActive: boolean, speaking: boolean) => {
    const prev = lastSentPresenceRef.current;
    if (
      prev &&
      prev.joined === joined &&
      prev.micActive === micActive &&
      prev.speaking === speaking
    ) {
      return;
    }
    lastSentPresenceRef.current = { joined, micActive, speaking };
    onSendRef.current({
      type: 'voice:presence',
      joined,
      micActive,
      speaking,
    });
  }, []);

  const attachTrackToAllPeers = useCallback((track: MediaStreamTrack | null) => {
    for (const entry of peersRef.current.values()) {
      if (entry.audioSender) {
        void entry.audioSender.replaceTrack(track).catch(() => {
          // Ignore sender replacement race while peer is closing
        });
      }
    }
  }, []);

  const stopMeterAndStream = useCallback(() => {
    if (meterTimerRef.current !== null) {
      window.clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    attachTrackToAllPeers(null);
    setMicLevel(0);
    setIsSpeaking(false);
  }, [attachTrackToAllPeers]);

  const startSpeakingMeter = useCallback(
    (stream: MediaStream) => {
      if (meterTimerRef.current !== null) {
        window.clearInterval(meterTimerRef.current);
        meterTimerRef.current = null;
      }

      const Ctx =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;

      if (!Ctx) {
        // Fallback when Web Audio analyser is unavailable: mark active hold/mic as speaking
        const active = desiredMicOnRef.current || desiredHoldTalkRef.current;
        setIsSpeaking(active);
        sendPresence(true, active, active);
        return;
      }

      try {
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => {});
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);

        meterTimerRef.current = window.setInterval(() => {
          if (!localStreamRef.current) return;
          analyser.getByteTimeDomainData(samples);
          let sumSq = 0;
          for (let i = 0; i < samples.length; i++) {
            const norm = (samples[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / samples.length);
          const level = Math.min(1, rms * 5.5);
          setMicLevel(level);

          const now = Date.now();
          if (rms > 0.022) {
            lastVoiceDetectAtRef.current = now;
          }
          const isHolding = desiredHoldTalkRef.current;
          const active = desiredMicOnRef.current || desiredHoldTalkRef.current;
          const speakingNow = active && (isHolding || now - lastVoiceDetectAtRef.current < 500);
          setIsSpeaking(speakingNow);
          sendPresence(true, active, speakingNow);
        }, 120);
      } catch {
        const active = desiredMicOnRef.current || desiredHoldTalkRef.current;
        setIsSpeaking(active);
        sendPresence(true, active, active);
      }
    },
    [sendPresence],
  );

  const ensureCaptureActive = useCallback(async (): Promise<boolean> => {
    if (!isMicSupported()) {
      setPermissionState('unavailable');
      setErrorMessage(
        'Microphone capture is unavailable in this browser or requires a secure HTTPS connection.',
      );
      return false;
    }

    if (localStreamRef.current) {
      const existingTrack = localStreamRef.current.getAudioTracks()[0] ?? null;
      if (existingTrack && existingTrack.readyState === 'live') {
        existingTrack.enabled = true;
        attachTrackToAllPeers(existingTrack);
        const isHolding = desiredHoldTalkRef.current;
        sendPresence(true, true, isHolding);
        return true;
      }
      stopMeterAndStream();
    }

    setErrorMessage(null);
    setPermissionState((prev) => (prev === 'granted' ? 'granted' : 'requesting'));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      // Guard if user released PTT or toggled Mic Off while permission prompt was open
      if (!desiredMicOnRef.current && !desiredHoldTalkRef.current) {
        for (const t of stream.getTracks()) t.stop();
        setPermissionState('granted');
        return false;
      }

      localStreamRef.current = stream;
      setPermissionState('granted');
      setErrorMessage(null);

      const micTrack = stream.getAudioTracks()[0] ?? null;
      if (micTrack) {
        micTrack.enabled = true;
        attachTrackToAllPeers(micTrack);
      }
      const isHolding = desiredHoldTalkRef.current;
      setIsSpeaking(isHolding);
      sendPresence(true, true, isHolding);
      startSpeakingMeter(stream);
      return true;
    } catch (err) {
      const errName = err instanceof DOMException ? err.name : '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setPermissionState('denied');
        setErrorMessage(
          'Microphone permission was denied. Click the lock or site-settings icon in your browser address bar, set Microphone to Allow, and tap the microphone button again.',
        );
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setPermissionState('unavailable');
        setErrorMessage(
          'No microphone was found on this device. Connect a microphone or headset and try again.',
        );
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setPermissionState('unavailable');
        setErrorMessage(
          'Your microphone is currently in use by another app or browser tab. Close the other audio app and retry.',
        );
      } else {
        setPermissionState('unavailable');
        setErrorMessage(
          'Could not access the microphone. Check browser site permissions and secure HTTPS connection.',
        );
      }
      desiredMicOnRef.current = false;
      desiredHoldTalkRef.current = false;
      setIsMicOn(false);
      setIsHoldTalking(false);
      sendPresence(true, false, false);
      return false;
    }
  }, [attachTrackToAllPeers, sendPresence, startSpeakingMeter, stopMeterAndStream]);

  const syncCaptureToDesiredState = useCallback(async () => {
    const shouldTransmit = desiredMicOnRef.current || desiredHoldTalkRef.current;
    if (shouldTransmit) {
      await ensureCaptureActive();
    } else {
      stopMeterAndStream();
      sendPresence(true, false, false);
    }
  }, [ensureCaptureActive, sendPresence, stopMeterAndStream]);

  const toggleMic = useCallback(async () => {
    const next = !desiredMicOnRef.current;
    desiredMicOnRef.current = next;
    setIsMicOn(next);
    await syncCaptureToDesiredState();
  }, [syncCaptureToDesiredState]);

  const startPushToTalk = useCallback(async () => {
    if (desiredHoldTalkRef.current) return;
    desiredHoldTalkRef.current = true;
    setIsHoldTalking(true);
    await syncCaptureToDesiredState();
  }, [syncCaptureToDesiredState]);

  const stopPushToTalk = useCallback(() => {
    if (!desiredHoldTalkRef.current) return;
    desiredHoldTalkRef.current = false;
    setIsHoldTalking(false);
    void syncCaptureToDesiredState();
  }, [syncCaptureToDesiredState]);

  const toggleIncomingMute = useCallback(() => {
    setIsIncomingMuted((prev) => {
      const next = !prev;
      isIncomingMutedRef.current = next;
      for (const entry of peersRef.current.values()) {
        if (entry.remoteAudio) {
          entry.remoteAudio.muted = next;
        }
      }
      return next;
    });
  }, []);

  const unlockIncomingAudio = useCallback(() => {
    setAutoplayBlocked(false);
    for (const entry of peersRef.current.values()) {
      if (entry.remoteAudio) {
        entry.remoteAudio.muted = isIncomingMutedRef.current;
        void entry.remoteAudio.play().catch(() => {
          setAutoplayBlocked(true);
        });
      }
    }
  }, []);

  const dismissError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const closePeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    peersRef.current.delete(peerId);
    try {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onnegotiationneeded = null;
      entry.pc.oniceconnectionstatechange = null;
      entry.pc.close();
    } catch {
      // Ignore close error
    }
    if (entry.remoteAudio) {
      try {
        entry.remoteAudio.pause();
        entry.remoteAudio.srcObject = null;
        entry.remoteAudio.remove();
      } catch {
        // Ignore cleanup error
      }
    }
  }, []);

  const createPeerEntry = useCallback(
    (peerId: string): PeerEntry | null => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      if (!isWebRtcSupported()) return null;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const activeTrack = localStreamRef.current?.getAudioTracks()[0] ?? null;
      if (activeTrack && activeTrack.readyState === 'live') {
        void transceiver.sender.replaceTrack(activeTrack).catch(() => {});
      }

      const entry: PeerEntry = {
        pc,
        audioSender: transceiver.sender,
        remoteAudio: null,
        pendingIce: [],
        makingOffer: false,
        ignoreOffer: false,
      };
      peersRef.current.set(peerId, entry);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const json = event.candidate.toJSON();
        if (!json.candidate) return;
        onSendRef.current({
          type: 'voice:signal',
          targetClientId: peerId,
          signal: {
            kind: 'ice',
            candidate: {
              candidate: json.candidate,
              sdpMid: json.sdpMid ?? null,
              sdpMLineIndex: json.sdpMLineIndex ?? null,
              usernameFragment: json.usernameFragment ?? null,
            },
          },
        });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        let audioEl = entry.remoteAudio;
        if (!audioEl) {
          audioEl = document.createElement('audio');
          audioEl.autoplay = true;
          audioEl.setAttribute('playsinline', 'true');
          audioEl.className = 'hidden';
          document.body.appendChild(audioEl);
          entry.remoteAudio = audioEl;
        }
        audioEl.srcObject = stream;
        audioEl.muted = isIncomingMutedRef.current;
        void audioEl.play().catch((err) => {
          if (err instanceof DOMException && err.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
          }
        });
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {
            // Ignore restartIce failure on older engines
          }
        }
      };

      return entry;
    },
    [],
  );

  const initiateOfferToPeer = useCallback(
    async (peerId: string) => {
      const entry = peersRef.current.get(peerId) ?? createPeerEntry(peerId);
      if (!entry) return;
      try {
        entry.makingOffer = true;
        await entry.pc.setLocalDescription();
        if (entry.pc.localDescription?.sdp) {
          onSendRef.current({
            type: 'voice:signal',
            targetClientId: peerId,
            signal: { kind: 'offer', sdp: entry.pc.localDescription.sdp },
          });
        }
      } catch {
        // Ignore transient negotiation race
      } finally {
        entry.makingOffer = false;
      }
    },
    [createPeerEntry],
  );

  const handleSignal = useCallback(
    async (fromClientId: string, signal: VoiceSignalPayload) => {
      const entry = peersRef.current.get(fromClientId) ?? createPeerEntry(fromClientId);
      if (!entry) return;
      const pc = entry.pc;
      const polite = myClientIdRef.current > fromClientId;

      try {
        if (signal.kind === 'offer') {
          const offerCollision = entry.makingOffer || pc.signalingState !== 'stable';
          entry.ignoreOffer = !polite && offerCollision;
          if (entry.ignoreOffer) return;

          await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          // Ensure our transceiver also uses any currently active mic track
          const audioTransceiver = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
          if (audioTransceiver) {
            entry.audioSender = audioTransceiver.sender;
            const activeTrack = localStreamRef.current?.getAudioTracks()[0] ?? null;
            if (activeTrack && activeTrack.readyState === 'live') {
              void audioTransceiver.sender.replaceTrack(activeTrack).catch(() => {});
            }
          }

          await pc.setLocalDescription();
          if (pc.localDescription?.sdp) {
            onSendRef.current({
              type: 'voice:signal',
              targetClientId: fromClientId,
              signal: { kind: 'answer', sdp: pc.localDescription.sdp },
            });
          }

          while (entry.pendingIce.length > 0) {
            const candidate = entry.pendingIce.shift()!;
            await pc.addIceCandidate(candidate).catch(() => {});
          }
          return;
        }

        if (signal.kind === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            while (entry.pendingIce.length > 0) {
              const candidate = entry.pendingIce.shift()!;
              await pc.addIceCandidate(candidate).catch(() => {});
            }
          }
          return;
        }

        if (signal.kind === 'ice') {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(signal.candidate).catch(() => {});
          } else {
            entry.pendingIce.push(signal.candidate);
          }
        }
      } catch {
        // Ignore transient SDP/ICE race errors
      }
    },
    [createPeerEntry],
  );

  // Sync peers whenever server broadcasts updated room voice roster
  useEffect(() => {
    if (!enabled || !clientId) return;

    const activeRemoteIds = new Set(
      voicePeers.filter((p) => p.joined && p.clientId !== clientId).map((p) => p.clientId),
    );

    for (const existingPeerId of Array.from(peersRef.current.keys())) {
      if (!activeRemoteIds.has(existingPeerId)) {
        closePeer(existingPeerId);
      }
    }

    for (const remoteId of activeRemoteIds) {
      if (!peersRef.current.has(remoteId)) {
        const entry = createPeerEntry(remoteId);
        // Deterministic initiator: smaller clientId sends the initial offer
        if (entry && clientId < remoteId) {
          void initiateOfferToPeer(remoteId);
        }
      }
    }
  }, [enabled, clientId, voicePeers, closePeer, createPeerEntry, initiateOfferToPeer]);

  // Re-announce presence whenever WebSocket reconnects while inside the room
  useEffect(() => {
    if (!enabled || !wsConnected || !roomCode || !clientId) return;
    lastSentPresenceRef.current = null;
    sendPresence(true, desiredMicOnRef.current || desiredHoldTalkRef.current, false);
  }, [enabled, wsConnected, roomCode, clientId, sendPresence]);

  // Subscribe to WebSocket voice messages while inside live auction room
  useEffect(() => {
    if (!enabled || !roomCode || !clientId) {
      setVoicePeers([]);
      lastSentPresenceRef.current = null;
      return;
    }

    const unsubscribe = addVoiceListener((msg) => {
      if (msg.type === 'voice:peers') {
        setVoicePeers(msg.peers);
      } else if (msg.type === 'voice:signal') {
        void handleSignal(msg.fromClientId, msg.signal);
      }
    });

    sendPresence(true, desiredMicOnRef.current || desiredHoldTalkRef.current, false);

    return () => {
      unsubscribe();
      desiredMicOnRef.current = false;
      desiredHoldTalkRef.current = false;
      setIsMicOn(false);
      setIsHoldTalking(false);
      stopMeterAndStream();
      for (const peerId of Array.from(peersRef.current.keys())) {
        closePeer(peerId);
      }
      sendPresence(false, false, false);
      lastSentPresenceRef.current = null;
    };
  }, [
    enabled,
    roomCode,
    clientId,
    addVoiceListener,
    handleSignal,
    sendPresence,
    stopMeterAndStream,
    closePeer,
  ]);

  // Re-evaluate browser gesture unlock on any pointer/key interaction if autoplay was blocked
  useEffect(() => {
    if (!autoplayBlocked) return;
    const onGesture = () => {
      unlockIncomingAudio();
    };
    window.addEventListener('pointerdown', onGesture, { once: true, capture: true });
    window.addEventListener('keydown', onGesture, { once: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
  }, [autoplayBlocked, unlockIncomingAudio]);

  return {
    isMicOn,
    isHoldTalking,
    isTransmitting: isMicOn || isHoldTalking,
    isSpeaking,
    micLevel,
    isIncomingMuted,
    permissionState,
    errorMessage,
    autoplayBlocked,
    voicePeers,
    toggleMic,
    startPushToTalk,
    stopPushToTalk,
    toggleIncomingMute,
    unlockIncomingAudio,
    dismissError,
  };
}
