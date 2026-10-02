import type { ApiError } from '../../shared/types';

const VSSPS = 'https://app.vssps.visualstudio.com/_apis';

/**
 * Organisations Azure DevOps accessibles avec un jeton (PAT « toutes les organisations accessibles »,
 * ou PAT d'une seule organisation : la liste contient alors au moins celle-ci si le jeton le permet).
 */
export async function discoverOrgs(pat: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const headers = { Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`, Accept: 'application/json' };
  const get = async (url: string) => {
    const r = await fetchImpl(url, { headers, redirect: 'manual' });
    // Jeton refusé : 401, ou 203 / redirection vers la page de connexion.
    if (r.status === 401 || r.status === 203 || (r.status >= 300 && r.status < 400)) {
      const e: ApiError = { code: 'auth', message: 'Jeton refusé : impossible de lister les organisations (droits du PAT ou portée « organisation unique »).' };
      throw e;
    }
    if (!r.ok) throw { statusCode: r.status, message: `HTTP ${r.status}` };
    return r.json();
  };
  const me = (await get(`${VSSPS}/profile/profiles/me?api-version=7.1`)) as { id?: string };
  if (!me?.id) throw { code: 'auth', message: 'Profil Azure DevOps introuvable pour ce jeton.' } satisfies ApiError;
  const accounts = (await get(`${VSSPS}/accounts?memberId=${encodeURIComponent(me.id)}&api-version=7.1`)) as { value?: { accountName?: string }[] };
  return (accounts.value ?? [])
    .map((a) => a.accountName)
    .filter((n): n is string => !!n && /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(n))
    .map((n) => `https://dev.azure.com/${n}`)
    .sort((a, b) => a.localeCompare(b));
}
