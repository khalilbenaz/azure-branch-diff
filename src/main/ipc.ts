import { readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Api, CompareResult, NewPrInput, RepoRef } from '../shared/api';
import type { ApiError, AzureSource, ChangeEntry, CompleteOptions, FileSide, Resolution, Result, Source } from '../shared/types';
import { AuthStore, testConnection } from './auth';
import { type AzureContext, trimOrgUrl } from './azure/client';
import { listBranches, listProjects, listRepos } from './azure/browse';
import { EMPTY_SIDE, getFileSide, listBranchChanges, listTree, toFileSide } from './azure/diff';
import { completePr, createPr, fileWebUrl, findActivePr, getPr, prConflictsUrl, waitMergeStatus } from './azure/pr';
import { getConflictSides, listConflicts, resolveConflict } from './azure/conflicts';
import { compareLocalToAzure } from './compare/compareLocal';
import { getGitInfo } from './local/gitInfo';
import { normalizeError } from './errors';
import { isSafeExternalUrl } from './urls';
import { bool, int, obj, oneOf, str } from './validate';

export interface HandlerDeps {
  store: AuthStore;
  connect: (orgUrl: string, pat: string) => Promise<AzureContext>;
  pickFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
}

const fail = (code: ApiError['code'], message: string): ApiError => ({ code, message });

/** Chemin local sûr : refuse tout chemin (ou lien symbolique) qui sortirait du dossier choisi. */
export function insideRoot(root: string, path: string): string {
  const realRoot = realpathSync(root);
  const full = resolve(realRoot, path);
  const real = existsSync(full) ? realpathSync(full) : full;
  const rel = relative(realRoot, real);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw fail('unknown', 'Chemin hors du dossier sélectionné.');
  return real;
}

async function readLocalSide(root: string, path: string): Promise<FileSide> {
  try {
    return toFileSide(await readFile(insideRoot(root, path)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_SIDE;
    throw e;
  }
}

/** Implémentation de l'API côté main. Le PAT reste ici ; chaque erreur est normalisée et masquée. */
export function createHandlers(deps: HandlerDeps): Api {
  let session: { orgUrl: string; pat: string; ctx: AzureContext } | null = null;

  async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const error = normalizeError(e, session?.pat);
      if (error.code === 'auth') session = null;
      return { ok: false, error };
    }
  }

  const ctx = (): AzureContext => {
    if (!session) throw fail('auth', 'Session expirée : reconnectez-vous.');
    return session.ctx;
  };

  async function open(orgUrl: string, pat: string) {
    const url = trimOrgUrl(orgUrl);
    if (!/^https:\/\/[^\s/]+/.test(url)) throw fail('unknown', 'L’URL de l’organisation doit commencer par https://');
    try {
      const c = await deps.connect(url, pat);
      await testConnection(c);
      session = { orgUrl: url, pat, ctx: c };
    } catch (e) {
      throw normalizeError(e, pat);
    }
  }

  // Dossiers locaux choisis par l'utilisateur via la boîte de dialogue : seuls autorisés en lecture.
  const approvedRoots = new Set<string>();
  const approvedRoot = (v: unknown): string => {
    const p = str(v, 'dossier');
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      throw fail('unknown', 'Dossier introuvable.');
    }
    if (!approvedRoots.has(real)) throw fail('unknown', 'Dossier non autorisé : choisissez-le avec « Choisir… ».');
    return real;
  };

  const repoRef = (v: unknown): RepoRef => {
    const o = obj(v, 'dépôt');
    return { project: str(o.project, 'projet'), repoId: str(o.repoId, 'dépôt'), repoName: str(o.repoName, 'nom du dépôt') };
  };
  const azureSource = (v: unknown): AzureSource => {
    const o = obj(v, 'cible');
    oneOf(o.kind, ['azure'] as const, 'type de source');
    return { kind: 'azure', project: str(o.project, 'projet'), repoId: str(o.repoId, 'dépôt'), branch: str(o.branch, 'branche') };
  };
  const source = (v: unknown): Source => {
    const o = obj(v, 'source');
    return o.kind === 'local' ? { kind: 'local', path: approvedRoot(o.path) } : azureSource(o);
  };
  const changeEntry = (v: unknown): ChangeEntry => {
    const o = obj(v, 'fichier');
    return {
      path: str(o.path, 'chemin'),
      ...(o.originalPath !== undefined ? { originalPath: str(o.originalPath, 'chemin d’origine') } : {}),
      change: oneOf(o.change, ['add', 'edit', 'delete', 'rename'] as const, 'type de changement'),
      isBinary: !!o.isBinary,
    };
  };
  const commits = (v: unknown): Pick<CompareResult, 'baseCommit' | 'sourceCommit'> => {
    const o = obj(v, 'comparaison');
    return {
      ...(o.baseCommit !== undefined ? { baseCommit: str(o.baseCommit, 'commit') } : {}),
      ...(o.sourceCommit !== undefined ? { sourceCommit: str(o.sourceCommit, 'commit') } : {}),
    };
  };
  const resolution = (v: unknown): Resolution => {
    const o = obj(v, 'résolution');
    const kind = oneOf(o.kind, ['source', 'target', 'content'] as const, 'résolution');
    return kind === 'content' ? { kind, text: str(o.text, 'contenu', 50 * 1024 * 1024) } : { kind };
  };
  const newPr = (v: unknown): NewPrInput => {
    const o = obj(v, 'PR');
    if (!Array.isArray(o.workItemIds)) throw fail('unknown', 'Paramètre invalide : work items.');
    return {
      source: str(o.source, 'branche source'),
      target: str(o.target, 'branche cible'),
      title: str(o.title, 'titre', 400),
      description: str(o.description, 'description', 100_000),
      workItemIds: o.workItemIds.map((id) => int(id, 'work item')),
    };
  };
  const completeOptions = (v: unknown): CompleteOptions => {
    const o = obj(v, 'options');
    return {
      mergeStrategy: oneOf(o.mergeStrategy, ['noFastForward', 'squash', 'rebase', 'rebaseMerge'] as const, 'stratégie'),
      deleteSourceBranch: bool(o.deleteSourceBranch, 'suppression de branche'),
      transitionWorkItems: bool(o.transitionWorkItems, 'work items'),
      commitMessage: str(o.commitMessage, 'message', 100_000),
    };
  };

  return {
    session: () =>
      wrap(async () => {
        if (session) return { orgUrl: session.orgUrl };
        const creds = deps.store.load();
        if (!creds) return null;
        try {
          await open(creds.orgUrl, creds.pat);
        } catch (e) {
          if ((e as ApiError).code === 'auth') return null;
          throw e;
        }
        return { orgUrl: creds.orgUrl };
      }),

    login: (orgUrl, pat) =>
      wrap(async () => {
        await open(str(orgUrl, 'organisation'), str(pat, 'jeton').trim());
        const s = session!;
        try {
          deps.store.save({ orgUrl: s.orgUrl, pat: s.pat });
        } catch (e) {
          session = null; // pas de session sans PAT enregistré de façon sûre
          throw fail('unknown', (e as Error).message);
        }
        return { orgUrl: s.orgUrl };
      }),

    logout: () =>
      wrap(async () => {
        session = null;
        approvedRoots.clear();
        deps.store.clear();
      }),

    projects: () => wrap(() => listProjects(ctx())),
    repos: (project) => wrap(() => listRepos(ctx(), str(project, 'projet'))),
    branches: (project, repoId) => wrap(() => listBranches(ctx(), str(project, 'projet'), str(repoId, 'dépôt'))),
    pickFolder: () =>
      wrap(async () => {
        const p = await deps.pickFolder();
        if (p) approvedRoots.add(realpathSync(p));
        return p;
      }),

    compare: (src, tgt, m) =>
      wrap(async (): Promise<CompareResult> => {
        const c = ctx();
        const target = azureSource(tgt);
        const from = source(src);
        const mode = oneOf(m, ['mergeBase', 'tips'] as const, 'mode');
        if (from.kind === 'azure') {
          if (from.repoId !== target.repoId) throw fail('unknown', 'Les deux branches doivent appartenir au même dépôt.');
          return listBranchChanges(c, target.project, target.repoId, from.branch, target.branch, mode);
        }
        const tree = await listTree(c, target.project, target.repoId, target.branch);
        const [changes, local] = await Promise.all([compareLocalToAzure(from.path, tree), getGitInfo(from.path)]);
        return { changes, local };
      }),

    fileSides: (src, tgt, e, cmpArg) =>
      wrap(async () => {
        const c = ctx();
        const target = azureSource(tgt);
        const from = source(src);
        const entry = changeEntry(e);
        const cmp = commits(cmpArg);
        const leftPath = entry.originalPath ?? entry.path;
        if (from.kind === 'local') {
          insideRoot(from.path, entry.path);
          const left = entry.change === 'add' ? EMPTY_SIDE : await getFileSide(c, target.project, target.repoId, leftPath, target.branch, 'branch');
          const right = entry.change === 'delete' ? EMPTY_SIDE : await readLocalSide(from.path, entry.path);
          return { left, right };
        }
        const [left, right] = await Promise.all([
          entry.change === 'add' ? EMPTY_SIDE : getFileSide(c, target.project, target.repoId, leftPath, cmp.baseCommit ?? ''),
          entry.change === 'delete' ? EMPTY_SIDE : getFileSide(c, target.project, target.repoId, entry.path, cmp.sourceCommit ?? ''),
        ]);
        return { left, right };
      }),

    findPr: (r, src, tgt) =>
      wrap(() => {
        const x = repoRef(r);
        return findActivePr(ctx(), x.project, x.repoId, x.repoName, str(src, 'branche source'), str(tgt, 'branche cible'));
      }),
    createPr: (r, input) =>
      wrap(() => {
        const x = repoRef(r);
        return createPr(ctx(), x.project, x.repoId, x.repoName, newPr(input));
      }),
    getPr: (r, prId) =>
      wrap(() => {
        const x = repoRef(r);
        return getPr(ctx(), x.project, x.repoId, x.repoName, int(prId, 'PR'));
      }),
    waitPr: (r, prId, afterResolve) =>
      wrap(() => {
        const x = repoRef(r);
        return waitMergeStatus(ctx(), x.project, x.repoId, x.repoName, int(prId, 'PR'), { alsoWhileConflicts: afterResolve === true });
      }),
    completePr: (r, prId, o) =>
      wrap(() => {
        const x = repoRef(r);
        return completePr(ctx(), x.project, x.repoId, x.repoName, int(prId, 'PR'), completeOptions(o));
      }),
    conflicts: (r, prId) =>
      wrap(() => {
        const x = repoRef(r);
        return listConflicts(ctx(), x.project, x.repoId, int(prId, 'PR'));
      }),
    conflictSides: (r, prId, id) =>
      wrap(() => {
        const x = repoRef(r);
        return getConflictSides(ctx(), x.project, x.repoId, int(prId, 'PR'), int(id, 'conflit'));
      }),
    resolve: (r, prId, id, res) =>
      wrap(() => {
        const x = repoRef(r);
        return resolveConflict(ctx(), x.project, x.repoId, int(prId, 'PR'), int(id, 'conflit'), resolution(res));
      }),
    conflictsUrl: (r, prId) =>
      wrap(async () => {
        const x = repoRef(r);
        return prConflictsUrl(ctx().orgUrl, x.project, x.repoName, int(prId, 'PR'));
      }),
    fileUrl: (r, path, branch) =>
      wrap(async () => {
        const x = repoRef(r);
        return fileWebUrl(ctx().orgUrl, x.project, x.repoName, str(path, 'chemin'), str(branch, 'branche'));
      }),

    openExternal: (url) =>
      wrap(async () => {
        if (!isSafeExternalUrl(url)) throw fail('unknown', 'Seuls les liens https sont ouverts.');
        await deps.openExternal(url);
      }),
  };
}
