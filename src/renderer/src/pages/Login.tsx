import { useState, type FormEvent } from 'react';
import { DEFAULT_ORG, type ApiError } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconLock, IconLogo } from '../lib/icons';

const LAST_ORG_KEY = 'abd.lastOrg';

/** Dernière organisation utilisée (confort local, jamais le PAT). */
function lastOrg(): string {
  try {
    return localStorage.getItem(LAST_ORG_KEY) ?? DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}

export function Login({ onLogged }: { onLogged: (orgUrl: string) => void }) {
  const [orgUrl, setOrgUrl] = useState(lastOrg);
  const [pat, setPat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await call(api.login(orgUrl, pat));
      try {
        localStorage.setItem(LAST_ORG_KEY, s.orgUrl);
      } catch {
        /* stockage indisponible : sans conséquence */
      }
      onLogged(s.orgUrl);
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-brand" aria-hidden="false">
        <div className="brand">
          <div className="brand-mark lg">
            <IconLogo size={24} />
          </div>
          <strong style={{ color: '#ffffff', fontSize: 18 }}>Azure Branch Diff</strong>
        </div>
        <h1>Comparez vos branches. Fusionnez sans cloner.</h1>
        <div className="login-points">
          <div>
            <span>01</span>
            <span>
              <strong>Diff entre branches</strong> ou avec votre dossier local, modifications non commitées comprises.
            </span>
          </div>
          <div>
            <span>02</span>
            <span>
              <strong>Pull Request en un clic</strong>, reprise si elle existe déjà.
            </span>
          </div>
          <div>
            <span>03</span>
            <span>
              <strong>Conflits</strong> réglés dans Azure ou directement dans l'app.
            </span>
          </div>
        </div>
        <span className="login-version">Open source (MIT)</span>
      </section>
      <div className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <div className="stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 24 }}>Connexion</h2>
            <p className="muted">Votre organisation Azure DevOps et un Personal Access Token.</p>
          </div>
          <label>
            Organisation
            <input
              className="field-mono"
              value={orgUrl}
              onChange={(e) => setOrgUrl(e.target.value)}
              placeholder="https://dev.azure.com/mon-organisation"
              required
              autoFocus={!orgUrl}
            />
          </label>
          <label>
            Personal Access Token
            <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} autoFocus={!!orgUrl} required />
          </label>
          <div className="hint-box">
            <IconLock />
            <span>
              Droits requis : <b>Code — Read &amp; Write</b> et <b>Work Items — Read</b>. Le jeton est chiffré par le trousseau du système.
            </span>
          </div>
          <ErrorBanner error={error} />
          <button className="btn btn-primary" type="submit" disabled={busy || !pat || !orgUrl.trim()}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
