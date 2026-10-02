import { useEffect, useState } from 'react';
import type { UpdateState } from '../../../shared/types';

interface Updates {
  get(): Promise<{ state: UpdateState; version: string }>;
  check(): Promise<void>;
  install(): Promise<void>;
  onState(cb: (s: UpdateState) => void): () => void;
}

const updates = (window as unknown as { updates?: Updates }).updates;

/** Bandeau de mise à jour : discret tant qu'il n'y a rien à faire. */
export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!updates) return;
    // Un état poussé pendant la lecture initiale est plus récent : il l'emporte.
    let pushed = false;
    const off = updates.onState((s) => {
      pushed = true;
      setState(s);
    });
    void updates
      .get()
      .then((r) => !pushed && setState(r.state))
      .catch(() => {});
    return off;
  }, []);

  const install = () => void updates?.install().catch(() => {});

  if (!updates) return null;
  const version = 'version' in state ? state.version : '';
  if (dismissed && dismissed === version) return null;

  if (state.kind === 'available') {
    return (
      <div className="banner banner-info update" role="status">
        <span>
          La version <b>{state.version}</b> est disponible.
        </span>
        <button className="btn btn-primary" onClick={install}>
          Télécharger
        </button>
        <button className="btn btn-ghost" aria-label="Plus tard" onClick={() => setDismissed(state.version)}>
          Plus tard
        </button>
      </div>
    );
  }
  if (state.kind === 'downloading') {
    return (
      <div className="banner banner-info update" role="status">
        <span>
          Téléchargement de la version <b>{state.version}</b>… {state.percent} %
        </span>
      </div>
    );
  }
  if (state.kind === 'error' && state.message.startsWith('Le téléchargement') && dismissed !== 'error') {
    return (
      <div className="banner banner-info update" role="status">
        <span>{state.message}</span>
        <button className="btn" onClick={() => void updates.check().catch(() => {})}>
          Réessayer
        </button>
        <button className="btn btn-ghost" onClick={() => setDismissed('error')}>
          Ignorer
        </button>
      </div>
    );
  }
  if (state.kind === 'ready') {
    return (
      <div className="banner banner-info update" role="status">
        <span>
          La version <b>{state.version}</b> est prête.
        </span>
        <button className="btn btn-primary" onClick={install}>
          Redémarrer pour installer
        </button>
        <button className="btn btn-ghost" onClick={() => setDismissed(state.version)}>
          Au prochain lancement
        </button>
      </div>
    );
  }
  return null;
}
