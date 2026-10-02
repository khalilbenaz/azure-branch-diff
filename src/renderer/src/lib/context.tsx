import { createContext, useContext } from 'react';
import type { RepoRef } from '../../../shared/api';
import type { ApiError, LocalRepoInfo, MergeState, PrSummary } from '../../../shared/types';

export type Tab = 'compare' | 'pr' | 'conflicts' | 'merge';

export interface Selection {
  repo: RepoRef;
  source: string;
  target: string;
  /** Change à chaque comparaison : force l'onglet PR à se réinitialiser même pour les mêmes branches. */
  nonce: number;
}

export interface AppState {
  orgUrl: string;
  /** Dépôt choisi dans la barre latérale. */
  repo: RepoRef | null;
  setRepo(r: RepoRef | null): void;
  /** Clone local choisi dans la barre latérale (partagé par les côtés locaux et le merge). */
  clone: LocalRepoInfo | null;
  /** Ouvre la boîte de dialogue de choix du clone ; renvoie le clone choisi. */
  pickClone(): Promise<LocalRepoInfo | null>;
  /** Relit les branches du clone (après un merge, un push…). */
  refreshClone(): Promise<void>;
  /** Merge local en cours (onglet Merge). */
  merge: MergeState | null;
  setMerge(m: MergeState | null): void;
  selection: Selection | null;
  setSelection(s: Selection | null): void;
  pr: PrSummary | null;
  setPr(pr: PrSummary | null): void;
  /** Nombre de conflits non résolus de la PR courante (badge de navigation). */
  setOpenConflicts(n: number | null): void;
  goTo(tab: Tab): void;
  /** Erreur d'authentification : retour à l'écran de connexion. Renvoie true si l'erreur a été prise en charge. */
  handleAuth(e: ApiError): boolean;
}

export const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error('AppCtx manquant');
  return v;
}
