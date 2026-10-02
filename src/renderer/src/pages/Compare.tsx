import { useEffect, useRef, useState } from 'react';
import type { CompareResult } from '../../../shared/api';
import type { ApiError, ChangeEntry, FileSide } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { countLines } from '../lib/eol';
import { azureFileBranch } from '../lib/prLogic';
import { useApp } from '../lib/context';
import { ErrorBanner } from '../components/ErrorBanner';
import { SourcePicker, type PickerValue } from '../components/SourcePicker';
import { FileTree, type LineCounts } from '../components/FileTree';
import { DiffView } from '../components/DiffView';

export function Compare() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [picked, setPicked] = useState<PickerValue | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [counts, setCounts] = useState<LineCounts>({});
  const [entry, setEntry] = useState<ChangeEntry | null>(null);
  const [sides, setSides] = useState<{
    left: FileSide;
    right: FileSide;
  } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const lastRun = useRef<() => void>(() => {});
  const fileReq = useRef(0);
  const compareCount = useRef(0);

  const report = (e: unknown) => {
    const err = asApiError(e);
    if (!app.handleAuth(err)) setError(err);
  };

  async function runCompare(v: PickerValue) {
    lastRun.current = () => void runCompare(v);
    fileReq.current++; // ignore un diff de fichier encore en cours sur l'ancien résultat
    setLoadingFile(false);
    setBusy(true);
    setError(null);
    setEntry(null);
    setSides(null);
    setCounts({});
    // La sélection de l'onglet PR suit la comparaison lancée, même si celle-ci échoue.
    // La PR en cours est gardée : l'onglet PR l'écarte si les branches ont changé.
    app.setSelection(null);
    if (v.source.kind === 'local') app.setPr(null);
    try {
      const r = await call(api.compare(v.source, v.target, v.mode));
      setPicked(v);
      setResult(r);
      if (v.source.kind === 'azure') {
        app.setSelection({
          repo: {
            project: v.target.project,
            repoId: v.target.repoId,
            repoName: v.repoName,
          },
          source: v.source.branch,
          target: v.target.branch,
          nonce: ++compareCount.current,
        });
      }
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
        setCounts((c) => ({
          ...c,
          [e.path]: countLines(s.left.content, s.right.content),
        }));
      }
    } catch (err) {
      if (req === fileReq.current) report(err);
    } finally {
      if (req === fileReq.current) setLoadingFile(false);
    }
  }

  async function openInAzure() {
    if (!picked || !entry) return;
    const branch = azureFileBranch(entry, picked.source, picked.target);
    if (!branch) return;
    try {
      const url = await call(
        api.fileUrl(
          {
            project: picked.target.project,
            repoId: picked.target.repoId,
            repoName: picked.repoName,
          },
          entry.path,
          branch,
        ),
      );
      await call(api.openExternal(url));
    } catch (e) {
      report(e);
    }
  }

  // Un autre dépôt choisi dans la barre latérale : l'ancien résultat n'a plus de sens.
  useEffect(() => {
    fileReq.current++;
    setPicked(null);
    setResult(null);
    setEntry(null);
    setSides(null);
    setCounts({});
  }, [app.repo?.repoId]);

  const isLocal = picked?.source.kind === 'local';
  const leftLabel = picked
    ? isLocal
      ? picked.target.branch
      : picked.mode === 'mergeBase'
        ? `${picked.target.branch} · ancêtre commun`
        : picked.target.branch
    : '';
  const rightLabel = picked ? (picked.source.kind === 'local' ? 'dossier local' : picked.source.branch) : '';
  const prAction = result && picked && !isLocal && result.changes.length ? () => app.goTo('pr') : undefined;
  const step = !app.repo ? 1 : 2;

  return (
    <div className="page">
      <SourcePicker busy={busy} onCompare={runCompare} onError={report} prAction={prAction} />
      {error && (
        <div className="pad" style={{ paddingBottom: 0 }}>
          <ErrorBanner error={error} onRetry={() => lastRun.current()} onClose={() => setError(null)} />
        </div>
      )}
      {result && picked && isLocal && (
        <div className="toolbar-note">
          {result.local
            ? `Dépôt local : ${result.local.branch} · ${result.local.commit.slice(0, 8)} · ${result.local.subject}`
            : 'Dossier hors git : comparaison fichier par fichier.'}{' '}
          · Lecture seule (pas de PR depuis un dossier local).
        </div>
      )}
      {result && picked ? (
        <div className="split">
          <FileTree changes={result.changes} counts={counts} selected={entry?.path ?? null} onSelect={openFile} />
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
                Choisissez un dépôt dans la barre latérale, puis deux branches, ou une branche et un dossier de votre disque.
              </p>
            </div>
            <div className="steps">
              <div className={step === 1 ? 'step current' : 'step done'}>
                <span className="n">ÉTAPE 1{step > 1 ? ' · fait' : ''}</span>
                <h3>Choisir le dépôt</h3>
                <span className="muted">Projet et dépôt, dans la barre latérale.</span>
              </div>
              <div className={step === 2 ? 'step current' : 'step'}>
                <span className="n">ÉTAPE 2</span>
                <h3>Source et cible</h3>
                <span className="muted">Deux branches, ou un dossier local face à une branche.</span>
              </div>
              <div className="step">
                <span className="n">ÉTAPE 3</span>
                <h3>Comparer, puis la PR</h3>
                <span className="muted">Diff fichier par fichier, puis PR et conflits dans la foulée.</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
