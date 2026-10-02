import { Readable } from 'node:stream';
import type { GitCommitDiffs, GitConflict, GitItem, GitPullRequest, VersionControlChangeType } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { blobSha } from '../local/blobSha';
import { shortBranch, type AzureContext, type GitLike } from './client';

/**
 * Azure DevOps en mémoire : utilisé par les tests et par le mode démo (AZ_FAKE=1).
 * Projet « Demo », dépôt « Gateway » (repo1), branches master (tgt222) et feature/data (src111).
 */
export interface FakeOptions {
  bulkChanges?: number;
  streamStatus?: number;
  /** Nombre de lectures de PR renvoyant « queued » avant le résultat. */
  queuedPolls?: number;
  noConflicts?: boolean;
  /** Simule une API qui renvoie les enums en chaînes. */
  stringEnums?: boolean;
  /** Taille de page maximale imposée par le serveur pour getCommitDiffs. */
  pageCap?: number;
  /** getItems renvoie gitObjectType en chaîne ('tree' / 'blob'). */
  stringObjectTypes?: boolean;
  /** Nombre de lectures « active » après la demande de complétion avant « completed ». */
  completionPolls?: number;
  /** La complétion échoue de façon asynchrone avec ce message. */
  completionFails?: string;
  /** Le conflit 1 n'a pas d'ancêtre commun. */
  conflictWithoutBase?: boolean;
  /** Lectures renvoyant encore « conflicts » après la résolution du dernier conflit. */
  staleConflictPolls?: number;
  manyProjects?: number;
  manyConflicts?: number;
}

/** Le serveur Azure plafonne les pages à 100 éléments par défaut. */
const SERVER_PAGE = 100;

const BIG = 'x'.repeat(2 * 1024 * 1024 + 1);

const FILES: Record<string, Record<string, string | Buffer>> = {
  base000: {
    'src/Service.cs': 'public class Service\n{\n    // Export v1\n    public int Amount => 10;\n}\n',
    'old.sql': 'select 1;\n',
    'big.sql': 'small\n',
  },
  tgt222: {
    'src/Service.cs': 'public class Service\n{\n    // Export v1\n    public int Amount => 20;\n}\n',
    'old.sql': 'select 1;\n',
    'big.sql': 'small\n',
    'bin/x.dll': Buffer.from([0x4d, 0x5a, 0x00, 0x01]),
  },
  src111: {
    'src/Service.cs': 'public class Service\n{\n    // Export csv\n    public int Amount => 30;\n    public string Volume => "1Go";\n}\n',
    'src/Data.cs': 'public class Data { }\n',
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
    'big.sql': BIG,
  },
};

const BRANCH_COMMITS: Record<string, string> = { master: 'tgt222', 'feature/data': 'src111' };

const DEFAULT_CHANGES = [
  { changeType: 2, path: '/src/Service.cs' },
  { changeType: 1, path: '/src/Data.cs' },
  { changeType: 16, path: '/old.sql' },
  { changeType: 1, path: '/logo.png' },
  { changeType: 2, path: '/big.sql' },
];

function notFound(): never {
  throw Object.assign(new Error('not found'), { statusCode: 404 });
}

function stream(body: Buffer | string, statusCode = 200): NodeJS.ReadableStream {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode });
}

function commitOf(version: string): string {
  return BRANCH_COMMITS[shortBranch(version)] ?? version;
}

export class FakeGitApi {
  diffCalls = 0;
  contentVersions: string[] = [];
  lastResolveLfs?: boolean;

  constructor(protected readonly opts: FakeOptions = {}) {}

  async getRepositories() {
    return [{ id: 'repo1', name: 'Gateway' }];
  }

  async getBranches() {
    return [{ name: 'feature/data' }, { name: 'master' }];
  }

  async getCommitDiffs(
    _repo: string,
    _project: string,
    _common: boolean,
    top = 100,
    skip = 0,
  ): Promise<GitCommitDiffs> {
    this.diffCalls++;
    const all = this.opts.bulkChanges
      ? Array.from({ length: this.opts.bulkChanges }, (_, i) => ({ changeType: 2, path: `/gen/F${String(i).padStart(5, '0')}.cs` }))
      : DEFAULT_CHANGES;
    const page = all.slice(skip, skip + Math.min(top, this.opts.pageCap ?? top));
    return {
      changes: page.map((c) => ({ changeType: c.changeType as VersionControlChangeType, item: { path: c.path, gitObjectType: 3 } })),
      allChangesIncluded: skip + page.length >= all.length,
      commonCommit: 'base000',
      baseCommit: 'tgt222',
      targetCommit: 'src111',
    };
  }

  async getItemContent(
    _repo: string,
    path: string,
    _project?: string,
    _scope?: string,
    _rec?: unknown,
    _meta?: boolean,
    _latest?: boolean,
    _download?: boolean,
    version?: { version?: string },
    _includeContent?: boolean,
    resolveLfs?: boolean,
  ): Promise<NodeJS.ReadableStream> {
    this.contentVersions.push(version?.version ?? '');
    this.lastResolveLfs = resolveLfs;
    if (this.opts.streamStatus) return stream('<html>sign in</html>', this.opts.streamStatus);
    const content = FILES[commitOf(version?.version ?? '')]?.[path.replace(/^\/+/, '')];
    if (content === undefined) return stream('{"message":"TF401174: item not found"}', 404);
    return stream(content);
  }

  async getItems(
    _repo: string,
    _project?: string,
    _scope?: string,
    _rec?: unknown,
    _meta?: boolean,
    _latest?: boolean,
    _download?: boolean,
    _links?: boolean,
    version?: { version?: string },
  ): Promise<GitItem[]> {
    const files = FILES[commitOf(version?.version ?? '')] ?? notFound();
    const t = (n: number, name: string) => (this.opts.stringObjectTypes ? name : n) as GitItem['gitObjectType'];
    const items: GitItem[] = [{ path: '/', gitObjectType: t(2, 'tree'), isFolder: true }, { path: '/src', gitObjectType: t(2, 'tree'), isFolder: true }];
    for (const [p, c] of Object.entries(files)) items.push({ path: '/' + p, gitObjectType: t(3, 'blob'), objectId: blobSha(Buffer.from(c)) });
    return items;
  }

  prs: GitPullRequest[] = [];
  lastCreated?: GitPullRequest;
  lastUpdate?: GitPullRequest;
  lastResolution?: GitConflict;
  private polls = 0;
  private completionReads = 0;
  private staleReads = 0;
  private conflicts: GitConflict[] = [
    {
      conflictId: 1,
      conflictType: 8, // EditEdit
      conflictPath: '/src/Service.cs',
      mergeSourceCommit: { commitId: 'src111' },
      mergeTargetCommit: { commitId: 'tgt222' },
      mergeBaseCommit: { commitId: 'base000' },
      resolutionStatus: 0,
    },
    { conflictId: 2, conflictType: 13, conflictPath: '/img/logo.png', resolutionStatus: 0 }, // RenameDelete
  ];

  private enumOut<T>(n: number, names: string[]): T {
    return (this.opts.stringEnums ? names[n] : n) as T;
  }

  async getPullRequests(_repo: string, criteria: { sourceRefName?: string; targetRefName?: string }) {
    return this.prs.filter((p) => p.status === 1 && p.sourceRefName === criteria.sourceRefName && p.targetRefName === criteria.targetRefName);
  }

  async createPullRequest(pr: GitPullRequest): Promise<GitPullRequest> {
    this.lastCreated = pr;
    const created: GitPullRequest = { ...pr, pullRequestId: this.prs.length + 1, status: 1, mergeStatus: 1, lastMergeSourceCommit: { commitId: 'src111' } };
    this.prs.push(created);
    return created;
  }

  async getPullRequestById(id: number): Promise<GitPullRequest> {
    const pr = this.prs.find((p) => p.pullRequestId === id) ?? notFound();
    const queued = this.polls++ < (this.opts.queuedPolls ?? 0);
    const unresolved = this.conflicts.some((c) => c.resolutionStatus !== 2);
    const stale = !unresolved && this.staleReads++ < (this.opts.staleConflictPolls ?? 0);
    const status = queued ? 1 : this.opts.noConflicts || (!unresolved && !stale) ? 3 : 2;
    const out: GitPullRequest = { ...pr, mergeStatus: this.enumOut(status, ['notSet', 'queued', 'conflicts', 'succeeded']) };
    if (pr.status === 3) {
      // Complétion demandée : Azure la traite de façon asynchrone.
      if (this.opts.completionFails) return { ...out, status: 1, mergeFailureMessage: this.opts.completionFails };
      if (this.completionReads++ < (this.opts.completionPolls ?? 0)) return { ...out, status: 1 };
    }
    return out;
  }

  async updatePullRequest(update: GitPullRequest, _repo: string, id: number): Promise<GitPullRequest> {
    this.lastUpdate = update;
    const pr = this.prs.find((p) => p.pullRequestId === id) ?? notFound();
    Object.assign(pr, update);
    return pr;
  }

  async getPullRequestConflicts(_repo?: string, _pr?: number, _project?: string, skip = 0, top = SERVER_PAGE): Promise<GitConflict[]> {
    if (this.opts.noConflicts) return [];
    if (this.opts.conflictWithoutBase) delete this.conflicts[0].mergeBaseCommit;
    if (this.opts.manyConflicts && this.conflicts.length < this.opts.manyConflicts) {
      for (let i = this.conflicts.length; i < this.opts.manyConflicts; i++) {
        this.conflicts.push({ conflictId: i + 1, conflictType: 8, conflictPath: `/gen/C${i}.cs`, resolutionStatus: 0 });
      }
    }
    return this.conflicts.slice(skip, skip + Math.min(top, SERVER_PAGE)).map((c) => ({
      ...c,
      conflictType: this.opts.stringEnums ? (c.conflictType === 8 ? 'editEdit' : 'renameDelete') : c.conflictType,
    })) as GitConflict[];
  }

  async updatePullRequestConflict(update: GitConflict, _repo: string, _pr: number, conflictId: number): Promise<GitConflict> {
    this.lastResolution = update;
    const c = this.conflicts.find((x) => x.conflictId === conflictId) ?? notFound();
    c.resolutionStatus = 2;
    return c;
  }
}

export function fakeContext(opts: FakeOptions = {}): AzureContext {
  return {
    orgUrl: 'https://dev.azure.com/Fake',
    git: new FakeGitApi(opts) as unknown as GitLike,
    core: {
      getProjects: async (_state?: unknown, top = SERVER_PAGE, skip = 0) => {
        const all = opts.manyProjects
          ? Array.from({ length: opts.manyProjects }, (_, i) => ({ id: `p${i}`, name: `P${String(i).padStart(3, '0')}` }))
          : [{ id: 'p1', name: 'Demo' }];
        return all.slice(skip, skip + Math.min(top, SERVER_PAGE));
      },
    },
  };
}
