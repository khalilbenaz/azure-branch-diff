import { useEffect, useState } from 'react';
import type { ApiError, AzureSource, Source } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp } from '../lib/context';
import { IconSwap } from '../lib/icons';

export interface PickerValue {
  source: Source;
  target: AzureSource;
  repoName: string;
  mode: 'mergeBase' | 'tips';
}

interface Props {
  busy: boolean;
  onCompare(v: PickerValue): void;
  onError(e: ApiError): void;
  /** Bouton « Créer / ouvrir la PR », affiché quand un résultat de branches Azure est prêt. */
  prAction?: () => void;
}

/** Barre d'outils : source (branche ou dossier local) → cible, mode, Comparer. Le dépôt vient de la barre latérale. */
export function SourcePicker({ busy, onCompare, onError, prAction }: Props) {
  const { repo } = useApp();
  const [branches, setBranches] = useState<string[]>([]);
  const [kind, setKind] = useState<'azure' | 'local'>('azure');
  const [sourceBranch, setSourceBranch] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [mode, setMode] = useState<'mergeBase' | 'tips'>('mergeBase');

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      onError(asApiError(e));
    }
  };

  useEffect(() => {
    let stale = false;
    setBranches([]);
    setSourceBranch('');
    setTargetBranch('');
    if (repo)
      void guard(async () => {
        const bs = await call(api.branches(repo.project, repo.repoId));
        if (stale) return;
        setBranches(bs);
        setTargetBranch(bs[0] ?? '');
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.repoId]);

  const sourceReady = kind === 'azure' ? !!sourceBranch && sourceBranch !== targetBranch : !!localPath;
  const ready = !!repo && !!targetBranch && sourceReady;
  const noBranches = !branches.length;

  function submit() {
    if (!repo) return;
    const target: AzureSource = {
      kind: 'azure',
      project: repo.project,
      repoId: repo.repoId,
      branch: targetBranch,
    };
    const source: Source =
      kind === 'azure'
        ? {
            kind: 'azure',
            project: repo.project,
            repoId: repo.repoId,
            branch: sourceBranch,
          }
        : { kind: 'local', path: localPath };
    onCompare({
      source,
      target,
      repoName: repo.repoName,
      mode: kind === 'azure' ? mode : 'tips',
    });
  }

  return (
    <>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Type de source">
          <button aria-pressed={kind === 'azure'} onClick={() => setKind('azure')}>
            Branche
          </button>
          <button aria-pressed={kind === 'local'} onClick={() => setKind('local')}>
            Dossier local
          </button>
        </div>
        {kind === 'azure' ? (
          <label>
            Source
            <select
              className="branch"
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              disabled={noBranches}
              aria-label="Branche source"
            >
              <option value="">— branche —</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="folder">
            <input readOnly value={localPath} placeholder="Aucun dossier choisi" aria-label="Dossier local" title={localPath} />
            <button
              className="btn"
              onClick={() =>
                guard(async () => {
                  const p = await call(api.pickFolder());
                  if (p) setLocalPath(p);
                })
              }
            >
              Choisir…
            </button>
          </div>
        )}
        <button
          className="btn icon-btn"
          aria-label="Inverser source et cible"
          title="Inverser source et cible"
          disabled={kind !== 'azure' || !sourceBranch || !targetBranch}
          onClick={() => {
            setSourceBranch(targetBranch);
            setTargetBranch(sourceBranch);
          }}
        >
          <IconSwap />
        </button>
        <label>
          Cible
          <select
            className="branch"
            value={targetBranch}
            onChange={(e) => setTargetBranch(e.target.value)}
            disabled={noBranches}
            aria-label="Branche cible"
          >
            {noBranches && <option value="">— branche —</option>}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        {kind === 'azure' && (
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'mergeBase' | 'tips')}
            aria-label="Mode de comparaison"
            title="Comme une PR : depuis l'ancêtre commun. Tête contre tête : dernières versions des deux branches."
          >
            <option value="mergeBase">Comme une PR</option>
            <option value="tips">Tête contre tête</option>
          </select>
        )}
        <span className="spacer" />
        <button className={prAction ? 'btn' : 'btn btn-primary'} disabled={!ready || busy} onClick={submit}>
          {busy ? 'Comparaison…' : 'Comparer'}
        </button>
        {prAction && (
          <button className="btn btn-primary" onClick={prAction}>
            Créer / ouvrir la PR
          </button>
        )}
      </div>
      {kind === 'azure' && sourceBranch && sourceBranch === targetBranch && <div className="toolbar-note">Choisissez deux branches différentes.</div>}
    </>
  );
}
