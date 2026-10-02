import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type ThemeSource = 'system' | 'light' | 'dark';
const THEMES: readonly ThemeSource[] = ['system', 'light', 'dark'];

/** Réglages de l'app (hors secrets) : thème. */
export class SettingsStore {
  constructor(private readonly file: string) {}

  private read(): { theme?: unknown } {
    try {
      return existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    } catch {
      return {};
    }
  }

  theme(): ThemeSource {
    const t = this.read().theme;
    return THEMES.includes(t as ThemeSource) ? (t as ThemeSource) : 'system';
  }

  setTheme(t: ThemeSource): void {
    if (!THEMES.includes(t)) throw new Error('Thème inconnu.');
    writeFileSync(this.file, JSON.stringify({ ...this.read(), theme: t }));
  }
}
