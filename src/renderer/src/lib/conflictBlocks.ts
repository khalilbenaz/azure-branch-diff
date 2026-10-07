/** Blocs de conflit git (`<<<<<<<`, `|||||||` facultatif, `=======`, `>>>>>>>`) dans un fichier fusionné. */
export interface ConflictBlock {
  /** Version de la cible (côté HEAD du merge). */
  target: string;
  /** Version de la source (branche fusionnée). */
  source: string;
  /** Ancêtre commun (style diff3), si présent. */
  base?: string;
  /** Première ligne du bloc (1 = première ligne du fichier). */
  startLine: number;
  /** Position du bloc (marqueurs compris) dans le texte. */
  start: number;
  end: number;
}

export type BlockChoice = 'target' | 'source' | 'both';

const START = /^<{7}(?: .*)?$/;
const BASE = /^\|{7}(?: .*)?$/;
const SEP = /^={7}$/;
const END = /^>{7}(?: .*)?$/;

/** Lignes avec leur fin (\n ou \r\n) et leur position. */
function lines(text: string) {
  const out: { text: string; raw: string; start: number }[] = [];
  let pos = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const stop = nl === -1 ? text.length : nl + 1;
    const raw = text.slice(pos, stop);
    out.push({ text: raw.replace(/\r?\n$/, ''), raw, start: pos });
    pos = stop;
  }
  return out;
}

export function conflictBlocks(text: string): ConflictBlock[] {
  const ls = lines(text);
  const blocks: ConflictBlock[] = [];
  for (let i = 0; i < ls.length; i++) {
    if (!START.test(ls[i].text)) continue;
    let j = i + 1;
    let target = '';
    let base: string | undefined;
    let source = '';
    let part: 'target' | 'base' | 'source' = 'target';
    let closed = false;
    for (; j < ls.length; j++) {
      const t = ls[j].text;
      if (part === 'target' && BASE.test(t)) part = 'base';
      else if (part !== 'source' && SEP.test(t)) part = 'source';
      else if (part === 'source' && END.test(t)) {
        closed = true;
        break;
      } else if (START.test(t)) break; // bloc mal formé : on repart de ce marqueur
      else if (part === 'target') target += ls[j].raw;
      else if (part === 'base') base = (base ?? '') + ls[j].raw;
      else source += ls[j].raw;
    }
    if (!closed) continue;
    blocks.push({ target, source, base, startLine: i + 1, start: ls[i].start, end: ls[j].start + ls[j].raw.length });
    i = j;
  }
  return blocks;
}

/** Remplace le bloc n° `index` (parmi ceux qui restent) par la version choisie. */
export function applyChoice(text: string, index: number, choice: BlockChoice): string {
  const b = conflictBlocks(text)[index];
  if (!b) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const withEol = (s: string) => (s && !s.endsWith('\n') ? s + eol : s);
  const kept = choice === 'target' ? b.target : choice === 'source' ? b.source : withEol(b.target) + b.source;
  return text.slice(0, b.start) + kept + text.slice(b.end);
}
