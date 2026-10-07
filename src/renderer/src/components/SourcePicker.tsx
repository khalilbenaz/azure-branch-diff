import { useEffect, useState } from 'react';
import { REFRESH_EVENT } from './Sidebar';
import type { ApiError, Side } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { useApp } from '../lib/context';
import { IconMerge, IconSwap } from '../lib/icons';
import { parseRefKey, refKey, sameSide, toSide, type SideDraft } from '../lib/sides';

export interface PickerValue {
  source: Side;
  target: Side;
  repoName: string;
  mode: 'mergeBase' | 'tips';
}

interface Props {
  busy: boolean;
  onCompare(v: PickerValue): void;
  onError(e: ApiError): void;
  onPr(v: PickerValue): void;
  onMerge(v: PickerValue): void;
}

interface SideCardProps {
  role: 'source' | 'cible';
  draft: SideDraft;
  onDraft(d: SideDraft): void;
  branches: string[];
}

/** Une carte « Source » ou « Cible » : Azure (branche du dépôt) ou Local (référence du clone). */
function SideCard({ role, draft, onDraft, branches }: SideCardProps) {
  const app = useApp();
  const clone = app.clone;
  const title = role === 'source' ? 'Source' : 'Cible';
  return (
    <div className="side-card">
      <div className="side-card-head">
        <span className="eyebrow">{title}</span>
        <span className="spacer" />
        <div className="segmented xs" role="group" aria-label={`Type de ${role}`}>
          <button aria-pressed={draft.kind === 'azure'} onClick={() => draft.kind !== 'azure' && onDraft({ kind: 'azure', branch: '' })}>
            Azure
          </button>
          <button aria-pressed={draft.kind === 'local'} onClick={() => draft.kind !== 'local' && onDraft({ kind: 'local', ref: null })}>
            Local
          </button>
        </div>
      </div>
      {draft.kind === 'azure' ? (
        <select
          className="branch"
          value={draft.branch}
          onChange={(e) => onDraft({ kind: 'azure', branch: e.target.value })}
          disabled={!branches.length}
          aria-label={`Branche ${role}`}
        >
          <option value="">{app.repo ? '— branche —' : 'Choisissez un dépôt Azure'}</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : !clone ? (
        <button className="btn" onClick={() => void app.pickClone()}>
          Choisir un clone…
        </button>
      ) : (
        <select
          className="branch"
          value={refKey(draft.ref)}
          onChange={(e) => onDraft({ kind: 'local', ref: parseRefKey(e.target.value) })}
          aria-label={`Référence ${role}`}
        >
          <option value="">— référence —</option>
          <option value="worktree">
            {!clone.git
              ? 'contenu du dossier (sans git)'
              : role === 'source'
                ? `copie de travail${clone.current ? ` (${clone.current}${clone.dirty ? ', modifiée' : ''})` : ''}`
                : `branche extraite${clone.current ? ` (${clone.current}, HEAD)` : ''}`}
          </option>
          {clone.branches.length > 0 && (
            <optgroup label="Branches locales">
              {clone.branches.map((b) => (
                <option key={b} value={`branch:${b}`}>
                  {b}
                </option>
              ))}
            </optgroup>
          )}
          {clone.remoteBranches.length > 0 && (
            <optgroup label="origin">
              {clone.remoteBranches.map((b) => (
                <option key={b} value={`remote:${b}`}>
                  origin/{b}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
    </div>
  );
}

/** Barre d'outils : Cible ← Source (Azure ou local), mode, Comparer, PR, Fusionner. */
export function SourcePicker({ busy, onCompare, onError, onPr, onMerge }: Props) {
  const app = useApp();
  const { repo, clone } = app;
  const [branches, setBranches] = useState<string[]>([]);
  const [source, setSource] = useState<SideDraft>({ kind: 'azure', branch: '' });
  const [target, setTarget] = useState<SideDraft>({ kind: 'azure', branch: '' });
  const [mode, setMode] = useState<'mergeBase' | 'tips'>('mergeBase');

  useEffect(() => {
    let stale = false;
    setBranches([]);
    setSource((d) => (d.kind === 'azure' ? { kind: 'azure', branch: '' } : d));
    setTarget((d) => (d.kind === 'azure' ? { kind: 'azure', branch: '' } : d));
    if (repo)
      void (async () => {
        try {
          const bs = await call(api.branches(repo.project, repo.repoId));
          if (stale) return;
          setBranches(bs);
          setTarget((d) => (d.kind === 'azure' && !d.branch ? { kind: 'azure', branch: bs[0] ?? '' } : d));
        } catch (e) {
          onError(asApiError(e));
        }
      })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.repoId]);

  // « Actualiser » (barre latérale) : relit les branches Azure en gardant les choix encore valides.
  useEffect(() => {
    if (!repo) return;
    let stale = false;
    const onRefresh = () => {
      void (async () => {
        try {
          const bs = await call(api.branches(repo.project, repo.repoId));
          if (stale) return;
          setBranches(bs);
          const keep = (d: SideDraft): SideDraft => (d.kind === 'azure' && d.branch && !bs.includes(d.branch) ? { kind: 'azure', branch: '' } : d);
          setSource(keep);
          setTarget(keep);
        } catch (e) {
          onError(asApiError(e));
        }
      })();
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => {
      stale = true;
      window.removeEventListener(REFRESH_EVENT, onRefresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo?.repoId]);

  // Un autre clone : les références locales choisies n'ont plus de sens.
  useEffect(() => {
    setSource((d) => (d.kind === 'local' ? { kind: 'local', ref: null } : d));
    setTarget((d) => (d.kind === 'local' ? { kind: 'local', ref: null } : d));
  }, [clone?.root]);

  const src = toSide(source, repo, clone);
  const tgt = toSide(target, repo, clone);
  const mixed = !!src && !!tgt && src.kind !== tgt.kind;
  const identical = !!src && !!tgt && sameSide(src, tgt);
  const ready = !!src && !!tgt && !identical;
  const value = (): PickerValue => ({ source: src!, target: tgt!, repoName: repo?.repoName ?? '', mode: mixed ? 'tips' : mode });
  const canPr = ready && tgt!.kind === 'azure' && (src!.kind === 'azure' || src!.ref.type === 'branch');

  return (
    <>
      <div className="toolbar sides">
        {/* Ordre « cible ← source » : le même que le diff (gauche = cible, droite = source). */}
        <SideCard role="cible" draft={target} onDraft={setTarget} branches={branches} />
        <button
          className="btn icon-btn swap"
          aria-label="Inverser source et cible"
          title="Inverser source et cible"
          onClick={() => {
            setSource(target);
            setTarget(source);
          }}
        >
          <IconSwap />
        </button>
        <SideCard role="source" draft={source} onDraft={setSource} branches={branches} />
        <div className="side-card actions-card">
          <div className="side-card-head">
            <span className="eyebrow">Mode</span>
            <span className="spacer" />
            <div
              className="segmented xs"
              role="group"
              aria-label="Mode de comparaison"
              title={
                mixed
                  ? 'Azure ↔ local : dernières versions uniquement'
                  : "Comme une PR : seulement ce que la source apporte. Tête contre tête : toutes les différences. Les deux volets montrent toujours l'état actuel."
              }
            >
              <button aria-pressed={!mixed && mode === 'mergeBase'} disabled={mixed} onClick={() => setMode('mergeBase')}>
                Comme une PR
              </button>
              <button aria-pressed={mixed || mode === 'tips'} disabled={mixed} onClick={() => setMode('tips')}>
                Tête contre tête
              </button>
            </div>
          </div>
          <div className="actions-row">
            <button className="btn" disabled={!ready || busy} onClick={() => onCompare(value())}>
              {busy ? 'Comparaison…' : 'Comparer'}
            </button>
            <button className="btn" disabled={!canPr} onClick={() => onPr(value())} title="Pull Request Azure (cible Azure)">
              Créer / ouvrir la PR
            </button>
            <button className="btn btn-primary" disabled={!ready} onClick={() => onMerge(value())} title="Merge dans le clone local">
              <IconMerge size={16} /> Fusionner
            </button>
          </div>
        </div>
      </div>
      {identical && <div className="toolbar-note">Choisissez deux branches différentes.</div>}
      {mixed && (
        <div className="toolbar-note">
          Azure ↔ local : comparaison des dernières versions. Pour comparer « comme une PR », prenez la branche <span className="mono">origin/…</span>{' '}
          du clone.
        </div>
      )}
    </>
  );
}
