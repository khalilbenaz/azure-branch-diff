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
  // Jamais de vérification de signature (lancerait gpg.program, éventuellement défini par le dépôt).
  'log.showSignature=false',
  // Dépôts copiés depuis un autre compte ou disque : git les refuserait (« dubious ownership »). Les risques que cette
  // protection couvre (hooks, fsmonitor, filtres) sont neutralisés ou contrôlés par l'app (voir merge/safety.ts).
  'safe.directory=*',
];

/** Sortie de git en anglais (analysée par l'app), chemins littéraux (pas de motifs), jamais d'invite interactive. */
const BASE_GIT_ENV: NodeJS.ProcessEnv = { LC_ALL: 'C', LANGUAGE: '', GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' };

/** Emplacements usuels de git, absents du PATH d'une app lancée depuis le Finder ou le menu Démarrer. */
const EXTRA_GIT_DIRS: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ['/opt/homebrew/bin', '/usr/local/bin'],
  win32: ['C:\\Program Files\\Git\\cmd', 'C:\\Program Files (x86)\\Git\\cmd'],
};

/** Environnement de git : variables fixes + PATH complété (calculé à chaque appel). */
export function gitEnv(): NodeJS.ProcessEnv {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const extra = process.env.ABD_NO_GIT_EXTRA_PATH === '1' ? [] : (EXTRA_GIT_DIRS[process.platform] ?? []);
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts = [...(process.env[key] ?? '').split(sep).filter(Boolean), ...extra];
  return { ...process.env, ...BASE_GIT_ENV, [key]: [...new Set(parts)].join(sep) };
}

/** @deprecated utiliser gitEnv() ; conservé pour les appels existants. */
export const GIT_ENV: NodeJS.ProcessEnv = BASE_GIT_ENV;

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
    execFile('git', safeGitArgs(args), { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: gitEnv() }, (err, stdout) =>
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
      { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...gitEnv(), ...env } },
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
    execFile('git', safeGitArgs(args), { cwd: root, windowsHide: true, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: gitEnv() }, (err, stdout) =>
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
