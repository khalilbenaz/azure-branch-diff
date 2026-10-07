import type {
  AzureSource,
  ChangeEntry,
  CompleteOptions,
  ConflictEntry,
  FileSide,
  NamedRef,
  PrSummary,
  Resolution,
  AddOrgsInput,
  LocalRepoInfo,
  OrgsState,
  MergeResolution,
  MergeStartInput,
  MergeState,
  Result,
  Side,
} from './types';

export interface LocalInfo {
  branch: string;
  commit: string;
  subject: string;
}

export interface CompareResult {
  /** azure : deux branches Azure ; local : deux références du même clone ; mixed : Azure et local (têtes). */
  kind?: 'azure' | 'local' | 'mixed';
  changes: ChangeEntry[];
  /** Point de départ de la liste (ancêtre commun en mode PR, sinon tête de la cible). */
  baseCommit?: string;
  /** Commit affiché à droite (source), ou WORKTREE pour une copie de travail. */
  sourceCommit?: string;
  /** Tête de la cible : commit affiché à gauche, quel que soit le mode. */
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
  /** Déconnexion : retour à la liste des organisations, rien n'est oublié. */
  logout(): Promise<Result<void>>;
  orgs(): Promise<Result<OrgsState>>;
  /** Bascule vers une organisation enregistrée (refusée pendant un merge local en cours). */
  connectOrg(orgUrl: string): Promise<Result<{ orgUrl: string }>>;
  addOrgs(input: AddOrgsInput): Promise<Result<OrgsState>>;
  /** Organisations accessibles avec un jeton (nouveau PAT ou jeton enregistré). */
  discoverOrgs(input: { pat: string } | { tokenId: string }): Promise<Result<string[]>>;
  /** Retire une organisation (son jeton est oublié s'il ne sert plus). */
  removeOrg(orgUrl: string): Promise<Result<OrgsState>>;
  projects(): Promise<Result<NamedRef[]>>;
  repos(project: string): Promise<Result<NamedRef[]>>;
  branches(project: string, repoId: string): Promise<Result<string[]>>;
  pickFolder(): Promise<Result<string | null>>;
  /** Approuve la racine git du dossier choisi et renvoie ses branches. */
  localRepo(dir: string): Promise<Result<LocalRepoInfo>>;
  compare(source: Side, target: Side, mode: 'mergeBase' | 'tips'): Promise<Result<CompareResult>>;
  fileSides(source: Side, target: Side, entry: ChangeEntry, cmp: CompareResult): Promise<Result<{ left: FileSide; right: FileSide }>>;
  /** Parmi `entries` (100 au plus), les chemins dont les deux versions ne diffèrent que par des espaces. */
  whitespaceOnly(source: Side, target: Side, entries: ChangeEntry[], cmp: CompareResult): Promise<Result<string[]>>;
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

  // Merge local (un seul à la fois).
  mergeStart(input: MergeStartInput): Promise<Result<MergeState>>;
  mergeState(): Promise<Result<MergeState | null>>;
  /** merged : le fichier fusionné par git (marqueurs de conflit, parties sans conflit déjà fusionnées). */
  mergeConflictSides(path: string): Promise<Result<{ base: FileSide; target: FileSide; source: FileSide; merged: FileSide }>>;
  mergeResolve(path: string, r: MergeResolution): Promise<Result<MergeState>>;
  mergeCommit(message: string): Promise<Result<MergeState>>;
  mergePush(): Promise<Result<MergeState>>;
  /** Quand la cible refuse le push : pousse le merge sur une branche dédiée et crée une PR vers la cible. */
  mergeFallbackPr(repo: RepoRef, title: string): Promise<Result<PrSummary>>;
  mergeAbort(): Promise<Result<null>>;
  /** Termine une session (après commit / push) et supprime son worktree. */
  mergeClose(): Promise<Result<null>>;
  /** Pousse une branche locale vers origin (PR depuis une branche locale). */
  pushBranch(root: string, branch: string, repo: RepoRef): Promise<Result<void>>;
  /** Vérifie que l'origin du clone est bien le dépôt Azure choisi. */
  originCheck(root: string, repo: RepoRef): Promise<Result<{ matches: boolean; originUrl: string | null }>>;
}

export const API_METHODS = [
  'session',
  'login',
  'logout',
  'orgs',
  'connectOrg',
  'addOrgs',
  'discoverOrgs',
  'removeOrg',
  'projects',
  'repos',
  'branches',
  'pickFolder',
  'localRepo',
  'compare',
  'fileSides',
  'whitespaceOnly',
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
  'mergeStart',
  'mergeState',
  'mergeConflictSides',
  'mergeResolve',
  'mergeCommit',
  'mergePush',
  'mergeFallbackPr',
  'mergeAbort',
  'mergeClose',
  'pushBranch',
  'originCheck',
] as const satisfies readonly (keyof Api)[];
