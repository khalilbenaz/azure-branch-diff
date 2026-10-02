import { execFile } from 'node:child_process';

/**
 * Un dossier local choisi par l'utilisateur peut contenir un .git/config hostile
 * (dossier téléchargé, archive) : on neutralise tout ce qui exécute une commande.
 * - core.fsmonitor : commande lancée par ls-files / status ;
 * - core.hooksPath : scripts de hooks ;
 * - filtres clean/smudge du dépôt : traités dans hashFiles (pas de --stdin-paths avec filtres hostiles).
 */
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
export const SAFE_GIT_CONFIG = ['core.fsmonitor=false', `core.hooksPath=${NULL_DEVICE}`, 'core.untrackedCache=false'];

export const safeGitArgs = (args: string[]) => [...SAFE_GIT_CONFIG.flatMap((c) => ['-c', c]), ...args];

/** Vrai si le dossier est dans un dépôt git (et que git est installé). */
export async function insideGitRepo(root: string): Promise<boolean> {
  try {
    return (await gitOutput(root, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

/** git sans shell, configuration neutralisée. */
export function gitOutput(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', safeGitArgs(args), { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Vrai si la config locale du dépôt (non fiable) déclare des filtres : ils exécuteraient des commandes. */
export async function hasLocalFilters(root: string): Promise<boolean> {
  try {
    return (await gitOutput(root, ['config', '--local', '--includes', '--get-regexp', '^filter\\.'])).trim().length > 0;
  } catch {
    return false; // code 1 : aucune entrée
  }
}

/** core.autocrlf effectif ('true' | 'input' | 'false'). */
export async function autocrlf(root: string): Promise<string> {
  try {
    return (await gitOutput(root, ['config', '--get', 'core.autocrlf'])).trim().toLowerCase();
  } catch {
    return 'false';
  }
}
