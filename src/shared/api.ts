import type {
  AzureSource,
  ChangeEntry,
  CompleteOptions,
  ConflictEntry,
  FileSide,
  NamedRef,
  PrSummary,
  Resolution,
  Result,
  Source,
} from './types';

export interface LocalInfo {
  branch: string;
  commit: string;
  subject: string;
}

export interface CompareResult {
  changes: ChangeEntry[];
  baseCommit?: string;
  sourceCommit?: string;
  targetCommit?: string;
  local?: LocalInfo | null;
}

export interface NewPrInput {
  source: string;
  target: string;
  title: string;
  description: string;
  workItemIds: number[];
}

export interface RepoRef {
  project: string;
  repoId: string;
  repoName: string;
}

/** Contrat entre l'interface (renderer) et le processus principal. Chaque appel renvoie un Result. */
export interface Api {
  session(): Promise<Result<{ orgUrl: string } | null>>;
  login(orgUrl: string, pat: string): Promise<Result<{ orgUrl: string }>>;
  logout(): Promise<Result<void>>;
  projects(): Promise<Result<NamedRef[]>>;
  repos(project: string): Promise<Result<NamedRef[]>>;
  branches(project: string, repoId: string): Promise<Result<string[]>>;
  pickFolder(): Promise<Result<string | null>>;
  compare(source: Source, target: AzureSource, mode: 'mergeBase' | 'tips'): Promise<Result<CompareResult>>;
  fileSides(source: Source, target: AzureSource, entry: ChangeEntry, cmp: CompareResult): Promise<Result<{ left: FileSide; right: FileSide }>>;
  findPr(repo: RepoRef, source: string, target: string): Promise<Result<PrSummary | null>>;
  createPr(repo: RepoRef, input: NewPrInput): Promise<Result<PrSummary>>;
  getPr(repo: RepoRef, prId: number): Promise<Result<PrSummary>>;
  /** afterResolve : continue d'attendre tant qu'Azure affiche encore « conflicts » (juste après la dernière résolution). */
  waitPr(repo: RepoRef, prId: number, afterResolve?: boolean): Promise<Result<PrSummary>>;
  completePr(repo: RepoRef, prId: number, o: CompleteOptions): Promise<Result<PrSummary>>;
  conflicts(repo: RepoRef, prId: number): Promise<Result<ConflictEntry[]>>;
  conflictSides(repo: RepoRef, prId: number, conflictId: number): Promise<Result<{ source: FileSide; target: FileSide; base: FileSide }>>;
  resolve(repo: RepoRef, prId: number, conflictId: number, r: Resolution): Promise<Result<void>>;
  conflictsUrl(repo: RepoRef, prId: number): Promise<Result<string>>;
  fileUrl(repo: RepoRef, path: string, branch: string): Promise<Result<string>>;
  openExternal(url: string): Promise<Result<void>>;
}

export const API_METHODS = [
  'session',
  'login',
  'logout',
  'projects',
  'repos',
  'branches',
  'pickFolder',
  'compare',
  'fileSides',
  'findPr',
  'createPr',
  'getPr',
  'waitPr',
  'completePr',
  'conflicts',
  'conflictSides',
  'resolve',
  'conflictsUrl',
  'fileUrl',
  'openExternal',
] as const satisfies readonly (keyof Api)[];
