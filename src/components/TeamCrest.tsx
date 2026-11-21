interface TeamCrestProps {
  shortCode: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}

export function TeamCrest({ shortCode, color, size = 'md' }: TeamCrestProps) {
  const dims =
    size === 'sm' ? 'h-7 w-7 text-[10px]' :
    size === 'lg' ? 'h-12 w-12 text-sm' :
    'h-9 w-9 text-xs';

  return (
    <div
      className={`relative inline-flex shrink-0 items-center justify-center rounded-lg font-display font-bold tracking-wider text-white select-none ${dims}`}
      style={{
        background: `linear-gradient(145deg, ${color}, ${color}AA)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 3px rgba(0,0,0,0.45)`,
        border: '1px solid rgba(255,255,255,0.16)',
      }}
      aria-hidden="true"
    >
      <span className="drop-shadow-sm">{shortCode.slice(0, 4)}</span>
    </div>
  );
}
