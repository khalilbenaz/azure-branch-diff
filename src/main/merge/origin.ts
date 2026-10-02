import type { ApiError } from '../../shared/types';
import { refSpec } from '../local/repo';
import { gitRun } from '../local/safeGit';
import { assertSafeRepo } from './safety';

/** Retire d'un message git les identifiants éventuels d'une URL (https://user:token@hôte). */
export function cleanGitMessage(text: string): string {
  // Jusqu'au dernier « @ » de l'URL : un secret peut contenir « @ » ou « / ».
  return text.replace(/(\w+:\/\/)\S*@/g, '$1***@').trim();
}

const dec = (s: string) => {
  try {
    return decodeURIComponent(s).toLowerCase();
  } catch {
    return s.toLowerCase();
  }
};

/** Organisation d'une URL d'organisation Azure DevOps (dev.azure.com/org ou org.visualstudio.com). */
function orgOf(orgUrl: string): string {
  const m = /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)/i.exec(orgUrl) ?? /^https:\/\/([^./]+)\.visualstudio\.com/i.exec(orgUrl);
  return m ? dec(m[1]) : '';
}

/** Vrai si l'URL `origin` du clone désigne le dépôt Azure (organisation, projet, dépôt). */
export function originMatches(originUrl: string | null, orgUrl: string, project: string, repoName: string): boolean {
  if (!originUrl) return false;
  const patterns = [
    /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i,
    /^https:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i,
    /^(?:ssh:\/\/)?[^@]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com):(?:22\/)?v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i,
  ];
  for (const p of patterns) {
    const m = p.exec(originUrl.trim());
    if (m) return dec(m[1]) === orgOf(orgUrl) && dec(m[2]) === project.toLowerCase() && dec(m[3]).replace(/\.git$/, '') === repoName.toLowerCase();
  }
  return false;
}

/** Classe une erreur de push : refus de politique / non fast-forward → policy, sinon message nettoyé. */
export function pushError(stderr: string): ApiError {
  const msg = cleanGitMessage(stderr);
  if (/rejected|declined|not permitted|protected|TF402455|TF401027|pre-receive hook|non-fast-forward|fetch first/i.test(stderr)) {
    return { code: 'policy', message: 'Push refusé par Azure (politique de branche ou branche plus récente sur le serveur).', details: msg };
  }
  if (/authentication failed|error: 40[13]\b|returned error: 40[13]\b/i.test(stderr)) {
    return { code: 'forbidden', message: 'Push refusé : identifiants git invalides ou droits insuffisants.', details: msg };
  }
  if (/could not resolve host|timed out|unable to access|network/i.test(stderr)) return { code: 'network', message: 'Push impossible : Azure DevOps est injoignable.', details: msg };
  return { code: 'unknown', message: `Push impossible : ${msg}` };
}

/** Pousse une branche locale vers origin (avant une PR depuis une branche locale). */
export async function pushLocalBranch(root: string, branch: string): Promise<void> {
  await assertSafeRepo(root);
  const spec = refSpec({ type: 'branch', name: branch });
  const r = await gitRun(root, ['push', '--quiet', 'origin', `${spec}:${spec}`]);
  if (r.code !== 0) throw pushError(r.stderr);
}
