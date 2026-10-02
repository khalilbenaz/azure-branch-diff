import type { ApiError } from '../../../shared/types';

interface Props {
  error: ApiError | null;
  onRetry?: () => void;
  onClose?: () => void;
}

export function ErrorBanner({ error, onRetry, onClose }: Props) {
  if (!error) return null;
  return (
    <div className="banner banner-error" role="alert">
      <div className="banner-body">
        <strong>{error.message}</strong>
        {error.details && (
          <details>
            <summary>Détails</summary>
            <pre>{error.details}</pre>
          </details>
        )}
      </div>
      {error.code === 'network' && onRetry && (
        <button className="btn" onClick={onRetry}>
          Réessayer
        </button>
      )}
      {onClose && (
        <button className="btn btn-ghost" aria-label="Fermer" onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}
