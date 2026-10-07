import { useDeferredValue, useMemo, useState } from 'react';
import type { ChangeEntry } from '../../../shared/types';

export const BADGE: Record<ChangeEntry['change'], string> = {
  add: 'A',
  edit: 'M',
  delete: 'D',
  rename: 'R',
};
const TITLE: Record<ChangeEntry['change'], string> = {
  add: 'Ajouté',
  edit: 'Modifié',
  delete: 'Supprimé',
  rename: 'Renommé',
};

/** Taille d'une tranche d'affichage : garde le DOM léger sur les très gros diffs. */
const CHUNK = 500;

export type LineCounts = Record<string, { added: number; removed: number }>;

interface Props {
  changes: ChangeEntry[];
  counts: LineCounts;
  selected: string | null;
  onSelect(e: ChangeEntry): void;
}

const extOf = (p: string) => {
  const name = p.split('/').pop() ?? '';
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.split('/').pop() ?? p;

export function FileTree({ changes, counts, selected, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [ext, setExt] = useState('');
  const deferredQuery = useDeferredValue(query);
  // La limite d'affichage est liée à la liste filtrée : elle revient à CHUNK dès que la liste change, sans second rendu.
  const [paging, setPaging] = useState<{ key: unknown[]; limit: number }>({
    key: [],
    limit: CHUNK,
  });
  const key = [changes, deferredQuery, ext];
  const sameKey = paging.key.length === key.length && paging.key.every((k, i) => k === key[i]);
  const limit = sameKey ? paging.limit : CHUNK;
  // Dossiers repliés, réinitialisés quand la liste des changements change.
  const [folded, setFolded] = useState<{ changes: ChangeEntry[]; dirs: Set<string> }>({
    changes,
    dirs: new Set(),
  });
  const collapsed = folded.changes === changes ? folded.dirs : new Set<string>();
  const toggleDir = (dir: string) => {
    const next = new Set(collapsed);
    if (next.has(dir)) next.delete(dir);
    else next.add(dir);
    setFolded({ changes, dirs: next });
  };

  const extensions = useMemo(() => [...new Set(changes.map((c) => extOf(c.path)).filter(Boolean))].sort(), [changes]);

  const groups = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const filtered = changes.filter((c) => (!q || c.path.toLowerCase().includes(q)) && (!ext || extOf(c.path) === ext));
    const map = new Map<string, ChangeEntry[]>();
    for (const c of filtered.slice(0, limit)) {
      const d = dirOf(c.path);
      const list = map.get(d);
      if (list) list.push(c);
      else map.set(d, [c]);
    }
    return {
      total: filtered.length,
      dirs: [...map.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [changes, deferredQuery, ext, limit]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const n of Object.values(counts)) {
      added += n.added;
      removed += n.removed;
    }
    return { added, removed };
  }, [counts]);

  const allFolded = groups.dirs.length > 0 && groups.dirs.every(([d]) => collapsed.has(d));
  const foldAll = () => setFolded({ changes, dirs: allFolded ? new Set() : new Set(groups.dirs.map(([d]) => d)) });

  const summary = useMemo(() => {
    const s = { add: 0, edit: 0, delete: 0, rename: 0 };
    for (const c of changes) s[c.change]++;
    return s;
  }, [changes]);

  return (
    <div className="tree">
      <div className="tree-head">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>
            {changes.length} fichier{changes.length > 1 ? 's' : ''}
          </h3>
          {(totals.added > 0 || totals.removed > 0) && (
            <span className="counts" title="Lignes des fichiers déjà ouverts">
              <span className="plus">+{totals.added}</span> <span className="minus">−{totals.removed}</span>
            </span>
          )}
        </div>
        <div className="tree-filters">
          <input
            type="search"
            placeholder="Filtrer les fichiers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filtrer les fichiers"
          />
          <select value={ext} onChange={(e) => setExt(e.target.value)} aria-label="Extension">
            <option value="">Tous</option>
            {extensions.map((x) => (
              <option key={x} value={x}>
                .{x}
              </option>
            ))}
          </select>
        </div>
        <div className="row tree-chips">
          {summary.add > 0 && (
            <span className="chip chip-add">
              {summary.add} ajouté{summary.add > 1 ? 's' : ''}
            </span>
          )}
          {summary.edit > 0 && (
            <span className="chip chip-edit">
              {summary.edit} modifié{summary.edit > 1 ? 's' : ''}
            </span>
          )}
          {summary.delete > 0 && (
            <span className="chip chip-del">
              {summary.delete} supprimé{summary.delete > 1 ? 's' : ''}
            </span>
          )}
          {summary.rename > 0 && (
            <span className="chip chip-ren">
              {summary.rename} renommé{summary.rename > 1 ? 's' : ''}
            </span>
          )}
          {groups.dirs.length > 1 && (
            <button type="button" className="tree-foldall" onClick={foldAll}>
              {allFolded ? 'Tout déplier' : 'Tout replier'}
            </button>
          )}
        </div>
      </div>
      <ul className="tree-list">
        {groups.dirs.map(([dir, entries]) => {
          const open = !collapsed.has(dir);
          return (
            <li key={dir || '/'}>
              <button
                type="button"
                className="tree-dir"
                aria-expanded={open}
                onClick={() => toggleDir(dir)}
                title={open ? 'Replier ce dossier' : 'Déplier ce dossier'}
              >
                <svg className="tree-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="tree-dir-name">{dir || '/'}</span>
                <span className="tree-dir-count">{entries.length}</span>
              </button>
              {open && (
                <ul>
                  {entries.map((c) => {
                    const n = counts[c.path];
                    return (
                      <li key={c.path}>
                        <button
                          className={selected === c.path ? 'tree-file selected' : 'tree-file'}
                          onClick={() => onSelect(c)}
                          title={c.originalPath ? `${c.originalPath} → ${c.path}` : c.path}
                        >
                          <span className={`badge badge-${c.change}`} title={TITLE[c.change]}>
                            {BADGE[c.change]}
                          </span>
                          <span className="tree-name">{nameOf(c.path)}</span>
                          {c.inTarget && (
                            <span className="tree-tag" title="Déjà identique sur la cible : rien à apporter">
                              déjà dans la cible
                            </span>
                          )}
                          {n && (
                            <span className="counts">
                              <span className="plus">+{n.added}</span> <span className="minus">−{n.removed}</span>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {groups.total === 0 && <li className="muted pad">Aucun fichier.</li>}
        {groups.total > limit && (
          <li className="pad">
            <button className="btn" onClick={() => setPaging({ key, limit: limit + CHUNK })}>
              Afficher les {Math.min(CHUNK, groups.total - limit)} suivants ({groups.total - limit} restants)
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
