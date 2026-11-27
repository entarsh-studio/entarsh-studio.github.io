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

- **Catégories** : en haut des onglets Tâches, Créer, Listes et Cloud. Chaque catégorie (ex. *Helper*) a ses propres listes, tâches et son propre cloud. « Général » regroupe tout ce qui a été créé sans catégorie.
  Seul le créateur d'une catégorie peut la modifier ou la supprimer, et seulement quand elle est vide.
- **Cloud** : dossiers et fichiers façon Explorateur (arborescence, vue liste ou grandes icônes). Les gros fichiers (modèles Blender, textures, animations) sont découpés automatiquement en morceaux de 45 Mo à l'envoi et recollés au téléchargement, jusqu'à 2 Go par fichier. Glisse des fichiers dans la page, colle une capture (Ctrl+V) ou clique sur *Importer*.
  Tout le monde voit, ouvre et télécharge tout ; seul l'auteur d'un fichier ou d'un dossier peut le renommer, le déplacer ou le supprimer.
  L'offre gratuite de Supabase donne 1 Go de stockage au total (pièces jointes + cloud).

## Mise à jour : barre de stockage

Lance une fois `maj-stockage.sql` dans **SQL Editor** → **Run** pour que la barre « Stockage du site » affiche le chiffre exact (sinon Forge fait une estimation).
Si tu passes à l'offre Pro de Supabase, mets `storageGB: 100` dans `config.js`.

## Cloud sur Cloudflare R2 (10 Go gratuits)

Les comptes, tâches, pièces jointes et profils restent sur Supabase ; seuls les **fichiers du cloud** vont sur Cloudflare R2.
Les fichiers déjà envoyés sur Supabase restent lisibles ; les nouveaux partent sur R2 (morceaux de 90 Mo, jusqu'à 2 Go par fichier).

1. Crée un compte sur <https://dash.cloudflare.com> (gratuit).
2. Menu **R2 Object Storage** → active R2 (Cloudflare peut demander un moyen de paiement, rien n'est facturé tant qu'on reste sous 10 Go) → **Create bucket** → nom : `forge-cloud` → **Create**.
3. Menu **Workers & Pages** → **Create** → **Worker** (modèle « Hello World ») → nom : `forge-cloud` → **Deploy**.
4. **Edit code** → efface tout → colle le contenu de `cloudflare-worker.js` → **Deploy**.
5. Dans le Worker → **Settings** → **Bindings** → **Add** → **R2 bucket** : nom de la variable `BUCKET`, bucket `forge-cloud`.
6. **Settings** → **Variables and Secrets** → ajoute :
   | Nom | Type | Valeur |
   |---|---|---|
   | `SUPABASE_URL` | Text | `https://nipojbslomagcjpvosnk.supabase.co` |
   | `SUPABASE_KEY` | Text | ta clé `sb_publishable_…` |
   | `ALLOWED_ORIGIN` | Text | `https://entarsh-studio.github.io` |
   | `SIGN_SECRET` | **Secret** | une longue phrase au hasard (40 caractères ou plus), à ne donner à personne |
7. Ouvre l'adresse du Worker (`https://forge-cloud.<ton-sous-domaine>.workers.dev`) : tu dois voir `{"ok":true,"service":"forge-cloud"}`.
8. Mets cette adresse dans `config.js` → `r2Worker: "https://forge-cloud.<ton-sous-domaine>.workers.dev"`.

Sécurité : il faut être connecté à Forge pour envoyer, lister ou demander un lien ; chacun ne peut envoyer ou supprimer que ses propres fichiers ; les liens de lecture sont signés et expirent.

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
