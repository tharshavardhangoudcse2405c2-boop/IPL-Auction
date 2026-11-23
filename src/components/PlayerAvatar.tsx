import { useEffect, useState } from 'react';
import type { Player } from '../shared/types.ts';

interface PlayerAvatarProps {
  player: Player;
  size?: 'sm' | 'md' | 'hero';
}

const ROLE_PALETTE: Record<Player['role'], { from: string; to: string; jersey: string; trim: string }> = {
  Batter: { from: '#2F4A63', to: '#131B2B', jersey: '#5B91A3', trim: '#CFEAE0' },
  Bowler: { from: '#25425A', to: '#131B2B', jersey: '#43798C', trim: '#CFEAE0' },
  'All-Rounder': { from: '#34516B', to: '#131B2B', jersey: '#5B91A3', trim: '#CFEAE0' },
  Wicketkeeper: { from: '#283F57', to: '#131B2B', jersey: '#4D8296', trim: '#CFEAE0' },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

export function PlayerAvatar({ player, size = 'hero' }: PlayerAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [player.id, player.photoUrl]);

  const palette = ROLE_PALETTE[player.role];
  const hasPhoto = Boolean(player.photoUrl) && !imgFailed;

  const containerClass =
    size === 'sm'
      ? 'h-12 w-10 rounded-lg'
      : size === 'md'
        ? 'h-24 w-20 rounded-xl'
        : 'h-64 w-full sm:h-72 sm:w-56 rounded-xl';

  return (
    <div
      className={`relative overflow-hidden shrink-0 border border-[#5B91A3]/35 ${containerClass}`}
      style={{
        background: `linear-gradient(165deg, ${palette.from}, ${palette.to})`,
      }}
    >
      {hasPhoto ? (
        <img
          src={player.photoUrl}
          alt={`Portrait of ${player.name}, ${player.role} from ${player.nationality}`}
          loading={size === 'hero' ? 'eager' : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-end select-none">
          <svg
            viewBox="0 0 180 220"
            className="h-full w-full"
            role="img"
            aria-label={`Illustrated portrait fallback for ${player.name}, ${player.role}`}
          >
            <defs>
              <linearGradient id={`bg-${player.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={palette.from} />
                <stop offset="100%" stopColor={palette.to} />
              </linearGradient>
              <linearGradient id={`jersey-${player.id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={palette.jersey} />
                <stop offset="100%" stopColor="#131B2B" />
              </linearGradient>
            </defs>
            <rect width="180" height="220" fill={`url(#bg-${player.id})`} />
            <circle cx="90" cy="76" r="56" fill={palette.trim} fillOpacity="0.08" />
            <path
              d="M22 220 C26 164, 52 146, 90 146 C128 146, 154 164, 158 220 Z"
              fill={`url(#jersey-${player.id})`}
            />
            <path
              d="M68 147 L90 167 L112 147"
              fill="none"
              stroke={palette.trim}
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="76" y="118" width="28" height="32" rx="10" fill="#CFEAE0" fillOpacity="0.88" />
            <ellipse cx="90" cy="86" rx="30" ry="36" fill="#CFEAE0" fillOpacity="0.94" />
            <path
              d="M59 80 C60 50, 120 50, 121 80 C112 67, 68 67, 59 80 Z"
              fill="#131B2B"
            />
            <text
              x="90"
              y="196"
              textAnchor="middle"
              fill="#CFEAE0"
              fillOpacity="0.95"
              fontFamily="Barlow Condensed, sans-serif"
              fontWeight="700"
              fontSize="24"
              letterSpacing="2"
            >
              {getInitials(player.name)}
            </text>
          </svg>
        </div>
      )}
      {size === 'hero' && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#131B2B]/85 via-[#131B2B]/35 to-transparent"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
