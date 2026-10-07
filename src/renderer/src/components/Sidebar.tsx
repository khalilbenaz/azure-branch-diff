import { useEffect, useState, type ReactElement } from 'react';
import type { ApiError, NamedRef } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp, type Tab } from '../lib/context';
import { ThemeToggle } from './ThemeToggle';
import { IconBook, IconCompare, IconConflict, IconFolder, IconLogo, IconMerge, IconPr, IconReload } from '../lib/icons';

interface Props {
  tab: Tab;
  onTab(t: Tab): void;
  openConflicts: number | null;
  version: string;
  onLogout(): void;
  onError(e: ApiError): void;
  /** Organisations enregistrées (bascule). */
  orgs: string[];
  onSwitchOrg(orgUrl: string): void;
}

const NAV: { id: Tab; label: string; icon: () => ReactElement }[] = [
  { id: 'compare', label: 'Comparer', icon: IconCompare },
  { id: 'pr', label: 'Pull Request', icon: IconPr },
  { id: 'conflicts', label: 'Conflits PR', icon: IconConflict },
  { id: 'merge', label: 'Merge local', icon: () => <IconMerge /> },
  { id: 'guide', label: 'Guide', icon: IconBook },
];

/** Diffusé par « Actualiser » : la barre d'outils recharge ses branches. */
export const REFRESH_EVENT = 'abd:refresh';

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function Sidebar({ tab, onTab, openConflicts, version, onLogout, onError, orgs, onSwitchOrg }: Props) {
  const app = useApp();
  const [projects, setProjects] = useState<NamedRef[]>([]);
  const [project, setProject] = useState('');
  const [repos, setRepos] = useState<NamedRef[]>([]);
  const [reload, setReload] = useState(0);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      onError(asApiError(e));
    }
  };

  // Chaque effet ignore sa réponse si la sélection a changé entre-temps (réponses dans le désordre).
  useEffect(() => {
    let stale = false;
    void guard(async () => {
      const ps = await call(api.projects());
      if (!stale) setProjects(ps);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    let stale = false;
    setRepos([]);
    app.setRepo(null);
    if (project)
      void guard(async () => {
        const rs = await call(api.repos(project));
        if (!stale) setRepos(rs);
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // « Actualiser » : recharge aussi les dépôts du projet (sélection gardée) et les branches de la barre d'outils.
  useEffect(() => {
    if (!reload) return;
    let stale = false;
    if (project)
      void guard(async () => {
        const rs = await call(api.repos(project));
        if (!stale) setRepos(rs);
      });
    window.dispatchEvent(new Event(REFRESH_EVENT));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const mergeConflicts = app.merge?.conflicts.filter((c) => !c.resolved).length ?? 0;

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark">
          <IconLogo />
        </div>
        <div className="brand-name">
          <strong>Azure Branch Diff</strong>
          <span title={app.orgUrl}>{app.orgUrl.replace(/^https:\/\//, '')}</span>
        </div>
      </div>

      {orgs.length > 1 && (
        <label className="side-org">
          Organisation
          <select value={app.orgUrl} onChange={(e) => onSwitchOrg(e.target.value)} aria-label="Organisation active">
            {orgs.map((o) => (
              <option key={o} value={o}>
                {o.replace(/^https:\/\/(dev\.azure\.com\/)?/, '')}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="side-fields">
        <div className="row">
          <label>
            Projet
            <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Projet">
              <option value="">Choisir un projet…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button className="side-reload" title="Actualiser les projets, dépôts et branches" aria-label="Actualiser la liste" onClick={() => setReload((n) => n + 1)}>
            <IconReload />
          </button>
        </div>
        <label>
          Dépôt Azure
          <select
            value={app.repo?.repoId ?? ''}
            disabled={!repos.length}
            aria-label="Dépôt"
            onChange={(e) => {
              const r = repos.find((x) => x.id === e.target.value);
              app.setRepo(r ? { project, repoId: r.id, repoName: r.name } : null);
            }}
          >
            <option value="">Choisir un dépôt…</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="side-clone">
          <span>Clone local</span>
          <button onClick={() => void app.pickClone()} title={app.clone?.root ?? 'Choisir un clone git sur le disque'} aria-label="Clone local">
            <IconFolder />
            <span className="name">{app.clone ? folderName(app.clone.root) : 'Choisir un clone…'}</span>
            {app.clone && <span className="hint">changer</span>}
          </button>
        </div>
      </div>

      <nav className="nav" role="tablist" aria-orientation="vertical" aria-label="Navigation">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
            <Icon />
            {label}
            {id === 'pr' && app.pr && <span className="count">#{app.pr.id}</span>}
            {id === 'conflicts' && !!openConflicts && <span className="count alert">{openConflicts}</span>}
            {id === 'merge' && app.merge && mergeConflicts > 0 && <span className="count alert">{mergeConflicts}</span>}
            {id === 'merge' && app.merge && mergeConflicts === 0 && <span className="count">•</span>}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <ThemeToggle className="on-dark" />
        <span>Version {version}</span>
        <div className="row">
          <button onClick={onLogout} title="Ajouter, retirer ou changer d'organisation">
            Organisations…
          </button>
          <button onClick={onLogout}>Déconnexion</button>
        </div>
      </div>
    </aside>
  );
}
