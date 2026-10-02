import type { Cipher } from '../../src/main/auth';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

export function tempDir(files: Record<string, string | Buffer> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'abd-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

/** Faux chiffrement réversible (inverse la chaîne) pour tester AuthStore sans Electron. */
export const reverseCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from([...s].reverse().join('')),
  decrypt: (b) => [...b.toString()].reverse().join(''),
};

/** Dossier temporaire devenu dépôt git (sans commit) : utilisable comme côté local « copie de travail ». */
export function gitDir(files: Record<string, string | Buffer> = {}): string {
  const root = tempDir(files);
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

/** Côté local « copie de travail » d'un dossier. */
export const worktreeSide = (root: string) => ({ kind: 'local' as const, root: realpathSync.native(root), ref: { type: 'worktree' as const } });
