export type AzureSource = { kind: 'azure'; project: string; repoId: string; branch: string };
export type Source = AzureSource | { kind: 'local'; path: string };

/** Référence d'un clone local : branche locale, branche distante origin/*, ou copie de travail (HEAD + fichiers sur disque). */
export type LocalRef = { type: 'branch'; name: string } | { type: 'remote'; name: string } | { type: 'worktree' };
export type LocalSide = { kind: 'local'; root: string; ref: LocalRef };
/** Un côté d'une comparaison ou d'un merge. */
export type Side = AzureSource | LocalSide;

export interface LocalRepoInfo {
  root: string;
  /** Branche extraite (null si HEAD détachée). */
  current: string | null;
  /** Modifications non commitées dans la copie de travail. */
  dirty: boolean;
  branches: string[];
  /** Branches de origin, sans le préfixe « origin/ ». */
  remoteBranches: string[];
  originUrl: string | null;
}

export type ChangeType = 'add' | 'edit' | 'delete' | 'rename';

export interface ChangeEntry {
  path: string;
  originalPath?: string;
  change: ChangeType;
  isBinary: boolean;
  sizeBytes?: number;
  added?: number;
  removed?: number;
}

export interface FileSide {
  content: string;
  isBinary: boolean;
  tooLarge: boolean;
  sizeBytes: number;
  /** Le fichier commençait par un BOM UTF-8 (retiré de content). */
  bom?: boolean;
  /** Contenu non UTF-8 : l'affichage remplace des caractères, une réécriture le corromprait. */
  lossy?: boolean;
}

export interface NamedRef {
  id: string;
  name: string;
}

export type MergeStatus = 'notSet' | 'queued' | 'conflicts' | 'succeeded' | 'rejectedByPolicy' | 'failure';

export interface PrSummary {
  id: number;
  title: string;
  url: string;
  sourceBranch: string;
  targetBranch: string;
  mergeStatus: MergeStatus;
  status: PrStatus;
  lastMergeSourceCommit?: string;
  /** Raison d'un échec de merge renvoyée par Azure. */
  failureMessage?: string;
}

export type PrStatus = 'notSet' | 'active' | 'abandoned' | 'completed';

export interface ConflictEntry {
  id: number;
  path: string;
  type: string;
  resolvableInApp: boolean;
  resolved: boolean;
}

export type Resolution = { kind: 'source' } | { kind: 'target' } | { kind: 'content'; text: string };

export interface CompleteOptions {
  mergeStrategy: 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge';
  deleteSourceBranch: boolean;
  transitionWorkItems: boolean;
  commitMessage: string;
}

export type ErrorCode = 'auth' | 'forbidden' | 'network' | 'notFound' | 'policy' | 'stale' | 'unknown';
export const ERROR_CODES: readonly ErrorCode[] = ['auth', 'forbidden', 'network', 'notFound', 'policy', 'stale', 'unknown'];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const DEFAULT_ORG = '';

/** État de la mise à jour automatique, poussé du processus principal vers l'interface. */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** manual : l'utilisateur télécharge l'installeur lui-même (macOS sans signature Developer ID). */
  | { kind: 'available'; version: string; manual: boolean }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

/** Merge local (voir src/main/merge). */
export type MergeTarget = { kind: 'local'; branch: string } | { kind: 'remote'; branch: string };
export type MergeSource = Extract<LocalRef, { type: 'branch' | 'remote' }>;
export interface MergeStartInput {
  root: string;
  source: MergeSource;
  target: MergeTarget;
}
export type MergeConflictKind = 'text' | 'binary' | 'deleted';
export interface MergeConflict {
  path: string;
  kind: MergeConflictKind;
  resolved: boolean;
}
export type MergePhase = 'conflicts' | 'ready' | 'upToDate' | 'committed' | 'pushed' | 'aborted';
export interface MergeState {
  root: string;
  /** Dossier où se fait le merge (worktree temporaire ou copie de travail). */
  dir: string;
  location: 'worktree' | 'workingCopy';
  sourceLabel: string;
  targetLabel: string;
  targetIsRemote: boolean;
  phase: MergePhase;
  conflicts: MergeConflict[];
  commit?: string;
}
/** Résolution d'un conflit local : celles d'Azure, plus la suppression du fichier. */
export type MergeResolution = Resolution | { kind: 'delete' };
