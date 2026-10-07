import type { ChangeEntry, FileSide, Side } from '../../shared/types';
import type { CompareResult } from '../../shared/api';
import type { AzureContext } from '../azure/client';
import { EMPTY_SIDE } from '../azure/diff';
import { sidesContent } from './compareSides';

/** Lectures simultanées pendant l'analyse (Azure limite le débit par jeton). */
const CONCURRENCY = 8;

const words = (s: string) => s.replace(/^﻿/, '').split(/\s+/).filter(Boolean);

/**
 * Vrai si les deux versions ne diffèrent que par des espaces : indentation, lignes vides,
 * espaces de fin de ligne, CRLF / LF, BOM. Les mots restent séparés : « int x » ≠ « intx ».
 */
export function sameIgnoringWhitespace(a: FileSide, b: FileSide): boolean {
  if (a === EMPTY_SIDE || b === EMPTY_SIDE) return false; // fichier absent d'un côté : vrai changement
  if (a.isBinary || b.isBinary || a.tooLarge || b.tooLarge) return false;
  const x = words(a.content);
  const y = words(b.content);
  return x.length === y.length && x.every((w, i) => w === y[i]);
}

/** Chemins des changements dont les deux versions ne diffèrent que par des espaces. */
export async function whitespaceOnlyPaths(
  ctx: AzureContext | null,
  source: Side,
  target: Side,
  entries: ChangeEntry[],
  cmp: CompareResult,
): Promise<string[]> {
  const found = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const e = entries[next++];
      if (e.isBinary) continue;
      const { left, right } = await sidesContent(ctx, source, target, e, cmp);
      if (sameIgnoringWhitespace(left, right)) found.add(e.path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return entries.filter((e) => found.has(e.path)).map((e) => e.path);
}
