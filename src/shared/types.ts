export type AzureSource = { kind: 'azure'; project: string; repoId: string; branch: string };
export type Source = AzureSource | { kind: 'local'; path: string };

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
