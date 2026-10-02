import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoRef } from '../../shared/api';
import type { ApiError, LocalRepoInfo, MergeState, PrSummary } from '../../shared/types';
import { api, asApiError, call } from './lib/api';
import { AppCtx, type AppState, type Selection, type Tab } from './lib/context';
import { ErrorBanner } from './components/ErrorBanner';
import { Sidebar } from './components/Sidebar';
import { UpdateBanner } from './components/UpdateBanner';
import { Login } from './pages/Login';
import { Compare } from './pages/Compare';
import { PullRequest } from './pages/PullRequest';
import { Conflicts } from './pages/Conflicts';
import { Merge } from './pages/Merge';
import { Guide } from './pages/Guide';

const updates = (window as unknown as { updates?: { get(): Promise<{ version: string }> } }).updates;

export default function App() {
  const [orgUrl, setOrgUrl] = useState<string | null | undefined>(undefined);
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('compare');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pr, setPr] = useState<PrSummary | null>(null);
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [clone, setClone] = useState<LocalRepoInfo | null>(null);
  const [merge, setMerge] = useState<MergeState | null>(null);
  const [openConflicts, setOpenConflicts] = useState<number | null>(null);
  const [version, setVersion] = useState('');
  const [shellError, setShellError] = useState<ApiError | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);

  useEffect(() => {
    if (!orgUrl) return;
    void call(api.orgs()).then(
      (st) => setOrgs(st.orgs.map((o) => o.orgUrl)),
      () => setOrgs([]),
    );
  }, [orgUrl]);

  useEffect(() => {
    void updates
      ?.get()
      .then((r) => setVersion(r.version))
      .catch(() => {});
  }, []);

  const loadSession = useCallback(async () => {
    setStartError(null);
    try {
      const s = await call(api.session());
      setOrgUrl(s?.orgUrl ?? null);
    } catch (e) {
      setStartError(asApiError(e));
      setOrgUrl(null);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const state = useMemo<AppState | null>(
    () =>
      orgUrl
        ? {
            orgUrl,
            repo,
            setRepo,
            clone,
            merge,
            setMerge,
            pickClone: async () => {
              try {
                const dir = await call(api.pickFolder());
                if (!dir) return null;
                const info = await call(api.localRepo(dir));
                setClone(info);
                return info;
              } catch (e) {
                setShellError(asApiError(e));
                return null;
              }
            },
            refreshClone: async () => {
              if (!clone) return;
              try {
                setClone(await call(api.localRepo(clone.root)));
              } catch (e) {
                setShellError(asApiError(e));
              }
            },
            setOpenConflicts,
            selection,
            setSelection,
            pr,
            setPr,
            goTo: setTab,
            handleAuth: (e) => {
              if (e.code !== 'auth') return false;
              setStartError(e);
              setSelection(null);
              setPr(null);
              setRepo(null);
              setClone(null);
              setMerge(null);
              setOrgUrl(null);
              return true;
            },
          }
        : null,
    [orgUrl, selection, pr, repo, clone, merge],
  );

  if (orgUrl === undefined) return <div className="center muted">Chargement…</div>;

  if (!state) {
    return (
      <>
        {startError && (
          <div className="top-error">
            <ErrorBanner error={startError} onRetry={loadSession} onClose={() => setStartError(null)} />
          </div>
        )}
        <div className="top-update">
          <UpdateBanner />
        </div>
        <Login
          onLogged={(url) => {
            setStartError(null);
            setOrgUrl(url);
          }}
        />
      </>
    );
  }

  /** Bascule d'organisation : le dépôt, la sélection et la PR sont remis à zéro ; le clone local est gardé. */
  async function switchOrg(url: string) {
    if (url === orgUrl) return;
    try {
      const r = await call(api.connectOrg(url));
      setSelection(null);
      setPr(null);
      setRepo(null);
      setTab('compare');
      setOrgUrl(r.orgUrl);
    } catch (e) {
      const err = asApiError(e);
      if (!state?.handleAuth(err)) setShellError(err);
    }
  }

  async function logout() {
    await api.logout();
    setSelection(null);
    setPr(null);
    setRepo(null);
    setClone(null);
    setMerge(null);
    setOrgUrl(null);
  }

  return (
    <AppCtx.Provider value={state}>
      <div className="shell">
        <Sidebar
          key={state.orgUrl}
          tab={tab}
          onTab={setTab}
          openConflicts={pr ? openConflicts : null}
          version={version}
          onLogout={logout}
          onError={(e) => {
            if (!state.handleAuth(e)) setShellError(e);
          }}
          orgs={orgs}
          onSwitchOrg={switchOrg}
        />
        <main className="main">
          {shellError && (
            <div className="top-error">
              <ErrorBanner error={shellError} onClose={() => setShellError(null)} />
            </div>
          )}
          <UpdateBanner />
          <section hidden={tab !== 'compare'} className="page">
            <Compare />
          </section>
          <section hidden={tab !== 'pr'} className="page">
            <PullRequest />
          </section>
          <section hidden={tab !== 'conflicts'} className="page">
            <Conflicts active={tab === 'conflicts'} />
          </section>
          <section hidden={tab !== 'merge'} className="page">
            <Merge active={tab === 'merge'} />
          </section>
          <section hidden={tab !== 'guide'} className="page">
            <Guide />
          </section>
        </main>
      </div>
    </AppCtx.Provider>
  );
}
