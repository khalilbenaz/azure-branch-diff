# Azure Branch Diff

[![CI](https://github.com/khalilbenaz/azure-branch-diff/actions/workflows/ci.yml/badge.svg)](https://github.com/khalilbenaz/azure-branch-diff/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release.noindex/khalilbenaz/azure-branch-diff)](https://github.com/khalilbenaz/azure-branch-diff/releases/latest)

Application de bureau (macOS et Windows) pour :

- **comparer** deux côtés, chacun **branche Azure** ou **référence d'un clone local** (branche, `origin/*`, copie de travail) : Azure ↔ Azure, Azure ↔ local, local ↔ local ; diff côte à côte (éditeur de VS Code) ;
- **créer ou reprendre une Pull Request** quand la cible est Azure, puis **régler les conflits** dans Azure ou dans l'app et **compléter la PR** ;
- **fusionner localement dans toutes les directions** : merge dans un worktree temporaire (votre copie de travail n'est pas touchée), conflits réglés dans l'app, commit, push.

**Site et téléchargements : https://khalilbenaz.github.io/azure-branch-diff/**

![Diff entre deux branches](site/img/02-diff.webp)

## Installation

| Système | Fichier |
|---|---|
| macOS Apple Silicon | [`Azure-Branch-Diff-mac-arm64.dmg`](https://github.com/khalilbenaz/azure-branch-diff/releases/latest/download/Azure-Branch-Diff-mac-arm64.dmg) |
| macOS Intel | [`Azure-Branch-Diff-mac-x64.dmg`](https://github.com/khalilbenaz/azure-branch-diff/releases/latest/download/Azure-Branch-Diff-mac-x64.dmg) |
| Windows 64 bits | [`Azure-Branch-Diff-Setup.exe`](https://github.com/khalilbenaz/azure-branch-diff/releases/latest/download/Azure-Branch-Diff-Setup.exe) |

Les installeurs ne sont **pas signés par un certificat éditeur** :

- **macOS** : glisser l'app dans Applications, puis au premier lancement **clic droit → Ouvrir**. Si macOS indique que l'app est endommagée : `xattr -dr com.apple.quarantine "/Applications/Azure Branch Diff.app"`.
- **Windows** : SmartScreen → **Informations complémentaires → Exécuter quand même**.

Pour la comparaison avec un dossier local, **git** doit être installé et dans le PATH (sinon le dossier est comparé fichier par fichier, sans `.gitignore` ni `core.autocrlf`).

### Mises à jour

L'app vérifie les nouvelles versions au démarrage puis toutes les 4 heures (Releases GitHub) :

- **Windows** : la mise à jour est téléchargée en arrière-plan, puis installée au redémarrage ;
- **macOS** : l'installation automatique exige une signature Apple Developer ID ; l'app affiche donc la nouvelle version et ouvre le téléchargement du `.dmg` en un clic.

## Connexion

Azure DevOps → avatar → **Personal access tokens** → **New Token**, avec les droits **Code — Read & Write** et **Work Items — Read**. Dans l'app : l'URL de l'organisation (`https://dev.azure.com/<organisation>`) et le jeton.

Le jeton est chiffré par le trousseau du système (Keychain macOS, DPAPI Windows), n'est jamais écrit en clair ni transmis à l'interface. **Déconnexion** l'efface.

## Utilisation

Dans la barre latérale : le **dépôt Azure** et/ou le **clone local**. Dans la barre d'outils, pour la **Source** et la **Cible** : `Azure` ou `Local`, puis la branche.

| Source → Cible | Comparer | PR Azure | Fusionner (merge local) |
|---|---|---|---|
| Azure → Azure | ✓ | ✓ | merge dans un worktree, puis push vers la cible |
| Local → Azure | ✓ (dernières versions) | ✓ (la branche locale est d'abord poussée) | merge dans un worktree sur `origin/cible`, puis push |
| Azure → Local | ✓ (dernières versions) | — | merge de `origin/source` dans la branche locale, push optionnel |
| Local → Local | ✓ | — | merge, commit, push optionnel |

Si Azure refuse le push (politique de branche), l'app propose **« Créer une PR à la place »** : le commit de merge part sur une branche `merge/…` et une PR est créée. Les hooks git ne sont pas exécutés et un dépôt dont la configuration locale exécuterait des commandes (filtres, pilotes de merge) est refusé.

1. **Comparer** : choisir la source et la cible, puis « Comparer ».
   - *Depuis l'ancêtre commun* (par défaut) : ce que la PR apporterait ; *Tête contre tête* : différence brute.
   - Filtre par nom ou extension ; « Vue unifiée » / « Côte à côte ».
   - Fichiers binaires, de plus de 2 Mo ou non UTF-8 : signalés, avec un lien vers Azure.
2. **Pull Request** : la PR active est proposée si elle existe ; sinon titre, description, work items. L'app attend le calcul du merge, puis propose de **compléter** (merge commit, squash, rebase, semi-linéaire).
3. **Conflits** : **Régler dans Azure** ou **Régler dans l'app** (fichiers texte modifiés des deux côtés) : source et cible en lecture, résultat modifiable, *Garder source / cible / les deux*.

## Développement

```bash
npm install
npm run dev              # mode développement
AZ_FAKE=1 npm run dev    # démo : Azure simulé en mémoire (n'importe quel jeton)
npm test                 # tests unitaires, sécurité, performance (Vitest)
npm run typecheck
npm run e2e              # build + E2E : parcours, sécurité Electron, accessibilité, performance (Playwright)
npm run dist:mac         # installeurs macOS (sur macOS)
npm run dist:win         # installeur Windows
```

### Publier une version

```bash
npm version minor                               # met à jour package.json et crée le tag vX.Y.Z
git push --follow-tags                          # la CI vérifie le tag, teste et construit les installeurs
gh release edit vX.Y.Z --draft=false            # après vérification du brouillon : publication (mises à jour)
```

La CI publie la release en **brouillon** (invisible pour les mises à jour automatiques) avec `SHA256SUMS.txt`. Voir [SECURITY.md](SECURITY.md).

### Architecture

- `src/main` : processus principal Electron, seul à détenir le jeton.
  - `azure/` : API Azure DevOps (navigation, diff, PR, conflits) et `fake.ts` (Azure en mémoire) ;
  - `local/`, `compare/` : fichiers locaux et modèle de diff commun ;
  - `ipc.ts` : API exposée à l'interface ; `auth.ts` : jeton chiffré ; `errors.ts` : erreurs normalisées (jeton masqué) ; `updater.ts` : mises à jour.
- `src/preload` : pont `window.api` / `window.updates` (isolation de contexte, sandbox).
- `src/renderer` : interface React + Monaco.
- `site/` : page GitHub Pages.

## Licence

MIT. Projet indépendant, non affilié à Microsoft.
