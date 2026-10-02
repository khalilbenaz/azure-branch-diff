import type { AzureSource, LocalRef, LocalRepoInfo, MergeStartInput, RepoRefLike, Side } from './sidesTypes';

export type { RepoRefLike };

/** Choix d'un côté dans la barre d'outils (avant validation). */
export type SideDraft = { kind: 'azure'; branch: string } | { kind: 'local'; ref: LocalRef | null };

export const refKey = (r: LocalRef | null): string => (!r ? '' : r.type === 'worktree' ? 'worktree' : `${r.type}:${r.name}`);

export function parseRefKey(key: string): LocalRef | null {
  if (key === 'worktree') return { type: 'worktree' };
  const i = key.indexOf(':');
  if (i < 0) return null;
  const type = key.slice(0, i);
  const name = key.slice(i + 1);
  return type === 'branch' || type === 'remote' ? { type, name } : null;
}

export function refLabel(r: LocalRef, clone?: LocalRepoInfo | null, role: 'source' | 'cible' = 'source'): string {
  // En cible, la comparaison part du dernier commit de la branche extraite (HEAD), pas des fichiers modifiés.
  if (r.type === 'worktree') {
    if (clone && !clone.git) return 'contenu du dossier';
    const b = clone?.current ? ` (${clone.current})` : '';
    return role === 'cible' ? `HEAD${b}` : `copie de travail${b}`;
  }
  return r.type === 'branch' ? r.name : `origin/${r.name}`;
}

/** Côté complet, ou null s'il manque une information. */
export function toSide(d: SideDraft, repo: RepoRefLike | null, clone: LocalRepoInfo | null): Side | null {
  if (d.kind === 'azure')
    return repo && d.branch ? ({ kind: 'azure', project: repo.project, repoId: repo.repoId, branch: d.branch } satisfies AzureSource) : null;
  return clone && d.ref ? { kind: 'local', root: clone.root, ref: d.ref } : null;
}

export function sideLabel(s: Side, clone?: LocalRepoInfo | null, role: 'source' | 'cible' = 'source'): string {
  return s.kind === 'azure' ? s.branch : refLabel(s.ref, clone, role);
}

export const sameSide = (a: Side, b: Side) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Paramètres d'un merge local (source → cible) dans le clone, ou la raison pour laquelle il est impossible.
 * Azure → branche distante origin/x ; copie de travail en cible → branche extraite.
 */
export function mergeInput(source: Side, target: Side, clone: LocalRepoInfo | null): { input: MergeStartInput } | { reason: string } {
  if (!clone) return { reason: 'Choisissez un clone local du dépôt pour fusionner localement.' };
  if (!clone.git)
    return { reason: 'Fusionner nécessite un clone git : le dossier choisi n’est pas un dépôt (archive téléchargée ?). Il reste comparable.' };
  let src: MergeStartInput['source'];
  if (source.kind === 'azure') src = { type: 'remote', name: source.branch };
  else if (source.ref.type === 'worktree') return { reason: 'La source d’un merge doit être une branche (commitez d’abord la copie de travail).' };
  else src = source.ref;
  let tgt: MergeStartInput['target'];
  if (target.kind === 'azure') tgt = { kind: 'remote', branch: target.branch };
  else if (target.ref.type === 'worktree') {
    if (!clone.current) return { reason: 'La copie de travail n’est sur aucune branche (HEAD détachée).' };
    tgt = { kind: 'local', branch: clone.current };
  } else tgt = target.ref.type === 'branch' ? { kind: 'local', branch: target.ref.name } : { kind: 'remote', branch: target.ref.name };
  return { input: { root: clone.root, source: src, target: tgt } };
}
