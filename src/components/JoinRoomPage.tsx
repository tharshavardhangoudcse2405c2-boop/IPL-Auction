import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Globe, Search, Users } from 'lucide-react';
import { apiFetch } from '../client/api.ts';

interface JoinRoomPageProps {
  initialRoomCode?: string;
  defaultName?: string;
  isConnecting: boolean;
  onJoinRoom: (roomCode: string, clientName: string) => void;
  onNavigate: (path: string) => void;
}

interface RoomPreview {
  exists: boolean;
  roomCode?: string;
  phase?: string;
  mode?: string;
  teamCount?: number;
  participantsCount?: number;
  message?: string;
}

export function JoinRoomPage({
  initialRoomCode = '',
  defaultName = '',
  isConnecting,
  onJoinRoom,
  onNavigate,
}: JoinRoomPageProps) {
  const [joinCode, setJoinCode] = useState(initialRoomCode);
  const [joinName, setJoinName] = useState(defaultName);
  const [preview, setPreview] = useState<RoomPreview | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (initialRoomCode) {
      setJoinCode(initialRoomCode);
    }
  }, [initialRoomCode]);

  const checkRoom = async (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(code)) {
      setPreview({ exists: false, message: 'Enter a valid 4–10 character room code.' });
      return;
    }
    setChecking(true);
    try {
      const res = await apiFetch<RoomPreview>(`/api/rooms/${encodeURIComponent(code)}`);
      setPreview(res.data);
    } catch {
      setPreview({ exists: false, message: 'Unable to check room status right now.' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (initialRoomCode && /^[A-Z0-9]{4,10}$/.test(initialRoomCode)) {
      void checkRoom(initialRoomCode);
    }
  }, [initialRoomCode]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    onJoinRoom(joinCode.trim().toUpperCase(), joinName.trim() || defaultName || 'Manager');
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 space-y-6">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#CFEAE0]/80 hover:text-[#CFEAE0]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to Home
      </button>

      <div className="rounded-2xl border border-[#5B91A3]/35 bg-[#2F4A63] p-6 sm:p-8 shadow-xl space-y-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#CFEAE0]/85">
            <Globe className="h-4 w-4 text-[#CFEAE0]" aria-hidden="true" />
            Online Multiplayer Lobby
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-[#CFEAE0]">
            Join an Online Auction Room
          </h1>
          <p className="text-sm text-[#CFEAE0]/80 leading-relaxed">
            Enter the room code shared by the auction host. Once inside the lobby, claim one open franchise seat to bid from your device.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Room Code</span>
            <div className="flex gap-2.5">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value.toUpperCase().slice(0, 10));
                  setPreview(null);
                }}
                placeholder="e.g. CH7K4M"
                className="flex-1 rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-3 font-mono-num text-base font-bold uppercase tracking-widest text-[#CFEAE0] placeholder:text-[#CFEAE0]/35 focus:border-[#CFEAE0] focus:outline-none"
              />
              <button
                type="button"
                disabled={checking || !joinCode.trim()}
                onClick={() => void checkRoom(joinCode)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#5B91A3]/50 bg-[#131B2B] px-4 py-3 text-xs font-bold text-[#CFEAE0] hover:bg-[#1B293D] disabled:opacity-45 whitespace-nowrap"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                {checking ? 'Checking...' : 'Check Room'}
              </button>
            </div>
          </label>

          {preview && (
            <div
              className={`rounded-xl border px-4 py-3 text-xs ${
                preview.exists
                  ? 'border-emerald-400/45 bg-[#131B2B] text-[#CFEAE0]'
                  : 'border-rose-400/45 bg-rose-950/75 text-rose-100'
              }`}
            >
              {preview.exists ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" aria-hidden="true" />
                  <span>
                    Room <strong className="font-mono-num">{preview.roomCode}</strong> is active ·{' '}
                    {preview.teamCount} Franchises · Phase: <strong>{preview.phase}</strong> ·{' '}
                    {preview.participantsCount} connected
                  </span>
                </div>
              ) : (
                <span>{preview.message || 'Room not found.'}</span>
              )}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#CFEAE0]">Your Manager Name</span>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value.slice(0, 32))}
              placeholder="Your Manager Name"
              className="w-full rounded-xl border border-[#5B91A3]/45 bg-[#131B2B] px-4 py-3 text-sm text-[#CFEAE0] placeholder:text-[#CFEAE0]/40 focus:border-[#CFEAE0] focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={isConnecting || !joinCode.trim()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#5B91A3] px-5 py-3.5 text-sm font-extrabold text-[#131B2B] hover:bg-[#70A7B9] disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            {isConnecting ? 'Joining Room...' : 'Enter Auction Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
