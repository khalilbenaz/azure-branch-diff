import { execFile } from 'node:child_process';

/**
 * Un dossier local choisi par l'utilisateur peut contenir un .git/config hostile
 * (dossier téléchargé, archive) : on neutralise tout ce qui exécute une commande.
 * - core.fsmonitor : commande lancée par ls-files / status ;
 * - core.hooksPath : scripts de hooks ;
 * - filtres clean/smudge du dépôt : traités dans hashFiles (pas de --stdin-paths avec filtres hostiles).
 */
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
export const SAFE_GIT_CONFIG = [
  'core.fsmonitor=false',
  `core.hooksPath=${NULL_DEVICE}`,
  'core.untrackedCache=false',
  'protocol.ext.allow=never',
  'submodule.recurse=false',
];

/** Sortie de git en anglais (analysée par l'app), chemins littéraux (pas de motifs), jamais d'invite interactive. */
export const GIT_ENV: NodeJS.ProcessEnv = { LC_ALL: 'C', LANGUAGE: '', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };

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
    execFile('git', safeGitArgs(args), { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

export interface GitRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** git qui ne lève pas d'erreur sur un code de sortie non nul (merge avec conflits, etc.). */
export function gitRun(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<GitRun> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      safeGitArgs(args),
      { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...GIT_ENV, ...env } },
      (err, stdout, stderr) => {
        if (err && typeof (err as NodeJS.ErrnoException).code === 'string') return reject(err); // git introuvable
        resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

/** Comme gitOutput, en octets (contenu de fichiers : binaires, encodages). */
export function gitBuffer(root: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', safeGitArgs(args), { cwd: root, windowsHide: true, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
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
