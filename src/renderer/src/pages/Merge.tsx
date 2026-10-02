import { useEffect, useRef, useState } from 'react';
import type { ApiError, FileSide, MergeConflict, MergeResolution } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { Resolver } from '../components/Resolver';

const KIND_LABEL: Record<MergeConflict['kind'], string> = {
  text: 'Modifié des deux côtés',
  binary: 'Binaire ou non UTF-8',
  deleted: 'Supprimé d’un côté',
};

type Sides = { base: FileSide; target: FileSide; source: FileSide; merged: FileSide };

/** Merge local : conflits, commit, push. */
export function Merge({ active }: { active: boolean }) {
  const app = useApp();
  const m = app.merge;
  const [error, setError] = useState<ApiError | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [sides, setSides] = useState<Sides | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [policyRefused, setPolicyRefused] = useState(false);
  const currentRef = useRef<string | null>(null);

  const report = (e: unknown) => {
    const err = asApiError(e);
    if (!app.handleAuth(err)) setError(err);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void call(api.mergeState()).then(app.setMerge, report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!m) return;
    setMessage(`Merge ${m.sourceLabel.replace(/^origin\//, '')} into ${m.targetLabel.replace(/^origin\//, '')}`);
    setPolicyRefused(false);
    setCurrent(null);
    setSides(null);
  }, [m?.dir, m?.sourceLabel, m?.targetLabel]);

  async function open(c: MergeConflict) {
    currentRef.current = c.path;
    setCurrent(c.path);
    setSides(null);
    if (c.kind !== 'text') return;
    try {
      const s = await call(api.mergeConflictSides(c.path));
      // Réponse d'un fichier précédemment cliqué : ignorée (sinon son contenu serait écrit dans un autre fichier).
      if (currentRef.current === c.path) setSides(s);
    } catch (e) {
      if (currentRef.current === c.path) report(e);
    }
  }

  const resolve = (path: string, r: MergeResolution) =>
    run(async () => {
      app.setMerge(await call(api.mergeResolve(path, r)));
      setCurrent(null);
      setSides(null);
    });

  const push = () =>
    run(async () => {
      try {
        app.setMerge(await call(api.mergePush()));
      } catch (e) {
        if (asApiError(e).code === 'policy') setPolicyRefused(true);
        throw e;
      }
    });

  const commit = () =>
    run(async () => {
      const st = await call(api.mergeCommit(message));
      app.setMerge(st);
      // Cible Azure : le push est la finalité de cette direction.
      if (st.targetIsRemote) {
        try {
          app.setMerge(await call(api.mergePush()));
        } catch (e) {
          if (asApiError(e).code === 'policy') setPolicyRefused(true);
          throw e;
        }
      }
    });

  const close = () =>
    run(async () => {
      if (m?.phase === 'committed' && m.targetIsRemote) {
        const ok = window.confirm(
          `Le commit de merge ${m.commit?.slice(0, 10)} n'a pas été poussé vers ${m.targetLabel}. Il reste conservé dans le clone (refs/abd/merges/). Terminer quand même ?`,
        );
        if (!ok) return;
      }
      await call(api.mergeClose());
      app.setMerge(null);
      await app.refreshClone();
    });

  const abort = () =>
    run(async () => {
      if (!window.confirm('Annuler le merge ? La branche cible reste inchangée.')) return;
      await call(api.mergeAbort());
      app.setMerge(null);
    });

  const fallbackPr = () =>
    run(async () => {
      if (!app.repo || !m) return;
      const pr = await call(api.mergeFallbackPr(app.repo, message));
      await call(api.mergeClose());
      app.setMerge(null);
      await app.refreshClone();
      app.setSelection({ repo: app.repo, source: pr.sourceBranch, target: pr.targetBranch, nonce: Date.now() });
      app.setPr(pr);
      app.goTo('pr');
    });

  if (!m)
    return (
      <div className="empty">
        <div className="empty-inner" style={{ maxWidth: 600 }}>
          <h2>Aucun merge local en cours</h2>
          <p className="muted">
            Dans « Comparer », choisissez une source et une cible (Azure ou locales), puis « Fusionner ». Le merge se fait dans un worktree temporaire
            : votre copie de travail ne passe jamais par un état de merge ; si la cible est la branche extraite, elle avance seulement après le
            commit.
          </p>
          <div>
            <button className="btn btn-primary" onClick={() => app.goTo('compare')}>
              Aller à Comparer
            </button>
          </div>
        </div>
      </div>
    );

  const remaining = m.conflicts.filter((c) => !c.resolved).length;
  const cur = m.conflicts.find((c) => c.path === current) ?? null;
  const open_ = m.phase === 'conflicts' || m.phase === 'ready';

  return (
    <>
      <div className="page-head">
        <div className="title">
          <strong>Merge local</strong>
          <span className="mono muted">
            {m.sourceLabel} → {m.targetLabel}
          </span>
        </div>
        {m.conflicts.length > 0 && open_ && (
          <span className={remaining ? 'chip chip-edit' : 'chip chip-add'}>
            {remaining ? `${remaining} conflit${remaining > 1 ? 's' : ''} sur ${m.conflicts.length}` : 'Conflits résolus'}
          </span>
        )}
        <span className="chip chip-ren">worktree temporaire · copie de travail intacte</span>
        <span className="spacer" />
        <span className="small muted">Hooks git non exécutés</span>
      </div>
      {error && (
        <div className="pad" style={{ paddingBottom: 0 }}>
          <ErrorBanner error={error} onClose={() => setError(null)} />
          {policyRefused && app.repo && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" disabled={busy} onClick={fallbackPr}>
                Créer une PR à la place
              </button>
              <span className="small muted">
                Le commit de merge part sur une branche dédiée, puis une PR vers {m.targetLabel.replace(/^origin\//, '')} est créée.
              </span>
            </div>
          )}
        </div>
      )}

      {m.phase === 'upToDate' && (
        <div className="content">
          <div className="card success">
            <h3>
              Rien à fusionner : {m.targetLabel} contient déjà {m.sourceLabel}.
            </h3>
            <div>
              <button className="btn" onClick={close}>
                Terminer
              </button>
            </div>
          </div>
        </div>
      )}

      {(m.phase === 'committed' || m.phase === 'pushed') && (
        <div className="content">
          <div className="card success">
            <h3>{m.phase === 'pushed' ? 'Merge commité et poussé.' : 'Merge commité.'}</h3>
            <p className="mono small">
              {m.commit?.slice(0, 10)} · {m.targetLabel}
            </p>
            <div className="row">
              {m.phase === 'committed' && (
                <button className="btn btn-primary" disabled={busy} onClick={push}>
                  {busy ? 'Push…' : `Pousser vers origin/${m.targetLabel.replace(/^origin\//, '')}`}
                </button>
              )}
              <button className="btn" disabled={busy} onClick={close}>
                Terminer
              </button>
            </div>
          </div>
        </div>
      )}

      {open_ && (
        <div className="conflicts-split">
          <ul className="conflict-list" aria-label="Conflits du merge">
            {m.conflicts.length === 0 && <li className="pad muted">Aucun conflit : le merge est prêt à être commité.</li>}
            {m.conflicts.map((c) => (
              <li key={c.path} className={current === c.path ? 'conflict-item selected' : 'conflict-item'}>
                <button className="link-row" onClick={() => open(c)} disabled={c.resolved}>
                  <span className="mono">{c.path}</span>
                  <span className="small muted">{KIND_LABEL[c.kind]}</span>
                  {c.resolved ? <span className="state-done">Résolu</span> : <span className="state-todo">À résoudre</span>}
                </button>
              </li>
            ))}
          </ul>
          <section className="resolver" aria-label="Résolution">
            {!cur && (
              <div className="diff-empty">
                {remaining ? 'Choisissez un conflit à gauche.' : 'Tous les conflits sont résolus : validez le commit.'}
              </div>
            )}
            {cur && cur.kind === 'text' && !sides && <div className="diff-empty">Chargement…</div>}
            {cur && cur.kind === 'text' && sides && (
              <Resolver
                path={cur.path}
                sides={sides}
                sourceLabel={m.sourceLabel}
                targetLabel={m.targetLabel}
                busy={busy}
                submitLabel="Marquer résolu"
                resultHint="écrit dans le worktree"
                onSubmit={(r) => resolve(cur.path, r)}
              />
            )}
            {cur && cur.kind !== 'text' && (
              <div className="diff-empty">
                <p>
                  <span className="mono">{cur.path}</span> : {KIND_LABEL[cur.kind].toLowerCase()}. Choisissez la version à garder.
                </p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'source' })}>
                    Garder source
                  </button>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'target' })}>
                    Garder cible
                  </button>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'delete' })}>
                    Supprimer le fichier
                  </button>
                </div>
              </div>
            )}
            <div className="commit-panel">
              <label>
                Message du commit de merge
                <input className="field-mono" value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <button className="btn" disabled={busy} onClick={abort}>
                Annuler le merge
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || remaining > 0}
                onClick={commit}
                title={remaining ? 'Résolvez d’abord tous les conflits' : ''}
              >
                {busy ? 'Commit…' : m.targetIsRemote ? 'Valider le commit et pousser' : 'Valider le commit'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
