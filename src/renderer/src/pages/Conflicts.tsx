import { useEffect, useRef, useState } from 'react';
import type { ApiError, ConflictEntry, FileSide, Resolution } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconExternal } from '../lib/icons';
import { Resolver } from '../components/Resolver';

const TYPE_LABEL: Record<string, string> = {
  editEdit: 'Modifié des deux côtés',
  addAdd: 'Ajouté des deux côtés',
  deleteEdit: 'Supprimé / modifié',
  editDelete: 'Modifié / supprimé',
  renameDelete: 'Renommé / supprimé',
  deleteRename: 'Supprimé / renommé',
  renameRename: 'Renommé des deux côtés',
};

type Sides = { source: FileSide; target: FileSide; base: FileSide };

export function Conflicts({ active }: { active: boolean }) {
  const app = useApp();
  const sel = app.selection;
  const pr = app.pr;
  const prIdRef = useRef(pr?.id);
  prIdRef.current = pr?.id;
  const [list, setList] = useState<ConflictEntry[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [current, setCurrent] = useState<ConflictEntry | null>(null);
  const [sides, setSides] = useState<Sides | null>(null);
  const [busy, setBusy] = useState(false);

  const report = (e: unknown) => {
    const err = asApiError(e);
    if (!app.handleAuth(err)) setError(err);
  };

  async function load() {
    if (!sel || !pr) return;
    try {
      const l = await call(api.conflicts(sel.repo, pr.id));
      setList(l);
      app.setOpenConflicts(l.filter((c) => !c.resolved).length);
    } catch (e) {
      report(e);
    }
  }

  useEffect(() => {
    setCurrent(null);
    setSides(null);
    setList(null);
    if (active) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pr?.id]);

  async function openInApp(c: ConflictEntry) {
    if (!sel || !pr) return;
    setCurrent(c);
    setSides(null);
    setError(null);
    try {
      const s = await call(api.conflictSides(sel.repo, pr.id, c.id));
      setSides(s);
    } catch (e) {
      setCurrent(null);
      report(e);
      if (asApiError(e).code === 'stale') void load();
    }
  }

  async function openInAzure() {
    if (!sel || !pr) return;
    try {
      await call(api.openExternal(await call(api.conflictsUrl(sel.repo, pr.id))));
    } catch (e) {
      report(e);
    }
  }

  async function submit(r: Resolution) {
    if (!sel || !pr || !current || !sides) return;
    setBusy(true);
    setError(null);
    try {
      await call(api.resolve(sel.repo, pr.id, current.id, r));
      setInfo(`Conflit résolu : ${current.path}`);
      setCurrent(null);
      setSides(null);
      await load();
    } catch (e) {
      report(e);
      if (asApiError(e).code === 'stale') {
        setCurrent(null);
        setSides(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!sel || !pr) return;
    const prId = pr.id;
    setBusy(true);
    try {
      const updated = await call(api.waitPr(sel.repo, prId, true));
      if (prIdRef.current !== prId) return; // une autre PR a été choisie entre-temps
      app.setPr(updated);
      app.goTo('pr');
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  if (!sel || !pr)
    return (
      <div className="empty">
        <div className="empty-inner" style={{ maxWidth: 560 }}>
          <h2>Pas de PR en cours</h2>
          <p className="muted">Créez ou choisissez d'abord une PR dans l'onglet « Pull Request ».</p>
          <div>
            <button className="btn btn-primary" onClick={() => app.goTo('pr')}>
              Aller à Pull Request
            </button>
          </div>
        </div>
      </div>
    );

  const remaining = list?.filter((c) => !c.resolved).length ?? 0;
  const blocked = sides && [sides.source, sides.target, sides.base].some((s) => s.isBinary || s.tooLarge || s.lossy);

  return (
    <>
      <div className="page-head">
        <div className="title">
          <strong>
            PR #{pr.id} · {pr.title}
          </strong>
          <span className="mono muted">
            {pr.sourceBranch} → {pr.targetBranch}
          </span>
        </div>
        {list && list.length > 0 && (
          <span className={remaining ? 'chip chip-edit' : 'chip chip-add'}>
            {remaining ? `${remaining} conflit${remaining > 1 ? 's' : ''} sur ${list.length}` : 'Tout est résolu'}
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={load}>
          Recharger
        </button>
        <button className="btn btn-ghost btn-sm" onClick={openInAzure}>
          Tout régler dans Azure <IconExternal />
        </button>
      </div>
      {(error || info) && (
        <div className="pad stack" style={{ paddingBottom: 0, gap: 8 }}>
          <ErrorBanner error={error} onRetry={load} onClose={() => setError(null)} />
          {info && (
            <div className="banner banner-info">
              <span className="banner-body">{info}</span>
              <button className="btn btn-ghost btn-sm" aria-label="Fermer" onClick={() => setInfo(null)}>
                Fermer
              </button>
            </div>
          )}
        </div>
      )}
      <div className="conflicts-split">
        <ul className="conflict-list" aria-label="Conflits">
          {list === null && <li className="pad muted">Chargement…</li>}
          {list && list.length === 0 && <li className="pad muted">Aucun conflit.</li>}
          {list?.map((c) => (
            <li key={c.id} className={current?.id === c.id ? 'conflict-item selected' : 'conflict-item'}>
              <span className="mono">{c.path}</span>
              <span className="small muted">{TYPE_LABEL[c.type] ?? c.type}</span>
              {c.resolved ? <span className="state-done">Résolu</span> : <span className="state-todo">À résoudre</span>}
              <div className="row">
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!c.resolvableInApp || c.resolved}
                  title={c.resolved ? 'Déjà résolu' : c.resolvableInApp ? '' : 'Type non pris en charge dans l’app : utilisez Azure'}
                  onClick={() => openInApp(c)}
                >
                  Régler dans l'app
                </button>
                <button className="btn btn-sm" onClick={openInAzure}>
                  Régler dans Azure
                </button>
              </div>
            </li>
          ))}
        </ul>

        <section className="resolver" aria-label="Résolution">
          {!current && (
            <div className="diff-empty">
              {list && list.length > 0 && remaining === 0 ? (
                <div className="card success" style={{ alignItems: 'center' }}>
                  <h3>Tous les conflits sont résolus.</h3>
                  <button className="btn btn-primary" disabled={busy} onClick={finish}>
                    {busy ? 'Vérification…' : 'Compléter la PR'}
                  </button>
                </div>
              ) : (
                <p>Choisissez un conflit à gauche pour le régler dans l'app, ou réglez-les dans Azure.</p>
              )}
            </div>
          )}
          {current && !sides && <div className="diff-empty">Chargement…</div>}
          {current && sides && blocked && (
            <div className="diff-empty">
              <p>Fichier binaire, trop volumineux ou non UTF-8 (ex. Windows-1252) : réglez ce conflit dans Azure pour ne pas altérer l'encodage.</p>
              <button className="btn" onClick={openInAzure}>
                Régler dans Azure
              </button>
            </div>
          )}
          {current && sides && !blocked && (
            <>
              <Resolver
                path={current.path}
                sides={sides}
                sourceLabel={pr.sourceBranch}
                targetLabel={pr.targetBranch}
                busy={busy}
                submitLabel="Valider la résolution"
                resultHint="sera envoyé à Azure"
                onSubmit={submit}
              />
              <div className="resolver-foot">
                <span className="muted small">
                  <span className="mono">{current.path}</span> · l'encodage et le BOM du fichier sont conservés.
                </span>
                <span className="spacer" />
                <button className="btn" onClick={() => setCurrent(null)}>
                  Annuler
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}
