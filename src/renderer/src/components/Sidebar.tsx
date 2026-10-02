import { useEffect, useState, type ReactElement } from 'react';
import type { ApiError, NamedRef } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp, type Tab } from '../lib/context';
import { IconCompare, IconConflict, IconLogo, IconPr, IconReload } from '../lib/icons';

interface Props {
  tab: Tab;
  onTab(t: Tab): void;
  openConflicts: number | null;
  version: string;
  onLogout(): void;
  onError(e: ApiError): void;
}

const NAV: { id: Tab; label: string; icon: () => ReactElement }[] = [
  { id: 'compare', label: 'Comparer', icon: IconCompare },
  { id: 'pr', label: 'Pull Request', icon: IconPr },
  { id: 'conflicts', label: 'Conflits', icon: IconConflict },
];

export function Sidebar({ tab, onTab, openConflicts, version, onLogout, onError }: Props) {
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
          <button className="side-reload" title="Actualiser la liste" aria-label="Actualiser la liste" onClick={() => setReload((n) => n + 1)}>
            <IconReload />
          </button>
        </div>
        <label>
          Dépôt
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
      </div>

      <nav className="nav" role="tablist" aria-orientation="vertical" aria-label="Navigation">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
            <Icon />
            {label}
            {id === 'pr' && app.pr && <span className="count">#{app.pr.id}</span>}
            {id === 'conflicts' && !!openConflicts && <span className="count alert">{openConflicts}</span>}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <span>Version {version}</span>
        <button onClick={onLogout}>Déconnexion</button>
      </div>
    </aside>
  );
}
