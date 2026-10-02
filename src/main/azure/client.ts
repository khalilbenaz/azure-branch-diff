import * as azdev from 'azure-devops-node-api';
import type { IGitApi } from 'azure-devops-node-api/GitApi';

/** Méthodes du client Git Azure utilisées par l'app (permet de les remplacer par un fake). */
export type GitLike = Pick<
  IGitApi,
  | 'getRepositories'
  | 'getBranches'
  | 'getCommitDiffs'
  | 'getItemContent'
  | 'getItems'
  | 'getPullRequests'
  | 'getPullRequestById'
  | 'createPullRequest'
  | 'updatePullRequest'
  | 'getPullRequestConflicts'
  | 'updatePullRequestConflict'
>;

export interface CoreLike {
  getProjects(stateFilter?: undefined, top?: number, skip?: number): Promise<{ id?: string; name?: string }[]>;
}

export interface AzureContext {
  orgUrl: string;
  git: GitLike;
  core: CoreLike;
}

// Délai d'inactivité du socket : l'arbre complet d'un très gros dépôt peut dépasser 15 s côté serveur.
export const REQUEST_TIMEOUT_MS = 60000;

export const trimOrgUrl = (url: string) => url.trim().replace(/\/+$/, '');

export async function createAzureContext(orgUrl: string, pat: string): Promise<AzureContext> {
  const url = trimOrgUrl(orgUrl);
  const conn = new azdev.WebApi(url, azdev.getPersonalAccessTokenHandler(pat), { socketTimeout: REQUEST_TIMEOUT_MS });
  return { orgUrl: url, git: guardNullResults(await conn.getGitApi()), core: guardNullResults(await conn.getCoreApi()) };
}

/**
 * Quand le PAT est refusé, Azure répond souvent 203 avec une page HTML de connexion : le SDK avale
 * l'erreur de parsing et renvoie null. Aucune des méthodes JSON utilisées ne renvoie null légitimement,
 * donc un résultat null est traité comme un refus d'authentification.
 */
export function guardNullResults<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const v = Reflect.get(obj, prop, receiver);
      if (typeof v !== 'function') return v;
      return async (...args: unknown[]) => {
        const r = await (v as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
        if (r === null || r === undefined) throw { statusCode: 401, message: 'Réponse vide (page de connexion Azure)' };
        return r;
      };
    },
  });
}

export const toRefName = (branch: string) => (branch.startsWith('refs/') ? branch : `refs/heads/${branch}`);
export const shortBranch = (ref: string) => ref.replace(/^refs\/heads\//, '');

/**
 * Lit un flux renvoyé par le SDK. Le SDK ne vérifie pas le code HTTP des réponses en flux :
 * on le fait ici. 203 = page de connexion HTML renvoyée par Azure quand le PAT est refusé.
 */
export async function readStream(s: NodeJS.ReadableStream): Promise<{ status: number; body: Buffer }> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as string));
  const status = (s as { statusCode?: number }).statusCode ?? 200;
  const body = Buffer.concat(chunks);
  if (status === 401 || status === 403 || status === 203) {
    throw { statusCode: 401, message: `HTTP ${status}` };
  }
  if (status >= 400) {
    let message = `HTTP ${status}`;
    try {
      message = (JSON.parse(body.toString('utf8')) as { message?: string }).message ?? message;
    } catch {
      /* corps non JSON */
    }
    throw { statusCode: status, message };
  }
  return { status, body };
}
