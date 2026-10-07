import { useEffect, useRef, useState } from 'react';
import type { ApiError, FileSide, MergeConflict, MergeResolution, MergeState } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { Resolver } from '../components/Resolver';

const KIND_LABEL: Record<MergeConflict['kind'], string> = {
  text: 'Modifié des deux côtés',
  binary: 'Fichier binaire ou non UTF-8',
  deleted: 'Supprimé d’un côté, modifié de l’autre',
};

type Sides = { base: FileSide; target: FileSide; source: FileSide; merged: FileSide };

/** Nom lisible d'une branche : « origin/main » → « main ». */
const short = (label: string) => label.replace(/^origin\//, '');
const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

type StepState = 'done' | 'current' | 'todo';

/** Étapes de la fusion, dans l'ordre où l'utilisateur les vit. */
function steps(m: MergeState, remaining: number): { label: string; state: StepState }[] {
  const committed = m.phase === 'committed' || m.phase === 'pushed';
  const conflictsLabel = m.conflicts.length ? `Régler les conflits (${m.conflicts.length})` : 'Aucun conflit';
  return [
    { label: 'Fusion préparée', state: 'done' },
    { label: conflictsLabel, state: remaining > 0 && !committed ? 'current' : 'done' },
    { label: 'Enregistrer la fusion', state: committed ? 'done' : remaining > 0 ? 'todo' : 'current' },
    {
      label: m.targetIsRemote ? 'Envoyer sur Azure' : 'Envoyer sur Azure (facultatif)',
      state: m.phase === 'pushed' ? 'done' : m.phase === 'committed' ? 'current' : 'todo',
    },
  ];
}

/** Merge local : conflits, enregistrement (commit), envoi (push). */
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
    setMessage(`Merge ${short(m.sourceLabel)} into ${short(m.targetLabel)}`);
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

  // Le premier conflit à régler s'ouvre tout seul ; après chaque fichier réglé, le suivant.
  const nextOpen = m?.conflicts.find((c) => !c.resolved) ?? null;
  useEffect(() => {
    if (!active || !m || current || !nextOpen) return;
    void open(nextOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, m, current, nextOpen?.path]);

  const resolve = (path: string, r: MergeResolution) =>
    run(async () => {
      app.setMerge(await call(api.mergeResolve(path, r)));
      currentRef.current = null;
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
      // Cible Azure : l'envoi est la finalité de cette direction.
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
          `La fusion n'a pas été envoyée sur Azure (${short(m.targetLabel)}). Elle reste enregistrée dans le clone (refs/abd/merges/). Terminer quand même ?`,
        );
        if (!ok) return;
      }
      await call(api.mergeClose());
      app.setMerge(null);
      await app.refreshClone();
    });

  const abort = () =>
    run(async () => {
      if (!window.confirm(`Abandonner la fusion ? ${m ? short(m.targetLabel) : 'La cible'} reste inchangée.`)) return;
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
        <div className="empty-inner" style={{ maxWidth: 620 }}>
          <h2>Aucune fusion en cours</h2>
          <p className="muted">
            Pour fusionner une branche dans une autre : dans « Comparer », choisissez la <strong>cible</strong> (à gauche, la branche qui reçoit) et
            la <strong>source</strong> (à droite, la branche à intégrer), puis cliquez sur « Fusionner ».
          </p>
          <p className="muted">
            La fusion est préparée à part, dans votre clone : votre dossier de travail n'est pas modifié, et rien n'est envoyé sur Azure sans votre
            accord.
          </p>
          <div>
            <button className="btn btn-primary" onClick={() => app.goTo('compare')}>
              Aller à Comparer
            </button>
          </div>
        </div>
      </div>
    );

  const tName = short(m.targetLabel);
  const sName = short(m.sourceLabel);
  const remaining = m.conflicts.filter((c) => !c.resolved).length;
  const cur = m.conflicts.find((c) => c.path === current) ?? null;
  const open_ = m.phase === 'conflicts' || m.phase === 'ready';
  const where =
    m.location === 'worktree'
      ? `Préparée à part dans le clone « ${folder(m.root)} » : votre dossier de travail n'est pas modifié.`
      : `Dans votre dossier de travail « ${folder(m.root)} ».`;

  return (
    <>
      <div className="page-head merge-head">
        <div className="title">
          <strong>
            Fusionner <span className="branch">{sName}</span> dans <span className="branch">{tName}</span>
          </strong>
          <span className="muted small" title="Worktree git temporaire ; les hooks git ne sont pas exécutés.">
            {where}
          </span>
        </div>
        <ol className="stepper" aria-label="Étapes de la fusion">
          {steps(m, remaining).map((s, i) => (
            <li key={s.label} className={`step-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="step-n">{s.state === 'done' ? '✓' : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>
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
                Azure refuse l'envoi direct sur {tName} (politique de branche). La fusion part sur une branche dédiée et une PR vers {tName} est
                créée.
              </span>
            </div>
          )}
        </div>
      )}

      {m.phase === 'upToDate' && (
        <div className="content">
          <div className="card success">
            <h3>
              Rien à fusionner : {tName} contient déjà tout ce qu'apporte {sName}.
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
          <div className="card success merge-done">
            <h3>
              ✓ {sName} est fusionné dans {tName}.
            </h3>
            {m.phase === 'pushed' ? (
              <p>
                La fusion est <strong>envoyée sur Azure</strong> : {tName} est à jour sur le serveur.
              </p>
            ) : (
              <p>
                La fusion est <strong>enregistrée dans votre clone</strong>, mais <strong>pas encore sur Azure</strong>.
                {m.targetIsRemote ? '' : ' Envoyez-la si vous voulez que les autres la voient.'}
              </p>
            )}
            <p className="mono small muted">commit {m.commit?.slice(0, 10)}</p>
            <div className="row">
              {m.phase === 'committed' && (
                <button className="btn btn-primary" disabled={busy} onClick={push} title={`git push origin ${tName}`}>
                  {busy ? 'Envoi…' : `Envoyer ${tName} sur Azure`}
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
          <div className="conflict-col">
            <div className="conflict-col-head">
              {m.conflicts.length === 0
                ? 'Aucun conflit'
                : remaining
                  ? `${remaining} fichier${remaining > 1 ? 's' : ''} à régler sur ${m.conflicts.length}`
                  : 'Tous les fichiers sont réglés'}
            </div>
            <ul className="conflict-list" aria-label="Conflits du merge">
              {m.conflicts.length === 0 && <li className="pad muted">Git a tout fusionné sans conflit. Il reste à enregistrer la fusion.</li>}
              {m.conflicts.map((c) => (
                <li key={c.path} className={current === c.path ? 'conflict-item selected' : 'conflict-item'}>
                  <button className="link-row" onClick={() => open(c)} disabled={c.resolved}>
                    <span className="mono">{c.path}</span>
                    <span className="small muted">{KIND_LABEL[c.kind]}</span>
                    {c.resolved ? <span className="state-done">✓ Réglé</span> : <span className="state-todo">À régler</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <section className="resolver" aria-label="Résolution">
            {!cur && (
              <div className="diff-empty">
                {remaining ? 'Choisissez un fichier à gauche.' : `Tout est prêt : enregistrez la fusion de ${sName} dans ${tName}.`}
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
                submitLabel="Valider ce fichier"
                resultHint="enregistré avec la fusion"
                onSubmit={(r) => resolve(cur.path, r)}
              />
            )}
            {cur && cur.kind !== 'text' && (
              <div className="diff-empty">
                <p>
                  <span className="mono">{cur.path}</span> : {KIND_LABEL[cur.kind].toLowerCase()}. Quelle version garder ?
                </p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'target' })}>
                    Garder la version de {tName}
                  </button>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'source' })}>
                    Garder la version de {sName}
                  </button>
                  <button className="btn" disabled={busy} onClick={() => resolve(cur.path, { kind: 'delete' })}>
                    Supprimer le fichier
                  </button>
                </div>
              </div>
            )}
            <div className="commit-panel">
              <label>
                Message de la fusion
                <input className="field-mono" value={message} onChange={(e) => setMessage(e.target.value)} />
              </label>
              <button className="btn" disabled={busy} onClick={abort}>
                Abandonner
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || remaining > 0}
                onClick={commit}
                title={remaining ? 'Réglez d’abord tous les conflits' : `Crée le commit de fusion sur ${tName}`}
              >
                {busy ? 'Enregistrement…' : m.targetIsRemote ? 'Enregistrer et envoyer sur Azure' : 'Enregistrer la fusion'}
              </button>
            </div>
            {remaining > 0 && (
              <p className="small muted commit-hint">
                Encore {remaining} fichier{remaining > 1 ? 's' : ''} à régler avant d'enregistrer.
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
