import { useState } from 'react';
import type { ApiError, CompleteOptions, PrSummary } from '../../../shared/types';
import type { RepoRef } from '../../../shared/api';
import { api, asApiError, call, openUrl } from '../lib/api';
import { ErrorBanner } from '../components/ErrorBanner';

const STRATEGIES: { id: CompleteOptions['mergeStrategy']; label: string }[] = [
  { id: 'noFastForward', label: 'Merge commit' },
  { id: 'squash', label: 'Squash' },
  { id: 'rebase', label: 'Rebase (fast-forward)' },
  { id: 'rebaseMerge', label: 'Semi-linéaire (rebase + merge)' },
];

interface Props {
  repo: RepoRef;
  pr: PrSummary;
  onDone(pr: PrSummary): void;
  onAuth(e: ApiError): boolean;
}

export function CompletePr({ repo, pr, onDone, onAuth }: Props) {
  const [strategy, setStrategy] = useState<CompleteOptions['mergeStrategy']>('noFastForward');
  const [deleteSource, setDeleteSource] = useState(false);
  const [transition, setTransition] = useState(true);
  const [message, setMessage] = useState(`Merged PR ${pr.id}: ${pr.title}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function complete() {
    if (!window.confirm(`Compléter la PR #${pr.id} (${pr.sourceBranch} → ${pr.targetBranch}) ?`)) return;
    setBusy(true);
    setError(null);
    try {
      onDone(
        await call(
          api.completePr(repo, pr.id, {
            mergeStrategy: strategy,
            deleteSourceBranch: deleteSource,
            transitionWorkItems: transition,
            commitMessage: message,
          }),
        ),
      );
    } catch (e) {
      const err = asApiError(e);
      if (!onAuth(err)) setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>Compléter la PR #{pr.id}</h3>
      <label>
        Type de merge
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as CompleteOptions['mergeStrategy'])}>
          {STRATEGIES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Message de commit
        <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} /> Supprimer la branche source (
        {pr.sourceBranch})
      </label>
      <label className="check">
        <input type="checkbox" checked={transition} onChange={(e) => setTransition(e.target.checked)} /> Compléter les work items liés
      </label>
      <ErrorBanner error={error} onClose={() => setError(null)} />
      {error?.code === 'policy' && (
        <button className="btn btn-ghost" onClick={() => openUrl(pr.url).catch((e) => setError(asApiError(e)))}>
          Voir les politiques dans Azure
        </button>
      )}
      <button className="btn btn-primary" disabled={busy} onClick={complete}>
        {busy ? 'Complétion…' : 'Compléter la PR'}
      </button>
    </div>
  );
}
