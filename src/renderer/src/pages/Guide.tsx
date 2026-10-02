import type { ReactNode } from 'react';

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'g-start',
    title: 'Premiers pas',
    body: (
      <>
        <p>
          Connectez-vous avec l’URL de votre organisation (<code>https://dev.azure.com/mon-organisation</code>) et un{' '}
          <strong>Personal Access Token</strong> ayant les droits <strong>Code — Read &amp; Write</strong> et <strong>Work Items — Read</strong>.
        </p>
        <p>
          Le jeton est chiffré par le trousseau du système (Keychain sur macOS, DPAPI sur Windows). Il ne quitte jamais votre poste, sauf vers Azure
          DevOps.
        </p>
        <p>
          Choisissez ensuite un <strong>projet</strong> et un <strong>dépôt Azure</strong> dans la barre latérale.
        </p>
      </>
    ),
  },
  {
    id: 'g-orgs',
    title: 'Plusieurs organisations',
    body: (
      <ul>
        <li>
          <strong>Un jeton par organisation</strong> : ajoutez chaque organisation avec son propre PAT.
        </li>
        <li>
          <strong>Un jeton multi-organisation</strong> (PAT créé avec « All accessible organizations ») : cliquez sur{' '}
          <em>Découvrir mes organisations</em>, cochez celles à ajouter, puis validez. Pour une organisation de plus, choisissez{' '}
          <em>Jeton enregistré</em> afin de réutiliser ce jeton.
        </li>
        <li>
          Une fois connecté, changez d’organisation avec le menu <em>Organisation active</em> de la barre latérale. <em>Organisations…</em> ramène à
          la liste, où <em>Retirer</em> oublie une organisation. <em>Déconnexion</em> garde les jetons enregistrés.
        </li>
      </ul>
    ),
  },
  {
    id: 'g-compare',
    title: 'Comparer : Cible ← Source',
    body: (
      <>
        <p>
          La barre d’outils suit l’ordre de l’écran : la <strong>Cible</strong> à gauche, la <strong>Source</strong> à droite. Dans le diff, la cible
          s’affiche aussi à gauche et la source à droite. Le bouton ⇄ échange les deux côtés.
        </p>
        <p>Chaque côté est indépendant :</p>
        <ul>
          <li>
            <strong>Azure</strong> : une branche du dépôt choisi ;
          </li>
          <li>
            <strong>Local</strong> : une branche locale, une branche <code>origin/*</code>, ou la <em>copie de travail</em> d’un clone, avec les
            modifications non commitées.
          </li>
        </ul>
        <p>Vous pouvez donc comparer Azure ↔ Azure, Azure ↔ local ou local ↔ local, entre n’importe quelles branches.</p>
        <p>Le mode de comparaison change ce qui est montré :</p>
        <ul>
          <li>
            <strong>Comme une PR</strong> : seulement ce que la source apporte depuis l’ancêtre commun ;
          </li>
          <li>
            <strong>Tête contre tête</strong> : toutes les différences entre les deux états.
          </li>
        </ul>
        <p>
          Dans la liste des fichiers, filtrez par nom ou par extension. Cliquez sur un dossier pour le replier, ou utilisez <em>Tout replier</em>. Le
          diff s’affiche côte à côte ou en vue unifiée.
        </p>
      </>
    ),
  },
  {
    id: 'g-pr',
    title: 'Pull Request et conflits Azure',
    body: (
      <ul>
        <li>
          <em>Créer / ouvrir la PR</em> crée la PR Source → Cible. Si elle existe déjà, l’app la reprend. Un côté source local est d’abord poussé vers
          origin, après votre confirmation.
        </li>
        <li>
          L’onglet <strong>Pull Request</strong> affiche l’état du merge calculé par Azure. Vous pouvez lier des work items à la création, puis
          compléter la PR : suppression de la branche source et complétion des work items en option.
        </li>
        <li>
          L’onglet <strong>Conflits PR</strong> liste les conflits. Pour chacun, résolvez-le dans Azure, ou ici, dans l’éditeur à trois volets : cible
          à gauche, source à droite, résultat au centre.
        </li>
      </ul>
    ),
  },
  {
    id: 'g-merge',
    title: 'Merge local, dans toutes les directions',
    body: (
      <>
        <p>
          <em>Fusionner</em> fusionne la source dans la cible avec git, sur votre poste. Il faut un clone local (barre latérale → <em>Clone local</em>
          ).
        </p>
        <ol>
          <li>
            Le merge se fait dans un <strong>worktree temporaire</strong> : votre copie de travail n’est pas touchée, sauf si vous la choisissez comme
            cible et qu’elle est propre.
          </li>
          <li>
            S’il y a des conflits, l’onglet <strong>Merge local</strong> les liste. Pour un conflit de texte, utilisez l’éditeur. Pour un binaire
            ou un fichier supprimé d’un côté, choisissez <em>Garder source</em>, <em>Garder cible</em> ou <em>Supprimer le fichier</em>.
          </li>
          <li>
            Écrivez le message puis cliquez sur <em>Valider le commit</em>. Les hooks git ne sont pas exécutés.
          </li>
          <li>
            Si la cible est Azure, le commit est poussé, après confirmation. Si la poussée est refusée par une politique de branche, l’app propose de
            créer une PR à la place. Si la cible est locale, <em>Pousser vers origin</em> reste facultatif.
          </li>
        </ol>
        <p>Vous pouvez annuler à tout moment avant le commit : le worktree temporaire est supprimé.</p>
      </>
    ),
  },
  {
    id: 'g-folder',
    title: 'Dossier téléchargé (sans git)',
    body: (
      <p>
        Un dossier sans historique git (une archive ZIP téléchargée depuis Azure, par exemple) peut être choisi comme côté local. Il est comparé
        fichier par fichier à n’importe quelle branche Azure ou locale. Le merge, lui, demande un vrai clone.
      </p>
    ),
  },
  {
    id: 'g-theme',
    title: 'Thème et mises à jour',
    body: (
      <ul>
        <li>
          En bas de la barre latérale, choisissez <em>Système</em>, <em>Clair</em> ou <em>Sombre</em>. Le choix est retenu d’une session à l’autre.
        </li>
        <li>
          Les mises à jour sont détectées automatiquement. Sur Windows, elles s’installent au redémarrage. Sur macOS, un bandeau propose de
          télécharger la nouvelle version.
        </li>
      </ul>
    ),
  },
  {
    id: 'g-security',
    title: 'Sécurité',
    body: (
      <ul>
        <li>
          L’app ne lit que les dossiers que vous avez choisis vous-même. Elle refuse un dépôt dont la configuration exécute des commandes (filtres,
          pilotes de merge, hooks).
        </li>
        <li>
          Toute poussée (<code>git push</code>) vers Azure demande une confirmation explicite.
        </li>
      </ul>
    ),
  },
];

export function Guide() {
  return (
    <div className="guide">
      <nav className="guide-toc" aria-label="Sommaire du guide">
        <strong>Guide d’utilisation</strong>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="guide-body" tabIndex={0} aria-label="Contenu du guide">
        <h1>Guide d’utilisation</h1>
        {SECTIONS.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>
              <span className="guide-num">{String(i + 1).padStart(2, '0')}</span>
              {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </article>
    </div>
  );
}
