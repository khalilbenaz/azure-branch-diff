import { readFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Api, CompareResult, NewPrInput, RepoRef } from '../shared/api';
import type { ApiError, AzureSource, ChangeEntry, CompleteOptions, LocalRef, MergeResolution, MergeStartInput, Resolution, Result, Side } from '../shared/types';
import { AuthStore, testConnection } from './auth';
import { type AzureContext, trimOrgUrl } from './azure/client';
import { listBranches, listProjects, listRepos } from './azure/browse';
import { EMPTY_SIDE, getFileSide, listBranchChanges, listTree, toFileSide } from './azure/diff';
import { completePr, createPr, fileWebUrl, findActivePr, getPr, prConflictsUrl, waitMergeStatus } from './azure/pr';
import { getConflictSides, listConflicts, resolveConflict } from './azure/conflicts';
import { compareSides, sidesContent } from './compare/compareSides';
import { refSpec, repoInfo, repoRoot } from './local/repo';
import { MergeSession } from './merge/session';
import { originMatches, pushLocalBranch } from './merge/origin';
import { cleanupStaleMerges } from './merge/cleanup';
import { assertSafeRepo } from './merge/safety';
import { normalizeError } from './errors';
import { insideRoot } from './paths';
import { isSafeExternalUrl } from './urls';
import { bool, int, obj, oneOf, str } from './validate';

export interface HandlerDeps {
  store: AuthStore;
  connect: (orgUrl: string, pat: string) => Promise<AzureContext>;
  pickFolder: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  /** Confirmation native avant une action sur le serveur (push). Absente : refusée. */
  confirm?: (message: string, detail: string) => Promise<boolean>;
}

const fail = (code: ApiError['code'], message: string): ApiError => ({ code, message });

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
      real = realpathSync.native(p);
    } catch {
      throw fail('unknown', 'Dossier introuvable.');
    }
    if (!approvedRoots.has(real)) throw fail('unknown', 'Dossier non autorisé : choisissez-le avec « Choisir… ».');
    return real;
  };

  const mergeInput = (v: unknown): MergeStartInput => {
    const o = obj(v, 'merge');
    const src = localRef(o.source);
    if (src.type === 'worktree') throw fail('unknown', 'La source d’un merge doit être une branche.');
    const t = obj(o.target, 'cible');
    const kind = oneOf(t.kind, ['local', 'remote'] as const, 'cible');
    const branch = str(t.branch, 'branche cible', 400);
    refSpec({ type: 'branch', name: branch });
    return { root: approvedRoot(o.root), source: src, target: { kind, branch } };
  };
  const mergeResolution = (v: unknown): MergeResolution => {
    const o = obj(v, 'résolution');
    if (o.kind === 'delete') return { kind: 'delete' };
    return resolution(o);
  };

  let merge: MergeSession | null = null;
  let mergeStarting = false;
  const activeMerge = (): MergeSession => {
    if (!merge) throw fail('unknown', 'Aucun merge en cours.');
    return merge;
  };
  /** Terminé et sans risque de perte : un commit vers Azure non poussé n'est pas « terminé ». */
  const mergeDone = (m: MergeSession) => {
    const st = m.state();
    return ['upToDate', 'pushed', 'aborted'].includes(st.phase) || (st.phase === 'committed' && !st.targetIsRemote);
  };
  /** Le push agit sur le serveur avec les identifiants git de l'utilisateur : confirmation native, hors de portée de l'interface. */
  async function confirmPush(root: string, ref: string) {
    const info = await repoInfo(root);
    const ok = await (deps.confirm ?? (async () => false))(
      `Pousser vers ${ref} ?`,
      `Remote origin : ${info.originUrl ?? 'inconnu'}\nCette action modifie le dépôt distant.`,
    );
    if (!ok) throw fail('unknown', 'Push annulé.');
  }
  /** Une PR n'a de sens que si origin est bien le dépôt Azure où elle sera créée. */
  async function assertOriginIs(root: string, r: RepoRef) {
    const info = await repoInfo(root);
    if (!originMatches(info.originUrl, session?.orgUrl ?? '', r.project, r.repoName)) {
      throw fail('unknown', `L’origin du clone (${info.originUrl ?? 'aucun'}) n’est pas le dépôt Azure « ${r.repoName} » : PR impossible depuis ce clone.`);
    }
  }

  const repoRef = (v: unknown): RepoRef => {
    const o = obj(v, 'dépôt');
    return { project: str(o.project, 'projet'), repoId: str(o.repoId, 'dépôt'), repoName: str(o.repoName, 'nom du dépôt') };
  };
  const azureSource = (v: unknown): AzureSource => {
    const o = obj(v, 'cible');
    oneOf(o.kind, ['azure'] as const, 'type de source');
    return { kind: 'azure', project: str(o.project, 'projet'), repoId: str(o.repoId, 'dépôt'), branch: str(o.branch, 'branche') };
  };
  const localRef = (v: unknown): LocalRef => {
    const o = obj(v, 'référence locale');
    const type = oneOf(o.type, ['branch', 'remote', 'worktree'] as const, 'type de référence');
    if (type === 'worktree') return { type };
    const name = str(o.name, 'branche', 400);
    refSpec({ type, name }); // refuse les noms dangereux
    return { type, name };
  };
  const side = (v: unknown): Side => {
    const o = obj(v, 'côté');
    return o.kind === 'local' ? { kind: 'local', root: approvedRoot(o.root), ref: localRef(o.ref) } : azureSource(o);
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
  const commits = (v: unknown): CompareResult => {
    const o = obj(v, 'comparaison');
    const opt = (k: 'baseCommit' | 'sourceCommit' | 'targetCommit') => (o[k] !== undefined ? { [k]: str(o[k], 'commit', 400) } : {});
    return {
      changes: [],
      ...(o.kind !== undefined ? { kind: oneOf(o.kind, ['azure', 'local', 'mixed'] as const, 'type de comparaison') } : {}),
      ...opt('baseCommit'),
      ...opt('sourceCommit'),
      ...opt('targetCommit'),
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
        if (p) approvedRoots.add(realpathSync.native(p));
        return p;
      }),

    localRepo: (dir) =>
      wrap(async () => {
        const chosen = approvedRoot(dir);
        const root = await repoRoot(chosen);
        // Jamais d'élargissement : le dossier choisi doit être la racine du dépôt.
        if (root !== chosen) throw fail('unknown', `Choisissez la racine du dépôt : ${root}`);
        await assertSafeRepo(root);
        if (!merge && !mergeStarting) await cleanupStaleMerges([root]); // restes d'un arrêt brutal pendant un merge
        return repoInfo(root);
      }),

    compare: (src, tgt, m) =>
      wrap(async (): Promise<CompareResult> => {
        const [source, target] = [side(src), side(tgt)];
        const mode = oneOf(m, ['mergeBase', 'tips'] as const, 'mode');
        for (const s of [source, target]) if (s.kind === 'local') await assertSafeRepo(s.root);
        return compareSides(session?.ctx ?? null, source, target, mode);
      }),

    fileSides: (src, tgt, e, cmpArg) =>
      wrap(async () => {
        const [source, target] = [side(src), side(tgt)];
        const entry = changeEntry(e);
        for (const s of [source, target]) if (s.kind === 'local') insideRoot(s.root, entry.path);
        for (const s of [source, target]) if (s.kind === 'local') await assertSafeRepo(s.root);
        return sidesContent(session?.ctx ?? null, source, target, entry, commits(cmpArg));
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

    mergeStart: (input) =>
      wrap(async () => {
        const i = mergeInput(input);
        if (mergeStarting || (merge && !mergeDone(merge))) throw fail('unknown', 'Un merge est déjà en cours : terminez-le ou annulez-le.');
        mergeStarting = true;
        try {
          await merge?.dispose();
          merge = null;
          merge = await MergeSession.start(i);
          return merge.state();
        } finally {
          mergeStarting = false;
        }
      }),
    mergeState: () => wrap(async () => merge?.state() ?? null),
    mergeConflictSides: (path) => wrap(() => activeMerge().conflictSides(str(path, 'chemin'))),
    mergeResolve: (path, r) =>
      wrap(async () => {
        const m = activeMerge();
        const p = str(path, 'chemin');
        insideRoot(m.state().dir, p);
        await m.resolve(p, mergeResolution(r));
        return m.state();
      }),
    mergeCommit: (message) =>
      wrap(async () => {
        const m = activeMerge();
        await m.commit(str(message, 'message', 100_000));
        return m.state();
      }),
    mergePush: () =>
      wrap(async () => {
        const m = activeMerge();
        const st = m.state();
        await confirmPush(st.root, `origin/${st.targetLabel.replace(/^origin\//, '')}`);
        await m.push();
        return m.state();
      }),
    mergeFallbackPr: (r, title) =>
      wrap(async () => {
        const c = ctx(); // la PR exige une session Azure
        const x = repoRef(r);
        const m = activeMerge();
        const st = m.state();
        const slug = (s: string) => s.replace(/^origin\//, '').replace(/[^A-Za-z0-9._-]+/g, '-');
        const target = st.targetLabel.replace(/^origin\//, '');
        await assertOriginIs(st.root, x);
        const name = `merge/${slug(st.sourceLabel)}-into-${slug(target)}-${Date.now().toString(36)}`;
        await confirmPush(st.root, `origin/${name}`);
        const branch = await m.pushAsBranch(name);
        return createPr(c, x.project, x.repoId, x.repoName, { source: branch, target, title: str(title, 'titre', 400), description: '', workItemIds: [] });
      }),
    mergeAbort: () =>
      wrap(async () => {
        await merge?.abort();
        merge = null;
        return null;
      }),
    mergeClose: () =>
      wrap(async () => {
        if (merge && !mergeDone(merge) && merge.state().phase !== 'committed') throw fail('unknown', 'Le merge n’est pas terminé : validez le commit ou annulez.');
        await merge?.dispose(); // un commit non poussé reste ancré dans refs/abd/merges/
        merge = null;
        return null;
      }),
    pushBranch: (root, branch, r) =>
      wrap(async () => {
        const dir = approvedRoot(root);
        const b = str(branch, 'branche', 400);
        await assertOriginIs(dir, repoRef(r));
        await confirmPush(dir, `origin/${b}`);
        await pushLocalBranch(dir, b);
      }),
    originCheck: (root, r) =>
      wrap(async () => {
        const x = repoRef(r);
        const info = await repoInfo(approvedRoot(root));
        return { matches: originMatches(info.originUrl, session?.orgUrl ?? '', x.project, x.repoName), originUrl: info.originUrl };
      }),

    openExternal: (url) =>
      wrap(async () => {
        if (!isSafeExternalUrl(url)) throw fail('unknown', 'Seuls les liens https sont ouverts.');
        await deps.openExternal(url);
      }),
  };
}
