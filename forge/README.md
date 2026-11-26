# Forge — les tâches de l'équipe

Forge est un site pour répartir les tâches d'un jeu vidéo entre plusieurs personnes : listes, tâches avec icône, difficulté et délai, cases à cocher, pièces jointes (captures d'écran comprises), comptes avec pseudo et icône, et un fond d'égaliseur animé.

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

## 3. Relier Supabase à l'adresse du site

Dans Supabase : **Authentication** → **URL Configuration** :
- **Site URL** : `https://entarsh-studio.github.io/forge/`
- **Redirect URLs** : ajoute `https://entarsh-studio.github.io/forge/`

Sinon, le lien de confirmation reçu par e-mail renverra vers une mauvaise page.

## 4. Inviter les collègues

Envoie-leur simplement l'adresse du site. Chacun clique sur **Créer un compte** (pseudo, e-mail, mot de passe), confirme son e-mail, puis se connecte.

### Fermer les inscriptions (recommandé)

Tant que les inscriptions sont ouvertes, **n'importe qui qui trouve l'adresse peut créer un compte et voir les tâches**. Une fois toute l'équipe inscrite :
**Authentication** → **Sign In / Providers** → désactive **Allow new users to sign up**.
Pour ajouter quelqu'un plus tard : rouvre-les quelques minutes, ou utilise **Authentication** → **Users** → **Invite user**.

---

## Bon à savoir

- **Qui peut faire quoi**
  - Tout le monde (connecté) voit toutes les listes et toutes les tâches.
  - Seul le créateur peut supprimer sa liste ou sa tâche, et ajouter ou retirer ses pièces jointes.
  - Seule la personne à qui la tâche est attribuée peut la cocher (ou son créateur si elle est pour « Tout le monde »).
  - Ces règles sont vérifiées par la base de données, pas seulement par la page.
- **Pièces jointes** : tous types de fichiers (images, vidéos, PDF, .zip, .blend, .fbx…), 50 Mo maximum par fichier. Colle une capture avec **Ctrl+V** dans l'onglet *Créer* ou dans la fiche d'une tâche.
- **Musique** : le bouton *Musique* lit un fichier audio de ton appareil et les barres du fond suivent le son. La musique n'est envoyée à personne.
- **E-mails de confirmation** : le service d'e-mail intégré à Supabase envoie peu de messages par heure. Si l'équipe s'inscrit en même temps et que des e-mails n'arrivent pas, attends un peu. Tu peux aussi désactiver la confirmation : **Authentication** → **Sign In / Providers** → **Email** → *Confirm email*.
- **Projet en pause** : un projet Supabase gratuit sans aucune visite pendant 7 jours est mis en pause. Il suffit de le relancer depuis le tableau de bord Supabase.
