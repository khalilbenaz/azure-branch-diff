import { useEffect, useState } from 'react';

type ThemeSource = 'system' | 'light' | 'dark';
const bridge = (window as unknown as { theme?: { get(): Promise<ThemeSource>; set(t: ThemeSource): Promise<ThemeSource> } }).theme;

const OPTIONS: { id: ThemeSource; label: string }[] = [
  { id: 'system', label: 'Système' },
  { id: 'light', label: 'Clair' },
  { id: 'dark', label: 'Sombre' },
];

/** Choix du thème : suit le système, ou force clair / sombre (mémorisé). */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeSource>('system');
  useEffect(() => {
    void bridge
      ?.get()
      .then(setTheme)
      .catch(() => {});
  }, []);
  if (!bridge) return null;
  return (
    <div className={`segmented xs theme-toggle ${className}`} role="group" aria-label="Thème">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          aria-pressed={theme === o.id}
          onClick={() =>
            void bridge
              .set(o.id)
              .then(setTheme)
              .catch(() => {})
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
