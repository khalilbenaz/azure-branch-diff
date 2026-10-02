import { useEffect, useState, type FormEvent } from 'react';
import type { ApiError, OrgsState } from '../../../shared/types';
import { DEFAULT_ORG } from '../../../shared/types';
import { api, asApiError, call } from '../lib/api';
import { ErrorBanner } from '../components/ErrorBanner';
import { IconLock, IconLogo } from '../lib/icons';

const LAST_ORG_KEY = 'abd.lastOrg';

/** Dernière organisation saisie (confort local, jamais le PAT). */
function lastOrg(): string {
  try {
    return localStorage.getItem(LAST_ORG_KEY) ?? DEFAULT_ORG;
  } catch {
    return DEFAULT_ORG;
  }
}
const remember = (url: string) => {
  try {
    localStorage.setItem(LAST_ORG_KEY, url);
  } catch {
    /* stockage indisponible : sans conséquence */
  }
};
const orgName = (url: string) => url.replace(/^https:\/\//, '').replace(/^dev\.azure\.com\//, '');

export function Login({ onLogged }: { onLogged: (orgUrl: string) => void }) {
  const [state, setState] = useState<OrgsState | null>(null);
  const [adding, setAdding] = useState(false);
  const [orgUrl, setOrgUrl] = useState(lastOrg);
  const [tokenMode, setTokenMode] = useState<'new' | 'saved'>('new');
  const [pat, setPat] = useState('');
  const [label, setLabel] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [found, setFound] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void call(api.orgs()).then(
      (st) => {
        setState(st);
        setAdding(st.orgs.length === 0);
        if (st.tokens[0]) setTokenId(st.tokens[0].id);
      },
      () => setAdding(true),
    );
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(asApiError(e));
    } finally {
      setBusy(false);
    }
  };
  const token = () => (tokenMode === 'saved' ? { tokenId } : { pat, label });

  const connect = (url: string) =>
    run(async () => {
      const s = await call(api.connectOrg(url));
      remember(s.orgUrl);
      onLogged(s.orgUrl);
    });

  const remove = (url: string) =>
    run(async () => {
      if (!window.confirm(`Retirer ${orgName(url)} ? Son jeton est oublié s'il ne sert à aucune autre organisation.`)) return;
      const st = await call(api.removeOrg(url));
      setState(st);
      if (!st.orgs.length) setAdding(true);
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const st = await call(api.addOrgs({ orgUrls: [orgUrl], ...token() }));
      remember(st.active ?? orgUrl);
      onLogged(st.active ?? orgUrl);
    });
  };

  const discover = () =>
    run(async () => {
      const list = await call(api.discoverOrgs(token()));
      const known = new Set(state?.orgs.map((o) => o.orgUrl));
      setFound(list);
      setPicked(new Set(list.filter((u) => !known.has(u))));
    });

  const addPicked = () =>
    run(async () => {
      const urls = [...picked];
      const st = await call(api.addOrgs({ orgUrls: urls, ...token() }));
      remember(st.active ?? urls[0]);
      onLogged(st.active ?? urls[0]);
    });

  const hasTokenInput = tokenMode === 'saved' ? !!tokenId : !!pat.trim();
  const saved = state?.orgs ?? [];

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
        <div className="login-form">
          <div className="stack" style={{ gap: 6 }}>
            <h2 style={{ fontSize: 24 }}>Connexion</h2>
            <p className="muted">
              {saved.length ? 'Choisissez une organisation, ou ajoutez-en une.' : 'Votre organisation Azure DevOps et un Personal Access Token.'}
            </p>
          </div>
          <ErrorBanner error={error} onClose={() => setError(null)} />

          {saved.length > 0 && (
            <ul className="org-list" aria-label="Organisations enregistrées">
              {saved.map((o) => (
                <li key={o.orgUrl} className={o.orgUrl === state?.active ? 'org-item active' : 'org-item'}>
                  <div className="org-text">
                    <strong>{orgName(o.orgUrl)}</strong>
                    <span className="small muted">Jeton : {o.tokenLabel}</span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => connect(o.orgUrl)}
                    aria-label={`Se connecter à ${orgName(o.orgUrl)}`}
                  >
                    Ouvrir
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => remove(o.orgUrl)}
                    aria-label={`Retirer ${orgName(o.orgUrl)}`}
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}

          {saved.length > 0 && !adding && (
            <button className="btn" onClick={() => setAdding(true)}>
              Ajouter une organisation
            </button>
          )}

          {adding && (
            <form className="stack" onSubmit={submit}>
              {saved.length > 0 && <h3>Ajouter une organisation</h3>}
              <label>
                Organisation
                <input
                  className="field-mono"
                  value={orgUrl}
                  onChange={(e) => setOrgUrl(e.target.value)}
                  placeholder="https://dev.azure.com/mon-organisation"
                  autoFocus={!orgUrl}
                />
              </label>
              {(state?.tokens.length ?? 0) > 0 && (
                <div className="segmented sm" role="group" aria-label="Jeton">
                  <button type="button" aria-pressed={tokenMode === 'new'} onClick={() => setTokenMode('new')}>
                    Nouveau PAT
                  </button>
                  <button type="button" aria-pressed={tokenMode === 'saved'} onClick={() => setTokenMode('saved')}>
                    Jeton enregistré
                  </button>
                </div>
              )}
              {tokenMode === 'new' ? (
                <>
                  <label>
                    Personal Access Token
                    <input type="password" value={pat} onChange={(e) => setPat(e.target.value)} autoFocus={!!orgUrl} />
                  </label>
                  <label>
                    Nom du jeton (facultatif)
                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. PAT toutes organisations" />
                  </label>
                </>
              ) : (
                <label>
                  Jeton enregistré
                  <select value={tokenId} onChange={(e) => setTokenId(e.target.value)}>
                    {state?.tokens.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} ({t.orgCount} organisation{t.orgCount > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="hint-box">
                <IconLock />
                <span>
                  Droits requis : <b>Code — Read &amp; Write</b> et <b>Work Items — Read</b>. Un PAT « toutes les organisations accessibles » peut
                  servir à plusieurs organisations : « Découvrir » les liste. Jetons chiffrés par le trousseau du système.
                </span>
              </div>
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={busy || !hasTokenInput || !orgUrl.trim()}>
                  {busy ? 'Connexion…' : 'Se connecter'}
                </button>
                <button className="btn" type="button" disabled={busy || !hasTokenInput} onClick={discover}>
                  Découvrir mes organisations
                </button>
                {saved.length > 0 && (
                  <button className="btn btn-ghost" type="button" onClick={() => setAdding(false)}>
                    Annuler
                  </button>
                )}
              </div>
              {found && (
                <fieldset className="found">
                  <legend>{found.length ? 'Organisations accessibles avec ce jeton' : 'Aucune organisation trouvée avec ce jeton'}</legend>
                  {found.map((u) => (
                    <label key={u} className="check">
                      <input
                        type="checkbox"
                        checked={picked.has(u)}
                        onChange={(e) => {
                          const n = new Set(picked);
                          if (e.target.checked) n.add(u);
                          else n.delete(u);
                          setPicked(n);
                        }}
                      />
                      {orgName(u)}
                    </label>
                  ))}
                  {found.length > 0 && (
                    <button className="btn btn-primary" type="button" disabled={busy || !picked.size} onClick={addPicked}>
                      Ajouter {picked.size} organisation{picked.size > 1 ? 's' : ''}
                    </button>
                  )}
                </fieldset>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
