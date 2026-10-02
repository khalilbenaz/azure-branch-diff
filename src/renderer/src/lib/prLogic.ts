import type { ChangeEntry, Resolution, Side } from '../../../shared/types';

/** "12, 34 56" → [12, 34, 56] ; null si une valeur n'est pas un entier positif. */
export function parseWorkItems(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (!parts.every((p) => /^\d+$/.test(p) && Number(p) > 0)) return null;
  return parts.map(Number);
}

/** Résolution la plus simple : un côté entier si le résultat lui est identique, sinon le contenu édité. */
export function toResolution(result: string, source: string, target: string, bom = false): Resolution {
  if (result === source) return { kind: 'source' };
  if (result === target) return { kind: 'target' };
  return { kind: 'content', text: bom ? `\uFEFF${result}` : result };
}

/** Branche Azure où le fichier existe, pour « Ouvrir dans Azure » ; null s'il n'existe sur aucune branche Azure comparée. */
export function azureFileBranch(entry: ChangeEntry, source: Side, target: Side): string | null {
  if (source.kind === 'azure' && entry.change !== 'delete') return source.branch;
  if (target.kind === 'azure' && entry.change !== 'add') return target.branch;
  return null;
}
