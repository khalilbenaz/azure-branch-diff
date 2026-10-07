import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompareResult } from '../../../shared/api';
import type { ApiError, ChangeEntry, FileSide, Side } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { countLines } from '../lib/eol';
import { azureFileBranch } from '../lib/prLogic';
import { mergeInput, sideLabel } from '../lib/sides';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { SourcePicker, type PickerValue } from '../components/SourcePicker';
import { FileTree, type LineCounts } from '../components/FileTree';
import { DiffView } from '../components/DiffView';

/** Fichiers par appel pendant l'analyse des espaces (la liste se met à jour entre deux appels). */
const WS_CHUNK = 40;
const EMPTY_SET = new Set<string>();

const badge = (s: Side) => (s.kind === 'azure' ? 'Azure' : 'Local');

export function Compare() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [picked, setPicked] = useState<PickerValue | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [counts, setCounts] = useState<LineCounts>({});
  const [entry, setEntry] = useState<ChangeEntry | null>(null);
  const [sides, setSides] = useState<{ left: FileSide; right: FileSide } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  // Analyse en arrière-plan des fichiers qui ne diffèrent que par des espaces.
  const [ws, setWs] = useState<{ of: CompareResult | null; paths: Set<string>; done: number; total: number; failed: boolean }>({
    of: null,
    paths: new Set(),
    done: 0,
    total: 0,
    failed: false,
  });
  const lastRun = useRef<() => void>(() => {});
  const fileReq = useRef(0);
  const compareCount = useRef(0);

  const report = (e: unknown) => {
    const err = asApiError(e);
    if (!app.handleAuth(err)) setError(err);
  };

  /** Sélection de l'onglet PR (branches Azure source → cible). */
  function selectForPr(v: PickerValue, sourceBranch: string) {
    if (v.target.kind !== 'azure' || !app.repo) return;
    app.setSelection({ repo: app.repo, source: sourceBranch, target: v.target.branch, nonce: ++compareCount.current });
  }

  async function runCompare(v: PickerValue) {
    lastRun.current = () => void runCompare(v);
    fileReq.current++; // ignore un diff de fichier encore en cours sur l'ancien résultat
    setLoadingFile(false);
    setBusy(true);
    setError(null);
    setEntry(null);
    setSides(null);
    setCounts({});
    // La sélection de l'onglet PR suit la comparaison lancée ; une comparaison avec un côté local n'a pas de PR.
    app.setSelection(null);
    if (v.source.kind === 'local' || v.target.kind === 'local') app.setPr(null);
    try {
      const r = await call(api.compare(v.source, v.target, v.mode));
      setPicked(v);
      setResult(r);
      if (v.source.kind === 'azure' && v.target.kind === 'azure') selectForPr(v, v.source.branch);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  async function openPr(v: PickerValue) {
    if (v.target.kind !== 'azure') return;
    try {
      if (v.source.kind === 'local') {
        if (v.source.ref.type !== 'branch' || !app.clone) return;
        const branch = v.source.ref.name;
        if (!app.repo) return;
        // Confirmation native (processus principal) avant le push.
        await call(api.pushBranch(app.clone.root, branch, app.repo));
        await app.refreshClone();
        selectForPr(v, branch);
      } else selectForPr(v, v.source.branch);
      app.goTo('pr');
    } catch (e) {
      report(e);
    }
  }

  async function startMerge(v: PickerValue) {
    let clone = app.clone;
    if (!clone) clone = await app.pickClone();
    if (!clone) return;
    const m = mergeInput(v.source, v.target, clone);
    if ('reason' in m) {
      setError({ code: 'unknown', message: m.reason });
      return;
    }
    try {
      if ((v.source.kind === 'azure' || v.target.kind === 'azure') && app.repo) {
        const check = await call(api.originCheck(clone.root, app.repo));
        if (
          !check.matches &&
          !window.confirm(`L’origin du clone (${check.originUrl ?? 'aucun'}) ne semble pas être le dépôt Azure « ${app.repo.repoName} ». Continuer ?`)
        )
          return;
      }
      const label = `${sideLabel(v.source, clone)} → ${sideLabel(v.target, clone, 'cible')}`;
      const then = m.input.target.kind === 'remote' ? `, puis pousser le résultat vers origin/${m.input.target.branch}` : '';
      if (!window.confirm(`Fusionner ${label} dans un worktree temporaire du clone${then} ?`)) return;
      setBusy(true);
      app.setMerge(await call(api.mergeStart(m.input)));
      app.goTo('merge');
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(e: ChangeEntry) {
    if (!picked || !result) return;
    const req = ++fileReq.current;
    setEntry(e);
    setSides(null);
    setLoadingFile(true);
    try {
      const s = await call(api.fileSides(picked.source, picked.target, e, result));
      if (req !== fileReq.current) return;
      setSides(s);
      if (!s.left.isBinary && !s.right.isBinary && !s.left.tooLarge && !s.right.tooLarge) {
        setCounts((c) => ({ ...c, [e.path]: countLines(s.left.content, s.right.content) }));
      }
    } catch (err) {
      if (req === fileReq.current) report(err);
    } finally {
      if (req === fileReq.current) setLoadingFile(false);
    }
  }

  async function openInAzure() {
    if (!picked || !entry || !app.repo) return;
    const branch = azureFileBranch(entry, picked.source, picked.target);
    if (!branch) return;
    try {
      const url = await call(api.fileUrl(app.repo, entry.path, branch));
      await call(api.openExternal(url));
    } catch (e) {
      report(e);
    }
  }

  useEffect(() => {
    if (!result || !picked) return;
    let stopped = false;
    const todo = result.changes.filter((c) => !c.inTarget && !c.isBinary);
    setWs({ of: result, paths: new Set(), done: 0, total: todo.length, failed: false });
    void (async () => {
      const found = new Set<string>();
      for (let i = 0; i < todo.length && !stopped; i += WS_CHUNK) {
        try {
          for (const p of await call(api.whitespaceOnly(picked.source, picked.target, todo.slice(i, i + WS_CHUNK), result))) found.add(p);
        } catch {
          if (!stopped) setWs((w) => (w.of === result ? { ...w, failed: true } : w));
          return;
        }
        if (stopped) return;
        const done = Math.min(i + WS_CHUNK, todo.length);
        setWs((w) => (w.of === result ? { ...w, paths: new Set(found), done } : w));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [result, picked]);

  // Un autre dépôt Azure ou un autre clone : l'ancien résultat n'a plus de sens.
  useEffect(() => {
    fileReq.current++;
    setPicked(null);
    setResult(null);
    setEntry(null);
    setSides(null);
    setCounts({});
  }, [app.repo?.repoId, app.clone?.root]);

  // Les deux volets montrent toujours l'état actuel des branches ; en mode PR, seule la liste change (ce que la source apporte).
  const label = (s: Side, base?: boolean) => `${badge(s)} · ${sideLabel(s, app.clone, base ? 'cible' : 'source')}`;
  const inTargetCount = useMemo(() => result?.changes.filter((c) => c.inTarget).length ?? 0, [result]);
  const wsPaths = ws.of === result ? ws.paths : EMPTY_SET;
  const scanning = ws.of === result && !ws.failed && ws.done < ws.total;
  // Masqués par défaut : déjà identiques sur la cible (mode PR) et différences d'espaces seulement.
  const visibleChanges = useMemo(() => {
    if (!result) return [];
    const marked = wsPaths.size ? result.changes.map((c) => (wsPaths.has(c.path) ? { ...c, whitespaceOnly: true } : c)) : result.changes;
    return showHidden ? marked : marked.filter((c) => !c.inTarget && !c.whitespaceOnly);
  }, [result, wsPaths, showHidden]);
  const hiddenCount = inTargetCount + wsPaths.size;
  const targetName = picked ? (picked.target.kind === 'azure' ? picked.target.branch : sideLabel(picked.target, app.clone, 'cible')) : '';
  const leftLabel = picked ? label(picked.target, true) : '';
  const rightLabel = picked ? label(picked.source) : '';
  const step = !app.repo && !app.clone ? 1 : 2;

  return (
    <div className="page">
      <SourcePicker busy={busy} onCompare={runCompare} onError={report} onPr={openPr} onMerge={startMerge} />
      {error && (
        <div className="pad" style={{ paddingBottom: 0 }}>
          <ErrorBanner error={error} onRetry={() => lastRun.current()} onClose={() => setError(null)} />
        </div>
      )}
      {result && picked && (hiddenCount > 0 || scanning) && (
        <div className="ancestor-note" role="note">
          <span>
            {inTargetCount > 0 && (
              <>
                <strong>
                  {inTargetCount} fichier{inTargetCount > 1 ? 's' : ''} déjà identique{inTargetCount > 1 ? 's' : ''} sur {targetName}
                </strong>{' '}
                (portés sans merge, cherry-pick ou squash)
              </>
            )}
            {inTargetCount > 0 && wsPaths.size > 0 && ' · '}
            {wsPaths.size > 0 && (
              <strong>
                {wsPaths.size} fichier{wsPaths.size > 1 ? 's' : ''} qui ne diff{wsPaths.size > 1 ? 'èrent' : 'ère'} que par des espaces
              </strong>
            )}
            {hiddenCount > 0 && (showHidden ? ' : affichés.' : ' : masqués, rien à apporter.')}
            {scanning && (
              <span className="muted">
                {' '}
                Recherche des différences d’espaces… {ws.done} / {ws.total}
              </span>
            )}
          </span>
          {hiddenCount > 0 && (
            <button type="button" className="btn" onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? 'Masquer' : 'Afficher'}
            </button>
          )}
        </div>
      )}
      {result && picked ? (
        <div className="split">
          <FileTree changes={visibleChanges} resetKey={result} counts={counts} selected={entry?.path ?? null} onSelect={openFile} />
          <DiffView
            entry={entry}
            sides={sides}
            loading={loadingFile}
            leftLabel={leftLabel}
            rightLabel={rightLabel}
            sideBySide={sideBySide}
            onToggleLayout={() => setSideBySide((v) => !v)}
            onOpenInAzure={openInAzure}
            canOpenInAzure={!!entry && azureFileBranch(entry, picked.source, picked.target) !== null}
          />
        </div>
      ) : (
        <div className="empty">
          <div className="empty-inner">
            <div className="stack" style={{ gap: 8 }}>
              <h1>{busy ? 'Comparaison en cours…' : 'Que voulez-vous comparer ?'}</h1>
              <p className="muted" style={{ fontSize: 15 }}>
                Chaque côté est une branche Azure ou une référence de votre clone local : comparez, créez la PR ou fusionnez dans toutes les
                directions.
              </p>
            </div>
            <div className="steps">
              <div className={step === 1 ? 'step current' : 'step done'}>
                <span className="n">ÉTAPE 1{step > 1 ? ' · fait' : ''}</span>
                <h3>Dépôt Azure et / ou clone</h3>
                <span className="muted">Dans la barre latérale : le dépôt Azure, le clone local, ou les deux.</span>
              </div>
              <div className={step === 2 ? 'step current' : 'step'}>
                <span className="n">ÉTAPE 2</span>
                <h3>Source et cible</h3>
                <span className="muted">Pour chaque côté : Azure ou Local, puis la branche.</span>
              </div>
              <div className="step">
                <span className="n">ÉTAPE 3</span>
                <h3>Comparer, PR ou Fusionner</h3>
                <span className="muted">Diff fichier par fichier, PR Azure, ou merge local avec conflits.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
