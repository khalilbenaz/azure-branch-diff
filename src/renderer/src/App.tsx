import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RepoRef } from '../../shared/api';
import type { ApiError, PrSummary } from '../../shared/types';
import { api, asApiError, call } from './lib/api';
import { AppCtx, type AppState, type Selection, type Tab } from './lib/context';
import { ErrorBanner } from './components/ErrorBanner';
import { Sidebar } from './components/Sidebar';
import { UpdateBanner } from './components/UpdateBanner';
import { Login } from './pages/Login';
import { Compare } from './pages/Compare';
import { PullRequest } from './pages/PullRequest';
import { Conflicts } from './pages/Conflicts';

const updates = (window as unknown as { updates?: { get(): Promise<{ version: string }> } }).updates;

export default function App() {
  const [orgUrl, setOrgUrl] = useState<string | null | undefined>(undefined);
  const [startError, setStartError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('compare');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pr, setPr] = useState<PrSummary | null>(null);
  const [repo, setRepo] = useState<RepoRef | null>(null);
  const [openConflicts, setOpenConflicts] = useState<number | null>(null);
  const [version, setVersion] = useState('');
  const [shellError, setShellError] = useState<ApiError | null>(null);

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
              setOrgUrl(null);
              return true;
            },
          }
        : null,
    [orgUrl, selection, pr, repo],
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

  async function logout() {
    await api.logout();
    setSelection(null);
    setPr(null);
    setRepo(null);
    setOrgUrl(null);
  }

  return (
    <AppCtx.Provider value={state}>
      <div className="shell">
        <Sidebar
          tab={tab}
          onTab={setTab}
          openConflicts={pr ? openConflicts : null}
          version={version}
          onLogout={logout}
          onError={(e) => {
            if (!state.handleAuth(e)) setShellError(e);
          }}
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
        </main>
      </div>
    </AppCtx.Provider>
  );
}
