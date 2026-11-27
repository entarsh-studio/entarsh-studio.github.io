# Forge — les tâches de l'équipe

Forge est un site pour répartir les tâches d'un jeu vidéo entre plusieurs personnes : listes, tâches avec icône, difficulté et délai, cases à cocher, pièces jointes (captures d'écran comprises), comptes avec pseudo et icône (sans adresse e-mail), et un fond d'égaliseur animé.

- **Hébergement du site** : GitHub Pages (gratuit)
- **Comptes, données et fichiers** : Supabase (gratuit jusqu'à 500 Mo de base et 1 Go de fichiers)

---

## 1. Créer le projet Supabase (environ 5 minutes)

1. Va sur <https://supabase.com>, crée un compte puis clique sur **New project**.
   Choisis un nom (ex. `forge`), un mot de passe de base de données (garde-le pour toi) et la région **West EU (Paris)** ou une autre proche.
2. Quand le projet est prêt, ouvre **SQL Editor** → **New query**.
   Colle **tout** le contenu de `supabase.sql`, puis clique sur **Run**. Tu dois voir « Success ».
   ⚠️ Ne le lance qu'une seule fois.
3. Ouvre **Project Settings** → **API** et note :
   - **Project URL** (ex. `https://abcdxyz.supabase.co`)
   - la clé **anon public**
4. Ouvre le fichier `forge/config.js` et remplace les deux valeurs par celles que tu viens de noter.
   (La clé « anon public » peut être visible dans le code : la sécurité est gérée par `supabase.sql`.)

## 2. Le site sur GitHub Pages

Forge est rangé dans le dossier `forge/` du dépôt `entarsh-studio/entarsh-studio.github.io`, dont GitHub Pages est déjà actif.
Adresse du site : **https://entarsh-studio.github.io/forge/**

## 3. Désactiver la confirmation par e-mail (obligatoire)

Forge n'utilise pas d'adresse e-mail : on s'inscrit avec un pseudo et un mot de passe.
Dans Supabase : **Authentication** → **Sign In / Providers** → **Email** → désactive **Confirm email** → **Save**.
(Laisse le fournisseur *Email* lui-même activé : Forge s'en sert en interne.)

## 4. Inviter les collègues

Envoie-leur simplement l'adresse du site. Chacun clique sur **Créer un compte** (pseudo + mot de passe) et il est connecté directement.
Le pseudo choisi à l'inscription sert d'**identifiant de connexion** : il ne change pas, même si on modifie ensuite le pseudo affiché dans *Mon compte*.
Il n'y a pas de récupération de mot de passe par e-mail : en cas d'oubli, supprime le compte dans **Authentication** → **Users** et la personne en recrée un.

### Fermer les inscriptions (recommandé)

Tant que les inscriptions sont ouvertes, **n'importe qui qui trouve l'adresse peut créer un compte et voir les tâches**. Une fois toute l'équipe inscrite :
**Authentication** → **Sign In / Providers** → désactive **Allow new users to sign up**.
Pour ajouter quelqu'un plus tard : rouvre-les quelques minutes, ou utilise **Authentication** → **Users** → **Invite user**.

## Mise à jour : catégories et cloud

Si ton projet Supabase existait déjà avant cette mise à jour, lance **une seule fois** le fichier `maj-categories-cloud.sql` dans **SQL Editor** → **New query** → **Run**.
(Pour un projet tout neuf, `supabase.sql` contient déjà tout.)
Si tu l'avais déjà lancé avant l'ajout des images de catégorie, lance aussi :
`alter table public.categories add column if not exists image text not null default '';`

- **Catégories** (devenues « Projets ») : chaque catégorie (ex. *Helper*) a ses propres listes, tâches et son propre cloud. « Général » regroupe tout ce qui a été créé sans catégorie.
  Seul le créateur d'une catégorie peut la modifier ou la supprimer, et seulement quand elle est vide.
- **Cloud** : dossiers et fichiers façon Explorateur (arborescence, vue liste ou grandes icônes). Les gros fichiers (modèles Blender, textures, animations) sont découpés automatiquement en morceaux de 45 Mo à l'envoi et recollés au téléchargement, jusqu'à 2 Go par fichier. Glisse des fichiers dans la page, colle une capture (Ctrl+V) ou clique sur *Importer*.
  Tout le monde voit, ouvre et télécharge tout ; seul l'auteur d'un fichier ou d'un dossier peut le renommer, le déplacer ou le supprimer.
  L'offre gratuite de Supabase donne 1 Go de stockage au total (pièces jointes + cloud).

## Mise à jour : barre de stockage

Lance une fois `maj-stockage.sql` dans **SQL Editor** → **Run** pour que la barre « Stockage du site » affiche le chiffre exact (sinon Forge fait une estimation).
Si tu passes à l'offre Pro de Supabase, mets `storageGB: 100` dans `config.js`.

## Mise à jour : travail d'équipe (Planning, Discussion, Bugs, Idées, Wiki, Activité)

Lance **une seule fois** `maj-collab.sql` dans **SQL Editor** → **New query** → **Run** (si tu ne l'as pas encore fait, lance aussi `maj-taches.sql` avant).
Tant que ce script n'est pas lancé, les nouveaux onglets affichent « Mise à jour de la base nécessaire » ; le reste du site marche normalement.

- **Projets** (anciennes catégories) : dans la colonne de gauche, avec une jauge d'avancement. Sur téléphone, le bouton du projet est en haut.
- **Tâches** : un seul onglet. Filtres *À faire*, *Pour moi* (tous projets) et *Faites*, listes en pastilles. *Nouvelle tâche* ouvre une fenêtre avec icône et couleur au choix, difficulté réglée sur une rampe, délai et échéance. Chaque tâche a des commentaires.
- **Planning** : calendrier du mois avec les événements (jalon, réunion, sortie) et les tâches qui ont une échéance.
- **Discussion** : un fil de messages par projet.
- **Bugs** : tableau Nouveau → En cours → Corrigé → Vérifié, avec gravité et captures. Tout le monde peut faire avancer un bug ; seul son auteur peut le supprimer.
- **Idées** : propositions avec vote pour ou contre.
- **Wiki** : pages modifiables par toute l'équipe ; seul le créateur d'une page peut la supprimer.
- **Activité** : journal automatique de ce que fait l'équipe.

## Mise à jour : fichiers dans les commentaires (comptes rendus)

Lance `maj-commentaires.sql` dans **SQL Editor** → **New query** → **Run** (après `maj-collab.sql`). On peut ensuite joindre des fichiers à un commentaire de tâche avec le trombone, en les glissant sur le champ, ou en collant une capture (Ctrl+V).

## Cloud de 10 Go gratuits, sans carte bancaire (Backblaze B2 + Worker Cloudflare)

Les comptes, tâches, pièces jointes et profils restent sur Supabase ; seuls les **fichiers du cloud** vont chez Backblaze.
Un petit programme Cloudflare (le « Worker ») vérifie qu'on est connecté à Forge avant chaque envoi.
Les fichiers déjà envoyés sur Supabase restent lisibles ; les nouveaux partent sur Backblaze (morceaux de 90 Mo, jusqu'à 2 Go par fichier).

### A. Backblaze B2 (le stockage)
1. Crée un compte sur <https://www.backblaze.com/sign-up/cloud-storage> (pas de carte). Choisis la région **EU Central** si on te la propose.
2. **B2 Cloud Storage** → **Buckets** → **Create a Bucket** : un nom unique (ex. `forge-cloud-entarsh`), **Private** → **Create**.
3. Note l'**Endpoint** affiché sur le bucket (ex. `s3.eu-central-003.backblazeb2.com`) : la partie `eu-central-003` est la région.
4. **Application Keys** → **Add a New Application Key** : nom `forge`, accès au bucket `forge-cloud-entarsh`, **Read and Write** → **Create**.
   Note le **keyID** et l'**applicationKey** (affichée une seule fois).

### B. Le Worker Cloudflare (le gardien)
1. Sur <https://dash.cloudflare.com> : **Compute** → **Workers & Pages** → **Create** → **Worker** (« Hello World ») → nom `forge-cloud` → **Deploy**.
2. **Edit code** → efface tout → colle `cloudflare-worker.js` → **Deploy**.
3. **Settings** → **Variables and Secrets** → ajoute :
   | Nom | Type | Valeur |
   |---|---|---|
   | `SUPABASE_URL` | Text | `https://nipojbslomagcjpvosnk.supabase.co` |
   | `SUPABASE_KEY` | Text | ta clé `sb_publishable_…` |
   | `ALLOWED_ORIGIN` | Text | `https://entarsh-studio.github.io` |
   | `SIGN_SECRET` | **Secret** | une longue phrase au hasard, à garder pour toi |
   | `B2_ENDPOINT` | Text | `https://` + l'Endpoint du bucket |
   | `B2_REGION` | Text | la région (ex. `eu-central-003`) |
   | `B2_BUCKET` | Text | le nom du bucket |
   | `B2_KEY_ID` | Text | le keyID |
   | `B2_APP_KEY` | **Secret** | l'applicationKey |
4. Ouvre l'adresse du Worker : tu dois voir `{"ok":true,"service":"forge-cloud","storage":"Backblaze B2"}`.
5. Mets cette adresse dans `config.js` → `r2Worker: "https://forge-cloud.<ton-sous-domaine>.workers.dev"`.

Limites gratuites à connaître : 10 Go chez Backblaze ; environ 2 500 lectures de fichiers par jour (téléchargements, miniatures) avant que Backblaze bloque jusqu'au lendemain ; 100 000 requêtes par jour pour le Worker. Sans carte enregistrée, rien ne peut être facturé : au pire, ça s'arrête jusqu'au lendemain.

---

## Bon à savoir

- **Qui peut faire quoi**
  - Tout le monde (connecté) voit toutes les listes et toutes les tâches.
  - Seul le créateur peut supprimer sa liste ou sa tâche, et ajouter ou retirer ses pièces jointes.
  - Seule la personne à qui la tâche est attribuée peut la cocher (ou son créateur si elle est pour « Tout le monde »).
  - Ces règles sont vérifiées par la base de données, pas seulement par la page.
- **Pièces jointes** : tous types de fichiers (images, vidéos, PDF, .zip, .blend, .fbx…), 50 Mo maximum par fichier. Colle une capture avec **Ctrl+V** dans l'onglet *Créer* ou dans la fiche d'une tâche.
- **Musique** : le bouton *Musique* lit un fichier audio de ton appareil et les barres du fond suivent le son. La musique n'est envoyée à personne.
- **Projet en pause** : un projet Supabase gratuit sans aucune visite pendant 7 jours est mis en pause. Il suffit de le relancer depuis le tableau de bord Supabase.
