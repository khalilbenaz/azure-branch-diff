import type { AzureSource, ChangeEntry, Resolution, Source } from '../../../shared/types';

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

/** Branche Azure où le fichier existe, pour « Ouvrir dans Azure » ; null s'il n'existe que localement. */
export function azureFileBranch(entry: ChangeEntry, source: Source, target: AzureSource): string | null {
  if (source.kind === 'local') return entry.change === 'add' ? null : target.branch;
  return entry.change === 'delete' ? target.branch : source.branch;
}
