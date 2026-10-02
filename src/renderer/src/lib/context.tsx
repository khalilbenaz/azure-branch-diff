import { createContext, useContext } from 'react';
import type { RepoRef } from '../../../shared/api';
import type { ApiError, PrSummary } from '../../../shared/types';

export type Tab = 'compare' | 'pr' | 'conflicts';

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
