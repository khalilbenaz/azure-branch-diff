import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApiError,
  FileSide,
  MergeConflict,
  MergeConflictKind,
  MergePhase,
  MergeResolution,
  MergeSource,
  MergeState,
  MergeTarget,
} from '../../shared/types';
import { EMPTY_SIDE, toFileSide } from '../azure/diff';
import { assertNotGitDir, leafInside } from '../paths';
import { refName, refSpec, repoInfo } from '../local/repo';
import { gitBuffer, gitRun, type GitRun } from '../local/safeGit';
import { assertSafeRepo } from './safety';
import { cleanGitMessage, pushError } from './origin';

export { cleanGitMessage };
export type { MergeConflict, MergeConflictKind, MergePhase, MergeResolution, MergeSource, MergeState, MergeTarget };

export const TMP_PREFIX = 'abd-merge-';
/** Références où l'app conserve un commit de merge pas encore publié (jamais perdu). */
export const ANCHOR_PREFIX = 'refs/abd/merges/';

export interface MergeInput {
  root: string;
  source: MergeSource;
  target: MergeTarget;
  /** Variables d'environnement git supplémentaires (tests). */
  env?: NodeJS.ProcessEnv;
}

const fail = (message: string, code: ApiError['code'] = 'unknown'): ApiError => ({ code, message });
const SYMLINK_MODE = '120000';

/**
 * Une session de merge local. Le merge se fait TOUJOURS dans un worktree temporaire détaché sur le commit cible :
 * la copie de travail n'est jamais dans un état de merge. Au commit, la cible est mise à jour :
 * branche locale non extraite → update-ref (compare-and-swap) ; branche extraite → fast-forward de la copie de travail ;
 * branche Azure → le commit est ancré localement puis poussé.
 */
export class MergeSession {
  private constructor(
    private readonly input: MergeInput,
    private st: MergeState,
    private readonly targetCommit: string,
    private readonly checkedOut: boolean,
  ) {}

  private git(args: string[], dir = this.st.dir): Promise<GitRun> {
    return gitRun(dir, args, this.input.env);
  }

  private async must(args: string[], dir = this.st.dir): Promise<string> {
    const r = await this.git(args, dir);
    if (r.code !== 0) throw fail(cleanGitMessage(r.stderr || r.stdout) || `git ${args[0]} a échoué`);
    return r.stdout;
  }

  static async start(input: MergeInput): Promise<MergeSession> {
    const { root, source, target, env } = input;
    const run = (args: string[], dir = root) => gitRun(dir, args, env);

    await assertSafeRepo(root, source.type === 'remote' || target.kind === 'remote' ? 'network' : 'write');
    for (const key of ['user.name', 'user.email']) {
      if ((await run(['config', '--get', key])).stdout.trim() === '') {
        throw fail(`Identité git manquante : configurez-la avec « git config --global ${key} … ».`);
      }
    }

    // Branches distantes à jour avant le merge.
    const remotes = [source.type === 'remote' ? source.name : null, target.kind === 'remote' ? target.branch : null].filter((b): b is string => !!b);
    for (const b of remotes) {
      refSpec({ type: 'remote', name: b });
      const r = await run(['fetch', '--quiet', 'origin', `+refs/heads/${b}:refs/remotes/origin/${b}`]);
      if (r.code !== 0) throw fail(`Récupération de origin/${b} impossible : ${cleanGitMessage(r.stderr)}`, 'network');
    }

    const commitOf = async (spec: string) => {
      const r = await run(['rev-parse', '--verify', '--quiet', `${spec}^{commit}`]);
      if (r.code !== 0) throw fail(`Référence introuvable : ${spec.replace(/^refs\/(heads|remotes)\//, '')}`);
      return r.stdout.trim();
    };
    const sourceCommit = await commitOf(refSpec(source));
    const targetSpec = target.kind === 'local' ? refSpec({ type: 'branch', name: target.branch }) : refSpec({ type: 'remote', name: target.branch });
    const targetCommit = await commitOf(targetSpec);
    const info = await repoInfo(root);
    const checkedOut = target.kind === 'local' && info.current === target.branch;

    const base: MergeState = {
      root,
      dir: root,
      location: 'worktree',
      sourceLabel: refName(source),
      targetLabel: target.kind === 'remote' ? `origin/${target.branch}` : target.branch,
      targetIsRemote: target.kind === 'remote',
      phase: 'ready',
      conflicts: [],
    };

    // Déjà à jour : détection structurelle (indépendante de la langue de git).
    if ((await run(['merge-base', '--is-ancestor', sourceCommit, targetCommit])).code === 0) {
      return new MergeSession(input, { ...base, phase: 'upToDate' }, targetCommit, checkedOut);
    }

    const dir = mkdtempSync(join(tmpdir(), TMP_PREFIX));
    const add = await run(['worktree', 'add', '--quiet', '--detach', dir, targetCommit]);
    if (add.code !== 0) {
      rmSync(dir, { recursive: true, force: true });
      throw fail(`Préparation du merge impossible : ${cleanGitMessage(add.stderr)}`);
    }
    const session = new MergeSession(input, { ...base, dir }, targetCommit, checkedOut);
    try {
      const merge = await session.git(['merge', '--no-ff', '--no-commit', '--no-edit', '--no-verify-signatures', sourceCommit]);
      session.st.conflicts = await session.readConflicts();
      if (merge.code !== 0 && session.st.conflicts.length === 0) throw fail(`Le merge a échoué : ${cleanGitMessage(`${merge.stderr}\n${merge.stdout}`)}`);
      session.st.phase = session.st.conflicts.length ? 'conflicts' : 'ready';
      return session;
    } catch (e) {
      await session.dispose();
      throw e;
    }
  }

  /** Conflits d'après les étapes de l'index (1 = ancêtre, 2 = cible, 3 = source). */
  private async readConflicts(): Promise<MergeConflict[]> {
    const out = await this.must(['ls-files', '-u', '-z']);
    const stages = new Map<string, Map<number, string>>();
    const modes = new Map<string, Set<string>>();
    for (const entry of out.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      const [mode, sha, stage] = entry.slice(0, tab).split(' ');
      const path = entry.slice(tab + 1);
      if (!stages.has(path)) stages.set(path, new Map());
      stages.get(path)!.set(Number(stage), sha);
      if (!modes.has(path)) modes.set(path, new Set());
      modes.get(path)!.add(mode);
    }
    const list: MergeConflict[] = [];
    for (const [path, s] of stages) {
      let kind: MergeConflictKind = 'text';
      if (!s.has(2) || !s.has(3)) kind = 'deleted';
      else if (modes.get(path)!.has(SYMLINK_MODE)) kind = 'binary'; // lien symbolique : jamais édité
      else {
        const [ours, theirs] = await Promise.all([this.stage(path, 2), this.stage(path, 3)]);
        if (ours.isBinary || theirs.isBinary || ours.tooLarge || theirs.tooLarge || ours.lossy || theirs.lossy) kind = 'binary';
      }
      list.push({ path, kind, resolved: false });
    }
    return list.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async stage(path: string, n: 1 | 2 | 3): Promise<FileSide> {
    const exists = (await this.git(['cat-file', '-e', `:${n}:${path}`])).code === 0;
    return exists ? toFileSide(await gitBuffer(this.st.dir, ['show', `:${n}:${path}`])) : EMPTY_SIDE;
  }

  state(): MergeState {
    return { ...this.st, conflicts: this.st.conflicts.map((c) => ({ ...c })) };
  }

  private conflict(path: string): MergeConflict {
    assertNotGitDir(path);
    const c = this.st.conflicts.find((x) => x.path === path);
    if (!c) throw fail(`Pas de conflit sur ${path}.`);
    return c;
  }

  /** Ancêtre, cible, source, et le fichier fusionné par git (marqueurs de conflit, parties non conflictuelles déjà fusionnées). */
  async conflictSides(path: string): Promise<{ base: FileSide; target: FileSide; source: FileSide; merged: FileSide }> {
    const c = this.conflict(path);
    const [base, target, source] = await Promise.all([this.stage(path, 1), this.stage(path, 2), this.stage(path, 3)]);
    let merged = target;
    if (c.kind === 'text') {
      const leaf = leafInside(this.st.dir, path);
      if (!lstatSync(leaf, { throwIfNoEntry: false })?.isSymbolicLink()) {
        const disk = await readFile(leaf).catch(() => null);
        if (disk) merged = toFileSide(disk);
      }
    }
    return { base, target, source, merged };
  }

  private requirePhase(...phases: MergePhase[]) {
    if (!phases.includes(this.st.phase)) throw fail('Action impossible à cette étape du merge.');
  }

  /** Supprime le fichier du worktree sans suivre un éventuel lien symbolique. */
  private removeLeaf(path: string) {
    rmSync(leafInside(this.st.dir, path), { force: true });
  }

  async resolve(path: string, r: MergeResolution): Promise<void> {
    this.requirePhase('conflicts', 'ready');
    const c = this.conflict(path);
    if (r.kind === 'content') {
      if (c.kind !== 'text') throw fail('Ce fichier (binaire, lien, non UTF-8 ou supprimé d’un côté) ne peut pas être édité : gardez un côté.');
      const leaf = leafInside(this.st.dir, path);
      if (lstatSync(leaf, { throwIfNoEntry: false })?.isSymbolicLink()) throw fail('Refusé : le fichier est un lien symbolique.');
      const target = await this.stage(path, 2);
      const text = r.text.startsWith('﻿') || !target.bom ? r.text : `﻿${r.text}`;
      writeFileSync(leaf, Buffer.from(text, 'utf8'), { flag: 'w' });
      await this.must(['add', '--', path]);
    } else if (r.kind === 'delete') {
      await this.must(['rm', '-q', '--cached', '--ignore-unmatch', '--', path]);
      this.removeLeaf(path);
    } else {
      const stage = r.kind === 'source' ? 3 : 2;
      if ((await this.git(['cat-file', '-e', `:${stage}:${path}`])).code === 0) {
        await this.must(['checkout', r.kind === 'source' ? '--theirs' : '--ours', '--', path]);
        await this.must(['add', '--', path]);
      } else {
        await this.must(['rm', '-q', '--cached', '--ignore-unmatch', '--', path]);
        this.removeLeaf(path);
      }
    }
    c.resolved = true;
    if (this.st.conflicts.every((x) => x.resolved)) this.st.phase = 'ready';
  }

  async commit(message: string): Promise<string> {
    if (this.st.conflicts.some((c) => !c.resolved) || (await this.must(['diff', '--name-only', '--diff-filter=U'])).trim()) {
      throw fail('Il reste des conflits à résoudre avant le commit.');
    }
    this.requirePhase('ready');
    const msg = message.trim() || `Merge ${this.st.sourceLabel} into ${this.st.targetLabel}`;
    await this.must(['commit', '--no-verify', '--no-gpg-sign', '--quiet', '-m', msg]);
    const sha = (await this.must(['rev-parse', 'HEAD'])).trim();
    this.st.commit = sha;
    this.st.phase = 'committed';
    // Ancre locale : le commit n'est jamais perdu, même si la suite échoue.
    const anchor = `${ANCHOR_PREFIX}${Date.now()}`;
    await this.must(['update-ref', anchor, sha], this.st.root);
    if (this.st.targetIsRemote) return sha;
    const branch = this.st.targetLabel;
    if (this.checkedOut) {
      const ff = await this.git(['merge', '--ff-only', '--quiet', sha], this.st.root);
      if (ff.code !== 0) {
        throw fail(
          `Commit de merge créé (${sha.slice(0, 10)}, conservé dans ${anchor}), mais la branche extraite « ${branch} » n'a pas pu avancer : ` +
            `${cleanGitMessage(ff.stderr)}. Commitez ou mettez de côté vos modifications, puis « git merge --ff-only ${sha.slice(0, 10)} ».`,
        );
      }
    } else {
      // Compare-and-swap : refusé si la branche a bougé pendant le merge.
      const up = await this.git(['update-ref', '-m', `merge ${this.st.sourceLabel}`, refSpec({ type: 'branch', name: branch }), sha, this.targetCommit], this.st.root);
      if (up.code !== 0) throw fail(`La branche « ${branch} » a changé pendant le merge : commit conservé dans ${anchor}.`);
    }
    await this.git(['update-ref', '-d', anchor], this.st.root);
    return sha;
  }

  /** Pousse le résultat : cible locale → sa branche distante ; cible Azure → commit:cible. */
  async push(): Promise<void> {
    this.requirePhase('committed');
    await assertSafeRepo(this.st.root, 'network');
    const branch = this.st.targetLabel.replace(/^origin\//, '');
    const dst = refSpec({ type: 'branch', name: branch });
    const args = this.st.targetIsRemote ? ['push', '--quiet', 'origin', `${this.st.commit}:${dst}`] : ['push', '--quiet', 'origin', `${dst}:${dst}`];
    const r = await this.git(args, this.st.root);
    if (r.code !== 0) throw pushError(r.stderr);
    this.st.phase = 'pushed';
    await this.dropAnchors();
  }

  /** Secours quand la cible refuse le push : le commit de merge part sur une branche dédiée (pour une PR). */
  async pushAsBranch(name: string): Promise<string> {
    this.requirePhase('committed');
    await assertSafeRepo(this.st.root, 'network');
    const dst = refSpec({ type: 'branch', name });
    const r = await this.git(['push', '--quiet', 'origin', `${this.st.commit}:${dst}`], this.st.root);
    if (r.code !== 0) throw pushError(r.stderr);
    await this.dropAnchors();
    return name;
  }

  private async dropAnchors() {
    const refs = await this.git(['for-each-ref', '--format=%(refname) %(objectname)', ANCHOR_PREFIX], this.st.root);
    for (const line of refs.stdout.split('\n').filter(Boolean)) {
      const [ref, sha] = line.split(' ');
      if (sha === this.st.commit) await this.git(['update-ref', '-d', ref], this.st.root);
    }
  }

  /** Abandonne le merge : le worktree est supprimé, la cible n'a jamais été modifiée. */
  async abort(): Promise<void> {
    this.st.phase = 'aborted';
    await this.dispose();
  }

  /** Supprime le worktree temporaire. */
  async dispose(): Promise<void> {
    if (this.st.dir === this.st.root) return;
    await gitRun(this.st.root, ['worktree', 'remove', '--force', this.st.dir], this.input.env);
    rmSync(this.st.dir, { recursive: true, force: true });
    await gitRun(this.st.root, ['worktree', 'prune'], this.input.env);
  }
}
