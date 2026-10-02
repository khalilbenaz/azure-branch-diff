import type { ApiError } from '../../shared/types';
import { gitRun } from '../local/safeGit';

/**
 * Ce qu'un dépôt peut exiger via SA configuration (portées local et worktree, includes compris) sans risque,
 * selon l'opération. La config globale et système de l'utilisateur reste de confiance.
 *  - read    : ouvrir, comparer (status, diff --name-status, ls-files, show, hash-object) ;
 *  - write   : merge, résolution, commit ;
 *  - network : fetch, push.
 * Les hooks, fsmonitor et la signature sont neutralisés par ailleurs (safeGit, commit --no-verify --no-gpg-sign) ;
 * éditeur et pager ne sont jamais lancés (pas de terminal, -m, --no-edit).
 */
export type GitOperation = 'read' | 'write' | 'network';

interface Rule {
  key: RegExp;
  from: GitOperation;
  /** Valeurs connues et sûres (ex. Git LFS, gestionnaires d'identifiants usuels). */
  safe?: (value: string) => boolean;
}

const LFS = (v: string) => /^git-lfs (clean|smudge)( --)? %f$|^git-lfs filter-process$/.test(v.trim());
const KNOWN_HELPERS = new Set(['', 'manager', 'manager-core', 'osxkeychain', 'wincred', 'store', 'cache', 'libsecret', 'gnome-keyring']);
const HELPER = (v: string) => KNOWN_HELPERS.has(v.trim()) || /^cache --timeout[= ]\d+$/.test(v.trim()) || /^store --file[= ]\S+$/.test(v.trim());

const RULES: Rule[] = [
  // Commandes exécutées à la lecture (status / hash-object appliquent les filtres) ou sortie du dossier.
  { key: /^filter\..+\.(clean|smudge|process)$/, from: 'read', safe: LFS },
  { key: /^core\.worktree$/, from: 'read' },
  // Merge : pilotes de merge.
  { key: /^merge\..+\.driver$/, from: 'write' },
  { key: /^diff\..+\.(textconv|command)$/, from: 'write' },
  { key: /^diff\.external$/, from: 'write' },
  // Réseau : identifiants, transport, redirections.
  { key: /^credential\.(.+\.)?helper$/, from: 'network', safe: HELPER },
  { key: /^core\.(askpass|sshcommand|gitproxy|alternaterefscommand)$/, from: 'network' },
  { key: /^remote\..+\.(uploadpack|receivepack|proxy|vcs|pushurl)$/, from: 'network' },
  { key: /^url\..+\.(insteadof|pushinsteadof)$/, from: 'network' },
  { key: /^protocol\.(.+\.)?allow$/, from: 'network' },
];

const LEVEL: Record<GitOperation, number> = { read: 0, write: 1, network: 2 };

/** Réglages du dépôt qui seraient dangereux pour `op` (et les opérations plus restreintes). */
export async function unsafeConfig(root: string, op: GitOperation = 'network'): Promise<string[]> {
  let r;
  try {
    r = await gitRun(root, ['config', '--list', '--show-scope', '--includes', '-z']);
  } catch {
    return []; // git absent : aucune commande git ne sera lancée
  }
  if (r.code !== 0) return [];
  const parts = r.stdout.split('\0');
  const found = new Set<string>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const scope = parts[i];
    if (scope !== 'local' && scope !== 'worktree') continue;
    const nl = parts[i + 1].indexOf('\n');
    const key = (nl < 0 ? parts[i + 1] : parts[i + 1].slice(0, nl)).trim();
    const value = nl < 0 ? '' : parts[i + 1].slice(nl + 1);
    // git met en minuscules section et nom, pas la sous-section : comparaison insensible à la casse.
    const rule = RULES.find((x) => x.key.test(key.toLowerCase()));
    if (!rule || LEVEL[rule.from] > LEVEL[op]) continue;
    if (rule.safe?.(value)) continue;
    found.add(key);
  }
  return [...found].sort();
}

/** Refuse un dépôt dont la configuration exécuterait des commandes (ou détournerait ses remotes) pendant `op`. */
export async function assertSafeRepo(root: string, op: GitOperation = 'network'): Promise<void> {
  const unsafe = await unsafeConfig(root, op);
  if (unsafe.length) {
    const what = op === 'read' ? 'à la lecture' : op === 'write' ? 'pendant le merge' : 'pendant fetch / push';
    const error: ApiError = {
      code: 'unknown',
      message: `Dépôt refusé : sa configuration locale exécuterait des commandes ou détournerait ses remotes ${what} (${unsafe.join(', ')}).`,
    };
    throw error;
  }
}
