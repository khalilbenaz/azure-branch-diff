import { useEffect, useRef, useState } from 'react';
import type { ApiError, PrSummary } from '../../../shared/types';
import { api, asApiError, call, openUrl } from '../lib/api';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { parseWorkItems } from '../lib/prLogic';
import { IconExternal } from '../lib/icons';
import { CompletePr } from './CompletePr';

const STATUS_TEXT: Record<PrSummary['mergeStatus'], string> = {
  notSet: 'Merge non calculé',
  queued: 'Azure calcule encore le merge…',
  conflicts: 'Conflits à résoudre',
  succeeded: 'Prête à être complétée (aucun conflit)',
  rejectedByPolicy: 'Rejetée par une politique de branche',
  failure: 'Échec du calcul du merge',
};

export function PullRequest() {
  const app = useApp();
  const sel = app.selection;
  const [existing, setExisting] = useState<PrSummary | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workItems, setWorkItems] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [completed, setCompleted] = useState<PrSummary | null>(null);

  const report = (e: unknown) => {
    const err = asApiError(e);
    if (!app.handleAuth(err)) setError(err);
  };
  const open = (url: string) => openUrl(url).catch(report);

  // Sélection courante, pour ignorer les réponses arrivées après un changement de branches.
  const selNonce = useRef(sel?.nonce);
  selNonce.current = sel?.nonce;

  useEffect(() => {
    let stale = false;
    setExisting(undefined);
    setCompleted(null);
    setError(null);
    if (!sel) return;
    setTitle(`Merge ${sel.source} into ${sel.target}`);
    if (app.pr && (app.pr.sourceBranch !== sel.source || app.pr.targetBranch !== sel.target)) app.setPr(null);
    call(api.findPr(sel.repo, sel.source, sel.target)).then(
      (pr) => !stale && setExisting(pr),
      (e) => {
        if (stale) return;
        setExisting(null);
        report(e);
      },
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.nonce]);

  async function refresh(prId: number) {
    if (!sel) return;
    const nonce = sel.nonce;
    setWaiting(true);
    try {
      const pr = await call(api.waitPr(sel.repo, prId));
      if (selNonce.current === nonce) app.setPr(pr);
    } catch (e) {
      report(e);
    } finally {
      setWaiting(false);
    }
  }

  async function create() {
    if (!sel) return;
    const ids = parseWorkItems(workItems);
    if (!ids) {
      setError({
        code: 'unknown',
        message: 'Work items : saisissez des numéros séparés par des virgules.',
      });
      return;
    }
    const nonce = sel.nonce;
    setBusy(true);
    setError(null);
    try {
      const pr = await call(
        api.createPr(sel.repo, {
          source: sel.source,
          target: sel.target,
          title: title.trim(),
          description,
          workItemIds: ids,
        }),
      );
      if (selNonce.current !== nonce) return; // la sélection a changé pendant la création
      app.setPr(pr);
      setExisting(pr);
      await refresh(pr.id);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  if (!sel)
    return (
      <div className="empty">
        <div className="empty-inner" style={{ maxWidth: 560 }}>
          <h2>Pas encore de branches</h2>
          <p className="muted">Comparez d'abord deux branches Azure dans l'onglet « Comparer ».</p>
          <div>
            <button className="btn btn-primary" onClick={() => app.goTo('compare')}>
              Aller à Comparer
            </button>
          </div>
        </div>
      </div>
    );

  // Une PR d'autres branches (réponse tardive) n'est jamais affichée sous la sélection courante.
  const pr = app.pr && app.pr.sourceBranch === sel.source && app.pr.targetBranch === sel.target ? app.pr : null;

  return (
    <>
      <div className="page-head">
        <div className="title">
          <strong>{pr ? `PR #${pr.id} · ${pr.title}` : 'Pull Request'}</strong>
          <span className="mono muted">
            {sel.repo.repoName} · {sel.target} ← {sel.source}
          </span>
        </div>
        <span className="spacer" />
        {pr && (
          <button className="btn btn-ghost btn-sm" onClick={() => open(pr.url)}>
            Ouvrir dans Azure <IconExternal />
          </button>
        )}
      </div>
      <div className="content">
        <ErrorBanner error={error} onRetry={() => pr && refresh(pr.id)} onClose={() => setError(null)} />

        {completed && (
          <div className="card success">
            <h3>PR #{completed.id} complétée.</h3>
            <button className="btn" onClick={() => open(completed.url)}>
              Ouvrir dans Azure
            </button>
          </div>
        )}

        {!completed && existing === undefined && <p className="muted">Recherche d'une PR existante…</p>}

        {!completed && existing && !pr && (
          <div className="card">
            <h3>
              PR #{existing.id} déjà ouverte : {existing.title}
            </h3>
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={() => {
                  app.setPr(existing);
                  void refresh(existing.id);
                }}
              >
                Utiliser cette PR
              </button>
              <button className="btn" onClick={() => open(existing.url)}>
                Ouvrir dans Azure
              </button>
            </div>
          </div>
        )}

        {!completed && existing === null && !pr && (
          <div className="card">
            <h3>Nouvelle Pull Request</h3>
            <label>
              Titre
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label>
              Description
              <textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              Work items liés (facultatif)
              <input value={workItems} onChange={(e) => setWorkItems(e.target.value)} placeholder="ex. 1234, 5678" />
            </label>
            <button className="btn btn-primary" disabled={busy || !title.trim()} onClick={create}>
              {busy ? 'Création…' : 'Créer la PR'}
            </button>
          </div>
        )}

        {!completed && pr && (
          <>
            <div className="card">
              <div className="row">
                <h3>
                  PR #{pr.id} : {pr.title}
                </h3>
              </div>
              <p className={`status status-${pr.mergeStatus}`}>{waiting ? 'Calcul du merge…' : STATUS_TEXT[pr.mergeStatus]}</p>
              <div className="row">
                <button className="btn" disabled={waiting} onClick={() => refresh(pr.id)}>
                  Actualiser
                </button>
                {pr.mergeStatus === 'conflicts' && (
                  <button className="btn btn-primary" onClick={() => app.goTo('conflicts')}>
                    Gérer les conflits
                  </button>
                )}
              </div>
            </div>
            {pr.mergeStatus === 'succeeded' && !waiting && (
              <CompletePr
                repo={sel.repo}
                pr={pr}
                onAuth={app.handleAuth}
                onDone={(done) => {
                  if (done.status === 'completed') {
                    setCompleted(done);
                    app.setPr(null);
                    return;
                  }
                  app.setPr(done);
                  setError({
                    code: 'unknown',
                    message: done.failureMessage
                      ? `La complétion a échoué : ${done.failureMessage}`
                      : 'Azure termine encore la complétion : cliquez sur « Actualiser » dans quelques instants.',
                  });
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
