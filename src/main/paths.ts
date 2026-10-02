import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ApiError } from '../shared/types';

/** Chemin local sûr : refuse tout chemin (ou lien symbolique) qui sortirait du dossier `root`. */
export function insideRoot(root: string, path: string): string {
  const realRoot = realpathSync.native(root);
  const full = resolve(realRoot, path);
  const real = existsSync(full) ? realpathSync.native(full) : full;
  const rel = relative(realRoot, real);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    const error: ApiError = { code: 'unknown', message: 'Chemin hors du dossier sélectionné.' };
    throw error;
  }
  return real;
}

const deny = (message: string): ApiError => ({ code: 'unknown', message });

/** Refuse tout chemin qui passe par un dossier .git (config, hooks, index…). */
export function assertNotGitDir(path: string): void {
  if (path.split(/[\\/]+/).some((seg) => seg.toLowerCase() === '.git')) throw deny('Accès refusé aux fichiers internes de git (.git).');
}

/**
 * Emplacement d'un fichier à écrire ou supprimer, sans suivre le fichier lui-même :
 * le dossier parent est résolu (liens compris) et doit rester dans `root` ; le nom final n'est pas résolu.
 */
export function leafInside(root: string, path: string): string {
  assertNotGitDir(path);
  const realRoot = realpathSync.native(root);
  const full = resolve(realRoot, path);
  const parent = dirname(full);
  const realParent = existsSync(parent) ? realpathSync.native(parent) : parent;
  const rel = relative(realRoot, realParent);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw deny('Chemin hors du dossier sélectionné.');
  return join(realParent, basename(full));
}
