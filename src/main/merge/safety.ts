import type { ApiError } from '../../shared/types';
import { gitRun } from '../local/safeGit';

/**
 * Clés qui, définies par le dépôt lui-même (config locale ou de worktree, includes compris),
 * exécuteraient une commande ou détourneraient fetch / push. La config globale et système
 * de l'utilisateur reste de confiance (ex. gestionnaire d'identifiants de Git pour Windows).
 */
const DANGEROUS = [
  /^filter\..+\.(clean|smudge|process)$/,
  /^merge\..+\.driver$/,
  /^diff\..+\.(textconv|command)$/,
  /^diff\.external$/,
  /^credential\.(.+\.)?helper$/,
  /^core\.(askpass|sshcommand|gitproxy|worktree|hookspath|fsmonitor|alternaterefscommand|editor|pager)$/,
  /^remote\..+\.(uploadpack|receivepack|proxy|vcs|pushurl)$/,
  /^url\..+\.(insteadof|pushinsteadof)$/,
  /^gpg\.(.+\.)?program$/,
  /^sequence\.editor$/,
  /^protocol\.(.+\.)?allow$/,
  /^include\.path$/,
  /^includeif\..+\.path$/,
  /^extensions\.worktreeconfig$/,
  /^pager\..+$/,
];

/** Clés dangereuses définies par le dépôt (portées local et worktree). */
export async function unsafeConfig(root: string): Promise<string[]> {
  const r = await gitRun(root, ['config', '--list', '--show-scope', '--includes', '--name-only']);
  if (r.code !== 0) return [];
  const keys = r.stdout
    .split('\n')
    .map((l) => l.split('\t'))
    .filter(([scope, key]) => key && (scope === 'local' || scope === 'worktree'))
    .map(([, key]) => key.trim());
  // git met en minuscules section et nom, pas la sous-section : comparaison insensible à la casse.
  return [...new Set(keys.filter((k) => DANGEROUS.some((re) => re.test(k.toLowerCase()))))].sort();
}

/** Refuse un dépôt dont la configuration exécuterait des commandes ou détournerait ses remotes. */
export async function assertSafeRepo(root: string): Promise<void> {
  const unsafe = await unsafeConfig(root);
  if (unsafe.length) {
    const error: ApiError = {
      code: 'unknown',
      message: `Dépôt refusé : sa configuration locale exécuterait des commandes ou détournerait ses remotes (${unsafe.join(', ')}).`,
    };
    throw error;
  }
}
