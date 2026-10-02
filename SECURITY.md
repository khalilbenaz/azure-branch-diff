# Sécurité

## Signaler une vulnérabilité

Merci de **ne pas** ouvrir d'issue publique. Utilisez « Report a vulnerability » (GitHub Security Advisories) dans l'onglet Security du dépôt.

## Ce que l'app protège

- Le Personal Access Token est chiffré par le trousseau du système (Keychain, DPAPI) et reste dans le processus principal : l'interface ne le voit jamais, il est masqué dans toutes les erreurs.
- Electron : isolation de contexte, sandbox, pas de Node dans l'interface, CSP stricte, navigation, popups, webviews et permissions refusées, fuses (pas d'exécution comme Node, pas de `--inspect`, code chargé uniquement depuis l'asar).
- Fichiers locaux : seul le dossier choisi dans la boîte de dialogue est lisible ; les chemins qui en sortent (`..`, liens symboliques) sont refusés. La configuration git d'un dossier n'exécute aucune commande (filtres, fsmonitor et hooks neutralisés).
- Tous les arguments reçus de l'interface sont validés à l'exécution.

## Mises à jour

Les versions sont publiées comme **brouillons** par la CI, puis publiées manuellement après vérification. Chaque release contient `SHA256SUMS.txt`.

Les installeurs ne sont **pas signés** par un certificat éditeur (Authenticode / Apple Developer ID) :

- **Windows** : la mise à jour automatique vérifie l'empreinte SHA-512 annoncée par la release, mais pas l'identité de l'éditeur. La confiance repose sur le compte GitHub qui publie.
- **macOS** : pas d'installation automatique ; l'app signale la nouvelle version et ouvre la page de téléchargement.
