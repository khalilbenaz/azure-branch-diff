// Icônes au trait (pas d'emoji) ; héritent de la couleur du texte.
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const IconLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} stroke="#ffffff" strokeWidth={2.2} aria-hidden="true">
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="6" cy="19" r="2.2" />
    <circle cx="18" cy="12" r="2.2" />
    <path d="M6 7.2v9.6M7.8 6.3 16.2 11M7.8 17.7 16.2 13" />
  </svg>
);
export const IconCompare = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M8 3v18M16 3v18M3 8h5M16 16h5" />
  </svg>
);
export const IconPr = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-4" />
  </svg>
);
export const IconConflict = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4M12 17v.5" />
  </svg>
);
export const IconSwap = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M5 9h14l-4-4M19 15H5l4 4" />
  </svg>
);
export const IconReload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </svg>
);
export const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
export const IconExternal = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const IconFolder = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const IconMerge = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="6" cy="5" r="2.2" />
    <circle cx="18" cy="5" r="2.2" />
    <circle cx="12" cy="19" r="2.2" />
    <path d="M6 7.2c0 5 6 5 6 9.6M18 7.2c0 5-6 5-6 9.6" />
  </svg>
);
