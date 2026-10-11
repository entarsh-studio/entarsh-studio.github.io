/* Entarsh Catalogue : catalogue, actualités, mises à jour + gestion (dépôt via l'API GitHub). */
(() => {
  const COULEURS = ['#8b00ff', '#ffe000', '#ff0000', '#e600ff', '#40ff00', '#00a3ff', '#00ff95', '#ff0080', '#ff8a00'];
  const TYPES_DE_BASE = ['Jeu vidéo', 'Éditeur', 'Logiciel', 'Outil'];
  const LIMITE_OCTETS = 95 * 1024 * 1024; // GitHub refuse les fichiers de plus de 100 Mo
  try { localStorage.removeItem('entarsh-catalogue-coffre'); } catch {} // ancien coffre local (v0.3–0.5), remplacé par les comptes
  try { localStorage.removeItem('entarsh-catalogue-github'); } catch {} // ancien stockage en clair (v0.1–0.2)
  const VUES = ['catalogue', 'actualites', 'mises-a-jour'];

  const $ = id => document.getElementById(id);
  let catalogue = { version: 1, types: [], elements: [] };
  let site = { version: '', beta: true, actualites: [], mises_a_jour: [] };
  const CLE_AFFICHAGE = 'entarsh-catalogue-affichage';
  const criteres = { types: new Set(), nom: '', desc: '', auteur: '', periode: 0, tri: 'ajout', ordre: 'desc', parPage: 24, page: 1, vue: 'grille', filtres: true };
  try { Object.assign(criteres, JSON.parse(localStorage.getItem(CLE_AFFICHAGE)) || {}); } catch {}
  const memoriserAffichage = () => {
    try { localStorage.setItem(CLE_AFFICHAGE, JSON.stringify({ parPage: criteres.parPage, vue: criteres.vue, filtres: criteres.filtres })); } catch {}
  };
  const AUTEUR_DEFAUT = 'Entarsh Studio';

  // ---------- Compteurs (Supabase, projet de Helper) ----------
  const SB_URL = 'https://hltchrwrefrrfhtzimkn.supabase.co';
  const SB_CLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsdGNocndyZWZycmZodHppbWtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMTUzMjMsImV4cCI6MjEwNjc5MTMyM30.aXJkkgIz89wsDw_7HrxesbvopPrkFleVfMVLB7X9GkM';
  const sb = window.supabase.createClient(SB_URL, SB_CLE, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'entarsh-catalogue.session' } });
  const DOMAINE_LOGIN = 'helper-entarsh.fr';
  let stats = {};            // { id: { telechargements, likes, vues } }
  let statsDispo = false;    // false tant que les tables n'existent pas dans Supabase
  let compte = null;         // { pseudo, rang, likes: [] } quand connecté
  let mesLikes = new Set();
  const lireLocal = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; } };
  const ecrireLocal = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch {} };
  try { localStorage.removeItem('entarsh-catalogue-visiteur'); localStorage.removeItem('entarsh-catalogue-likes'); } catch {}
  const mesTelechargements = lireLocal('entarsh-catalogue-telechargements', {});
  const stat = (id, cle) => stats[id]?.[cle] ?? 0;
  const estGerant = () => compte?.rang === 'gerant';

  async function chargerStats() {
    try {
      let { data, error } = await sb.from('catalogue_stats').select('id,telechargements,likes,vues,commentaires');
      if (error) ({ data, error } = await sb.from('catalogue_stats').select('id,telechargements,likes,vues'));
      if (error) return;
      stats = Object.fromEntries(data.map(x => [x.id, x]));
      statsDispo = true;
    } catch {}
  }
  let jetonAcces = null;     // jeton de session du compte connecté (pour les compteurs)
  function rpc(nom, corps) {
    return fetch(`${SB_URL}/rest/v1/rpc/${nom}`, { method: 'POST', keepalive: true,
      headers: { apikey: SB_CLE, Authorization: `Bearer ${jetonAcces || SB_CLE}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
  }
  function compterTelechargement(id) {
    mesTelechargements[id] = new Date().toISOString(); ecrireLocal('entarsh-catalogue-telechargements', mesTelechargements);
    if (compte) { (compte.telechargements ||= {})[id] = mesTelechargements[id]; compte.nb_telechargements = (compte.nb_telechargements || 0) + 1; }
    if (!statsDispo) return;
    (stats[id] ||= { id, telechargements: 0, likes: 0, vues: 0 }).telechargements++;
    rpc('catalogue_compter', { p_id: id, p_type: 'telechargement' }).catch(() => {});
  }
  function compterVue(id) {
    if (!statsDispo) return;
    let vus; try { vus = JSON.parse(sessionStorage.getItem('entarsh-catalogue-vus')) || []; } catch { vus = []; }
    if (vus.includes(id)) return;
    vus.push(id); try { sessionStorage.setItem('entarsh-catalogue-vus', JSON.stringify(vus)); } catch {}
    (stats[id] ||= { id, telechargements: 0, likes: 0, vues: 0 }).vues++;
    rpc('catalogue_compter', { p_id: id, p_type: 'vue' }).catch(() => {});
  }
  async function basculerLike(id) {
    if (!compte) { ouvrirCompte("Connecte-toi ou crée un compte pour mettre un J'aime."); return false; }
    const aime = !mesLikes.has(id);
    aime ? mesLikes.add(id) : mesLikes.delete(id);
    (stats[id] ||= { id, telechargements: 0, likes: 0, vues: 0 }).likes = Math.max(0, stat(id, 'likes') + (aime ? 1 : -1));
    const { data, error } = await sb.rpc('catalogue_aimer', { p_id: id, p_aime: aime });
    if (error) {                                   // annuler en cas d'échec
      aime ? mesLikes.delete(id) : mesLikes.add(id);
      stats[id].likes = Math.max(0, stat(id, 'likes') + (aime ? -1 : 1));
      if (/non_connecte|JWT/i.test(error.message)) { await deconnecter(); ouvrirCompte('Ta session a expiré, reconnecte-toi.'); }
      return false;
    }
    stats[id].likes = data;
    return true;
  }

  // ---------- Comptes ----------
  async function chargerCompte() {
    const { data: { session: s } } = await sb.auth.getSession();
    jetonAcces = s?.access_token || null;
    if (!s) { compte = null; mesLikes = new Set(); majBoutonCompte(); return; }
    const { data, error } = await sb.rpc('catalogue_moi');
    compte = !error && data ? data : null;
    mesLikes = new Set(compte?.likes || []);
    if (compte?.telechargements) Object.assign(mesTelechargements, compte.telechargements);
    if (!compte && !error) await sb.auth.signOut();   // session sans profil catalogue
    majBoutonCompte();
  }
  async function deconnecter() {
    await sb.auth.signOut().catch(() => {});
    compte = null; mesLikes = new Set(); session = null; jetonAcces = null;
    majBoutonCompte(); afficher(); rafraichirFiche(true);
  }
  function initiale(p) { return (p || '?').charAt(0).toUpperCase(); }
  const nomAffiche = c => c ? (c.rang === 'gerant' ? 'Entarsh Studio' : c.pseudo) : '';
  // Remplit un avatar : image du profil, icône du studio pour le gérant, sinon initiale
  function remplirAvatar(zone, { avatar, nom, gerant }) {
    zone.classList.toggle('studio', !!gerant);
    zone.replaceChildren(gerant ? el('img', { src: 'icone-192.png', alt: '' }) : avatar ? el('img', { src: avatar, alt: '' }) : initiale(nom));
  }
  function majBoutonCompte() {
    const b = $('bouton-compte');
    b.classList.toggle('connecte', !!compte);
    if (compte) remplirAvatar(b.querySelector('.avatar-compte'), { avatar: compte.avatar, nom: compte.pseudo, gerant: estGerant() });
    b.querySelector('.nom-compte').textContent = compte ? nomAffiche(compte) : 'Se connecter';
    $('ouvrir-gestion').hidden = !estGerant();
    $('ajouter-element').hidden = !estGerant();
  }
  function rafraichirFiche(complet) {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h.startsWith('element/')) return;
    const e = catalogue.elements.find(x => x.id === h.slice(8));
    if (!e) return;
    if (complet) afficherFiche(e.id, true); else majStatsFiche(e);
  }

  let modeCompte = 'connexion';
  function modeFormulaire(m) {
    modeCompte = m;
    document.querySelectorAll('.compte-bascule .p-onglet').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    $('cp-bloc-mdp2').hidden = m !== 'creation';
    $('cp-aide-pseudo').hidden = m !== 'creation';
    $('cp-mdp').autocomplete = m === 'creation' ? 'new-password' : 'current-password';
    $('cp-valider').textContent = m === 'creation' ? 'Créer mon compte' : 'Se connecter';
    statut('cp-statut', '');
  }
  document.querySelectorAll('.compte-bascule .p-onglet').forEach(b => b.addEventListener('click', () => modeFormulaire(b.dataset.mode)));

  function ouvrirCompte(raison) {
    const d = $('fenetre-compte');
    $('compte-hors-ligne').hidden = !!compte;
    $('compte-en-ligne').hidden = !compte;
    $('compte-titre').textContent = compte ? 'Mon compte' : 'Compte Entarsh Catalogue';
    $('compte-raison').hidden = !raison; $('compte-raison').textContent = raison || '';
    if (compte) afficherProfil();
    else {
      modeFormulaire(modeCompte);
      $('cp-mdp').value = ''; $('cp-mdp2').value = '';
    }
    if (!d.open) d.showModal();
    if (!compte) setTimeout(() => $('cp-pseudo').focus(), 30);
  }
  $('bouton-compte').addEventListener('click', () => ouvrirCompte());
  $('fermer-compte').addEventListener('click', () => $('fenetre-compte').close());
  $('fenetre-compte').addEventListener('click', e => { if (e.target === $('fenetre-compte')) $('fenetre-compte').close(); });
  $('cp-deconnexion').addEventListener('click', async () => { await deconnecter(); $('fenetre-compte').close(); });

  // ---------- Profil ----------
  const nombre = n => Number(n || 0).toLocaleString('fr-FR');
  function afficherProfil() {
    const g = estGerant();
    $('cp-nom').textContent = nomAffiche(compte);
    $('cp-rang').textContent = g ? `Gérant · connecté en tant que ${compte.pseudo}` : 'Membre';
    $('cp-depuis').textContent = compte.cree_le ? `Membre depuis le ${dateLisible(compte.cree_le)}` : '';
    remplirAvatar($('pf-avatar'), { avatar: compte.avatar, nom: compte.pseudo, gerant: g });
    $('pf-image').closest('label').hidden = g;
    $('pf-retirer-image').hidden = g || !compte.avatar;
    const carte = (ic, nom, val) => el('div', { class: 'profil-stat' }, icone(ic), el('strong', {}, val), el('span', {}, nom));
    $('pf-stats').replaceChildren(
      carte('pouce', "J'aime donnés", nombre(mesLikes.size)),
      carte('telecharger', 'Téléchargements', nombre(compte.nb_telechargements)),
      carte('bulle', 'Commentaires', nombre(compte.nb_commentaires)));
    $('pf-recus').hidden = !(g && compte.recus);
    if (g && compte.recus) $('pf-recus').replaceChildren(el('h3', {}, 'Sur tout le catalogue'),
      el('div', { class: 'profil-stats' },
        carte('pouce', "J'aime reçus", nombre(compte.recus.likes)),
        carte('telecharger', 'Téléchargements', nombre(compte.recus.telechargements)),
        carte('oeil', 'Vues', nombre(compte.recus.vues)),
        carte('bulle', 'Commentaires', nombre(compte.recus.commentaires))));
    $('pf-pseudo').value = compte.pseudo;
    $('pf-gerant-note').hidden = !g;
    statut('pf-statut', ''); statut('mdp-statut', '');
    $('pf-mdp').value = ''; $('pf-mdp2').value = '';
  }
  const ERREURS_PROFIL = { pseudo_pris: 'Ce pseudo est déjà pris.', pseudo_invalide: 'Pseudo invalide : 3 à 20 caractères (lettres sans accent, chiffres, - ou _).', image_invalide: 'Image trop lourde ou invalide.' };
  async function enregistrerProfil(champs, idStatut) {
    const { data, error } = await sb.rpc('catalogue_modifier_profil', { p_pseudo: null, p_avatar: null, p_changer_avatar: false, ...champs });
    if (error) {
      const code = (error.message.match(/pseudo_\w+|image_invalide/) || [])[0];
      statut(idStatut, ERREURS_PROFIL[code] || (/function|schema/i.test(error.message) ? "Le profil n'est pas encore activé sur le serveur." : 'Enregistrement impossible.'), 'erreur');
      return false;
    }
    Object.assign(compte, data); majBoutonCompte(); afficherProfil();
    return true;
  }
  $('form-profil').addEventListener('submit', async ev => {
    ev.preventDefault();
    const pseudo = $('pf-pseudo').value.trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(pseudo)) return statut('pf-statut', ERREURS_PROFIL.pseudo_invalide, 'erreur');
    if (pseudo === compte.pseudo) return statut('pf-statut', 'Rien à changer.', '');
    if (await enregistrerProfil({ p_pseudo: pseudo }, 'pf-statut')) statut('pf-statut', 'Profil enregistré. Utilise ce pseudo pour te connecter.', 'ok');
  });
  // Image : recadrée en carré 160 px, compressée (quelques Ko)
  function imageVersAvatar(fichier) {
    return new Promise((ok, ko) => {
      const img = new Image(), url = URL.createObjectURL(fichier);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 160;
        const cote = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, 160, 160);
        URL.revokeObjectURL(url);
        let d = c.toDataURL('image/webp', .85);
        if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/jpeg', .85);
        ok(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Image illisible.')); };
      img.src = url;
    });
  }
  $('pf-image').addEventListener('change', async ev => {
    const f = ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return statut('pf-statut', 'Image trop lourde (10 Mo maximum).', 'erreur');
    try {
      statut('pf-statut', 'Envoi de l\'image…');
      if (await enregistrerProfil({ p_avatar: await imageVersAvatar(f), p_changer_avatar: true }, 'pf-statut')) { statut('pf-statut', 'Image de profil mise à jour.', 'ok'); afficher(); }
    } catch (err) { statut('pf-statut', err.message, 'erreur'); }
  });
  $('pf-retirer-image').addEventListener('click', async () => {
    if (await enregistrerProfil({ p_avatar: null, p_changer_avatar: true }, 'pf-statut')) statut('pf-statut', 'Image retirée.', 'ok');
  });
  $('form-mdp').addEventListener('submit', async ev => {
    ev.preventDefault();
    const m = $('pf-mdp').value;
    if (m.length < 8) return statut('mdp-statut', 'Au moins 8 caractères.', 'erreur');
    if (m !== $('pf-mdp2').value) return statut('mdp-statut', 'Les deux mots de passe ne sont pas identiques.', 'erreur');
    const b = $('mdp-valider'); b.disabled = true;
    const { error } = await sb.auth.updateUser({ password: m });
    b.disabled = false;
    if (error) return statut('mdp-statut', /same|different/i.test(error.message) ? "C'est déjà ton mot de passe." : 'Changement impossible, réessaie.', 'erreur');
    $('pf-mdp').value = ''; $('pf-mdp2').value = '';
    statut('mdp-statut', 'Mot de passe changé.', 'ok');
  });

  // ---------- Bouton « œil » pour afficher les mots de passe ----------
  function ajouterOeil(input) {
    const zone = el('span', { class: 'champ-oeil' });
    input.replaceWith(zone);
    const bouton = el('button', { type: 'button', class: 'oeil', 'aria-label': 'Afficher', title: 'Afficher', 'aria-pressed': 'false', onclick: () => {
      const voir = input.type === 'password';
      input.type = voir ? 'text' : 'password';
      bouton.setAttribute('aria-pressed', String(voir));
      bouton.title = voir ? 'Masquer' : 'Afficher'; bouton.setAttribute('aria-label', bouton.title);
      bouton.replaceChildren(icone(voir ? 'oeilBarre' : 'oeil'));
      input.focus();
    } }, icone('oeil'));
    zone.append(input, bouton);
  }

  const MESSAGES_SB = {
    pseudo_pris: 'Ce pseudo est déjà pris.', pseudo_invalide: 'Pseudo invalide : 3 à 20 caractères (lettres sans accent, chiffres, - ou _).',
  };
  $('form-compte').addEventListener('submit', async ev => {
    ev.preventDefault();
    const pseudo = $('cp-pseudo').value.trim(), mdp = $('cp-mdp').value;
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(pseudo)) return statut('cp-statut', MESSAGES_SB.pseudo_invalide, 'erreur');
    if (mdp.length < 8) return statut('cp-statut', 'Le mot de passe doit faire au moins 8 caractères.', 'erreur');
    if (modeCompte === 'creation' && mdp !== $('cp-mdp2').value) return statut('cp-statut', 'Les deux mots de passe ne sont pas identiques.', 'erreur');
    const bouton = $('cp-valider'), texte = bouton.textContent;
    bouton.disabled = true; bouton.replaceChildren(chargeur(), modeCompte === 'creation' ? ' Création…' : ' Connexion…');
    try {
      if (modeCompte === 'creation') {
        const libre = await sb.rpc('catalogue_pseudo_libre', { p_pseudo: pseudo });
        if (libre.error) throw new Error('Le serveur des comptes ne répond pas. Réessaie plus tard.');
        if (!libre.data) throw new Error(MESSAGES_SB.pseudo_pris);
        await sb.auth.signOut().catch(() => {});
        const hasard = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join('');
        const email = `cat-${pseudo.toLowerCase()}.${hasard}@${DOMAINE_LOGIN}`;
        const ins = await sb.auth.signUp({ email, password: mdp });
        if (ins.error) throw new Error(/rate|too many/i.test(ins.error.message) ? 'Trop de créations de compte : réessaie dans un moment.' : 'La création du compte a échoué. Réessaie.');
        if (!ins.data.session) { const c = await sb.auth.signInWithPassword({ email, password: mdp }); if (c.error) throw new Error("Le compte n'a pas pu être activé."); }
        const r = await sb.rpc('catalogue_creer_profil', { p_pseudo: pseudo });
        if (r.error) { await sb.auth.signOut().catch(() => {}); throw new Error(MESSAGES_SB[(r.error.message.match(/pseudo_\w+/) || [])[0]] || 'La création du compte a échoué.'); }
      } else {
        const r = await sb.rpc('catalogue_email', { p_pseudo: pseudo });
        if (r.error) throw new Error('Le serveur des comptes ne répond pas. Réessaie plus tard.');
        if (!r.data) throw new Error('Pseudo inconnu. Crée d\'abord ton compte.');
        const c = await sb.auth.signInWithPassword({ email: r.data, password: mdp });
        if (c.error) throw new Error(/rate|too many/i.test(c.error.message) ? "Trop d'essais : attends quelques minutes." : 'Mot de passe incorrect.');
      }
      await chargerCompte();
      if (!compte) throw new Error('Connexion impossible pour le moment.');
      afficher(); rafraichirFiche(true);
      ouvrirCompte();
      statut('cp-statut', '');
    } catch (err) { statut('cp-statut', err.message, 'erreur'); }
    finally { bouton.disabled = false; bouton.textContent = texte; }
  });
  sb.auth.onAuthStateChange((ev, s) => {
    jetonAcces = s?.access_token || null;
    if (ev === 'SIGNED_OUT' && compte) { compte = null; mesLikes = new Set(); majBoutonCompte(); }
  });


  // ---------- Utilitaires ----------
  function el(balise, attrs = {}, ...enfants) {
    const n = document.createElement(balise);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
    }
    for (const e of enfants) if (e !== null && e !== undefined) n.append(e);
    return n;
  }
  const chargeur = (grand = false) => {
    const c = $('modele-chargeur').content.firstElementChild.cloneNode(true);
    if (grand) c.classList.add('grand');
    return c;
  };
  function couleurType(type) {
    let h = 0;
    for (const ch of type) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return COULEURS[h % COULEURS.length];
  }
  function tailleLisible(o) {
    if (!o) return '';
    const u = ['o', 'Ko', 'Mo', 'Go'];
    let i = 0;
    while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; }
    return (i ? o.toFixed(1).replace('.', ',') : o) + ' ' + u[i];
  }
  const dateLisible = d => {
    const x = new Date(d.length === 10 ? d + 'T12:00:00' : d);
    return isNaN(x) ? d : x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  };
  const normaliser = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = s => normaliser(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'element';
  const encoderChemin = p => p.split('/').map(encodeURIComponent).join('/');
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tousLesTypes = () => [...new Set([...TYPES_DE_BASE, ...catalogue.types, ...catalogue.elements.map(e => e.type)])];

  // ---------- Onglets latéraux (adresse #catalogue, #actualites, #mises-a-jour) ----------
  function changerVue() {
    const h = decodeURIComponent(location.hash.slice(1));
    const ficheId = h.startsWith('element/') ? h.slice(8) : null;
    const vue = ficheId ? 'element' : VUES.includes(h) ? h : 'catalogue';
    for (const v of [...VUES, 'element']) $('vue-' + v).hidden = v !== vue;
    const onglet = vue === 'element' ? 'catalogue' : vue;
    document.querySelectorAll('.onglet').forEach(o => {
      if (o.dataset.vue === onglet) o.setAttribute('aria-current', 'page'); else o.removeAttribute('aria-current');
    });
    $('criteres').hidden = vue !== 'catalogue';
    if (ficheId) { afficherFiche(ficheId); scrollTo({ top: 0 }); }
  }
  addEventListener('hashchange', changerVue);

  // ---------- Chargement ----------
  async function charger() {
    $('etat').replaceChildren(chargeur(true), el('span', {}, 'Chargement du catalogue…'));
    const lire = async f => { const r = await fetch(f, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); };
    const [cat, inf] = await Promise.allSettled([lire('catalogue.json'), lire('site.json'), chargerStats(), chargerCompte()]);
    if (inf.status === 'fulfilled') site = { ...site, ...inf.value };
    afficherSite();
    if (cat.status !== 'fulfilled') { $('etat').textContent = 'Impossible de charger le catalogue.'; return; }
    catalogue = { types: [], elements: [], ...cat.value };
    afficher();
    changerVue();
  }

  // ---------- Filtres (barre latérale) ----------
  function afficherCriteres() {
    const comptes = {};
    for (const e of catalogue.elements) comptes[e.type] = (comptes[e.type] || 0) + 1;
    const types = Object.keys(comptes).sort((a, b) => a.localeCompare(b, 'fr'));
    for (const t of [...criteres.types]) if (!comptes[t]) criteres.types.delete(t);
    $('crit-types').replaceChildren(...(types.length ? types.map(t => el('label', { class: 'crit-type' },
      el('input', { type: 'checkbox', ...(criteres.types.has(t) ? { checked: '' } : {}),
        onchange: ev => { ev.target.checked ? criteres.types.add(t) : criteres.types.delete(t); criteres.page = 1; afficher(); } }),
      el('span', {}, t), el('small', {}, `(${comptes[t]})`)))
      : [el('p', { class: 'crit-vide' }, 'Aucune catégorie pour le moment.')]));
  }
  function appliquerFiltresVisibles() {
    $('filtres-corps').hidden = !criteres.filtres;
    $('basculer-filtres').setAttribute('aria-expanded', String(criteres.filtres));
    $('basculer-filtres').querySelector('span').textContent = criteres.filtres ? 'Masquer les filtres' : 'Afficher les filtres';
  }
  $('basculer-filtres').addEventListener('click', () => { criteres.filtres = !criteres.filtres; appliquerFiltresVisibles(); memoriserAffichage(); });

  for (const [id, cle] of [['crit-nom', 'nom'], ['crit-desc', 'desc'], ['crit-auteur', 'auteur']])
    $(id).addEventListener('input', e => { criteres[cle] = e.target.value; criteres.page = 1; afficher(); });
  for (const [id, cle, nombre] of [['crit-periode', 'periode', true], ['crit-tri', 'tri'], ['crit-ordre', 'ordre'], ['crit-par-page', 'parPage', true]])
    $(id).addEventListener('change', e => { criteres[cle] = nombre ? +e.target.value : e.target.value; criteres.page = 1; memoriserAffichage(); afficher(); });
  $('crit-tri').addEventListener('change', e => {           // ordre logique par défaut selon le tri
    criteres.ordre = e.target.value === 'nom' ? 'asc' : 'desc'; $('crit-ordre').value = criteres.ordre; afficher();
  });
  $('crit-reset').addEventListener('click', () => {
    Object.assign(criteres, { nom: '', desc: '', auteur: '', periode: 0, tri: 'ajout', ordre: 'desc', page: 1 });
    criteres.types.clear();
    for (const id of ['crit-nom', 'crit-desc', 'crit-auteur']) $(id).value = '';
    $('crit-periode').value = '0'; $('crit-tri').value = 'ajout'; $('crit-ordre').value = 'desc';
    afficher();
  });
  function appliquerVue() {
    $('grille').classList.toggle('liste', criteres.vue === 'liste');
    const l = criteres.vue === 'liste';
    $('basculer-vue').classList.toggle('en-liste', l);
    $('basculer-vue').setAttribute('aria-label', l ? 'Affichage en grille' : 'Affichage en liste');
    $('basculer-vue').title = l ? 'Affichage en grille' : 'Affichage en liste';
  }
  $('basculer-vue').addEventListener('click', () => { criteres.vue = criteres.vue === 'liste' ? 'grille' : 'liste'; appliquerVue(); memoriserAffichage(); afficher(); });

  // ---------- Catalogue ----------
  function tempsRelatif(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '';
    const min = Math.round(ms / 6e4), h = Math.round(ms / 36e5), j = Math.round(ms / 864e5);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    if (h < 24) return `il y a ${h} heure${h > 1 ? 's' : ''}`;
    if (j < 7) return `il y a ${j} jour${j > 1 ? 's' : ''}`;
    if (j < 31) { const s = Math.round(j / 7); return `il y a ${s} semaine${s > 1 ? 's' : ''}`; }
    if (j < 365) return `il y a ${Math.round(j / 30)} mois`;
    const a = Math.round(j / 365); return `il y a ${a} an${a > 1 ? 's' : ''}`;
  }
  const dateCourte = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const ICONES = {
    horloge: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    publie: 'M12 16V5m0 0-4 4m4-4 4 4M5 19h14',
    version: 'M3 12V4h8l10 10-8 8L3 12Zm5-4h.01',
    disque: 'M4 14h16v5H4zM6 14l2-8h8l2 8M8 17h.01',
    telecharger: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
    pouce: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7',
    oeil: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    oeilBarre: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    crayon: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
    poubelle: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    bulle: 'M4 5h16v11H9l-5 4V5Z',
  };
  const icone = n => { const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('aria-hidden', 'true'); sv.classList.add('ic');
    const pa = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pa.setAttribute('d', ICONES[n]); sv.append(pa); return sv; };

  function afficher() {
    afficherCriteres();
    const [qn, qd, qa] = [criteres.nom, criteres.desc, criteres.auteur].map(x => normaliser(x.trim()));
    const limite = criteres.periode ? Date.now() - criteres.periode * 864e5 : 0;
    const cles = {
      ajout: (a, b) => (a.ajoute_le || '').localeCompare(b.ajoute_le || ''),
      maj: (a, b) => (a.modifie_le || '').localeCompare(b.modifie_le || ''),
      nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
      taille: (a, b) => (a.fichier?.taille || 0) - (b.fichier?.taille || 0),
    };
    const sens = criteres.ordre === 'asc' ? 1 : -1;
    const liste = catalogue.elements
      .filter(e => !criteres.types.size || criteres.types.has(e.type))
      .filter(e => !limite || new Date(e.ajoute_le).getTime() >= limite)
      .filter(e => !qn || normaliser(e.nom).includes(qn))
      .filter(e => !qd || normaliser(e.description).includes(qd))
      .filter(e => !qa || normaliser(e.auteur || AUTEUR_DEFAUT).includes(qa))
      .sort((a, b) => sens * cles[criteres.tri](a, b));

    const pages = Math.max(1, Math.ceil(liste.length / criteres.parPage));
    criteres.page = Math.min(criteres.page, pages);
    const debut = (criteres.page - 1) * criteres.parPage;

    $('compte').textContent = catalogue.elements.length || '';
    $('nb-resultats').textContent = `${liste.length} résultat${liste.length > 1 ? 's' : ''}`;
    $('grille').replaceChildren(...liste.slice(debut, debut + criteres.parPage).map(carte));
    $('etat').textContent = catalogue.elements.length === 0 ? 'Le catalogue est vide pour le moment.'
      : liste.length === 0 ? 'Aucun résultat avec ces filtres.' : '';
    afficherPagination(pages);
  }

  function afficherPagination(pages) {
    const nav = $('pagination');
    if (pages <= 1) { nav.replaceChildren(); return; }
    const aller = p => () => { criteres.page = p; afficher(); $('vue-catalogue').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    const numeros = [];
    for (let p = 1; p <= pages; p++)
      if (p === 1 || p === pages || Math.abs(p - criteres.page) <= 1) numeros.push(p);
      else if (numeros[numeros.length - 1] !== '…') numeros.push('…');
    nav.replaceChildren(
      el('button', { type: 'button', class: 'page', disabled: criteres.page === 1 ? '' : null, 'aria-label': 'Page précédente', onclick: aller(criteres.page - 1) }, '‹'),
      ...numeros.map(p => p === '…' ? el('span', { class: 'page-trou' }, '…')
        : el('button', { type: 'button', class: 'page', 'aria-current': p === criteres.page ? 'page' : null, onclick: aller(p) }, String(p))),
      el('button', { type: 'button', class: 'page', disabled: criteres.page === pages ? '' : null, 'aria-label': 'Page suivante', onclick: aller(criteres.page + 1) }, '›'));
  }

  function carte(e, i) {
    const coul = couleurType(e.type);
    const image = e.image
      ? el('img', { src: encoderChemin(e.image), alt: '', loading: 'lazy' })
      : el('span', { class: 'initiale', style: `background:${coul}` }, (e.nom || '?').trim().charAt(0).toUpperCase());
    const f = e.fichier || {};
    const href = f.url || (f.chemin ? encoderChemin(f.chemin) : null);
    const lien = `#element/${encodeURIComponent(e.id)}`;
    return el('article', { class: 'carte', style: `--i:${Math.min(i, 12)};--type:${coul}` },
      el('a', { class: 'carte-image', href: lien, 'aria-label': `Voir ${e.nom}` }, image),
      estGerant() ? el('div', { class: 'carte-outils' },
        el('button', { type: 'button', class: 'outil-rond', title: 'Modifier', 'aria-label': `Modifier ${e.nom}`, onclick: () => gererElement(e, 'modifier') }, icone('crayon')),
        el('button', { type: 'button', class: 'outil-rond danger', title: 'Supprimer', 'aria-label': `Supprimer ${e.nom}`, onclick: () => gererElement(e, 'supprimer') }, icone('poubelle'))) : null,
      el('div', { class: 'carte-corps' },
        el('h2', {}, el('a', { href: lien }, e.nom)),
        el('div', { class: 'carte-auteur' }, el('img', { src: 'icone-48.png', alt: '', width: 16, height: 16 }), e.auteur || AUTEUR_DEFAUT),
        el('div', { class: 'carte-ligne' }, e.type),
        el('div', { class: 'carte-ligne carte-dates' },
          el('span', { title: 'Mis à jour le ' + dateLisible(e.modifie_le || e.ajoute_le || '') }, icone('horloge'), tempsRelatif(e.modifie_le || e.ajoute_le)),
          el('span', { title: 'Publié le ' + dateLisible(e.ajoute_le || '') }, icone('publie'), dateCourte(e.ajoute_le))),
        el('p', { class: 'carte-description' }, e.description || '')),
      el('div', { class: 'carte-pied' },
        el('span', { title: "J'aime", class: mesLikes.has(e.id) ? 'aime' : null }, icone('pouce'), statsDispo ? String(stat(e.id, 'likes')) : '—'),
        el('span', { title: 'Téléchargements' }, icone('telecharger'), statsDispo ? String(stat(e.id, 'telechargements')) : '—'),
        f.taille ? el('span', { title: 'Taille' }, icone('disque'), tailleLisible(f.taille)) : (f.url ? el('span', {}, icone('disque'), 'Lien externe') : null)));
  }

  // ---------- Fiche détaillée d'un élément ----------
  function lienTelechargement(e) {
    const f = e.fichier || {};
    return { f, href: f.url || (f.chemin ? encoderChemin(f.chemin) : null) };
  }
  function boutonTelecharger(e, classe, texte) {
    const { f, href } = lienTelechargement(e);
    if (!href) return null;
    return el('a', { class: classe, href, download: f.url ? null : (f.nom || ''), rel: f.url ? 'noopener' : null, target: f.url ? '_blank' : null,
      onclick: () => { compterTelechargement(e.id); setTimeout(() => { majStatsFiche(e); afficher(); }, 50); } },
      icone('telecharger'), texte);
  }
  function majStatsFiche(e) {
    const zone = document.querySelector('#vue-element .fiche-stats');
    if (!zone || zone.dataset.id !== e.id) return;
    zone.replaceWith(blocStats(e));
    const b = document.querySelector('#vue-element .bouton-aime');
    if (b) { b.classList.toggle('actif', mesLikes.has(e.id)); b.setAttribute('aria-pressed', String(mesLikes.has(e.id))); b.lastChild.textContent = mesLikes.has(e.id) ? "J'aime déjà" : "J'aime"; }
    const dl = document.querySelector('#vue-element .deja-telecharge');
    if (dl) dl.replaceWith(etatTelechargement(e));
  }
  function blocStats(e) {
    const v = cle => statsDispo ? String(stat(e.id, cle)) : '—';
    const item = (ic, nom, val) => el('div', { class: 'fiche-stat' }, icone(ic), el('div', {}, el('span', {}, nom), el('strong', {}, val)));
    return el('div', { class: 'fiche-stats', 'data-id': e.id },
      item('pouce', "J'aime", v('likes')),
      item('telecharger', 'Téléchargements', v('telechargements')),
      item('oeil', 'Vues', v('vues')),
      item('version', 'Version', e.version ? e.version.replace(/^v/i, '') : '—'),
      item('disque', 'Taille', e.fichier?.taille ? tailleLisible(e.fichier.taille) : e.fichier?.url ? 'Lien externe' : '—'));
  }
  function etatTelechargement(e) {
    const quand = mesTelechargements[e.id];
    return el('p', { class: 'deja-telecharge' + (quand ? ' oui' : '') },
      el('span', { class: 'pastille-etat' }, quand ? '✓' : '✕'),
      quand ? `Tu as téléchargé cet élément le ${dateLisible(quand)}.` : "Tu n'as pas encore téléchargé cet élément.");
  }
  function ligneInfo(nom, valeur, titre) {
    return el('div', { class: 'fiche-info' }, el('span', {}, nom), el('strong', { title: titre || null }, valeur));
  }
  // Image principale + images secondaires (cliquables pour les voir en grand)
  function blocMedia(e, coul) {
    const toutes = [e.image, ...(e.images || [])].filter(Boolean).map(encoderChemin);
    const principale = e.image
      ? el('button', { type: 'button', class: 'fiche-image', title: 'Voir en grand', onclick: () => ouvrirVisionneuse(toutes, 0) }, el('img', { src: encoderChemin(e.image), alt: `Image de ${e.nom}` }))
      : el('div', { class: 'fiche-image vide' }, el('span', { class: 'initiale', style: `background:${coul}` }, (e.nom || '?').trim().charAt(0).toUpperCase()));
    const sec = e.images || [];
    if (!sec.length) return el('div', { class: 'fiche-media' }, principale);
    const decalage = e.image ? 1 : 0;
    const MAX = 6, visibles = sec.slice(0, MAX), reste = sec.length - MAX;
    return el('div', { class: 'fiche-media avec-galerie' }, principale,
      el('div', { class: 'galerie' },
        el('p', { class: 'galerie-titre' }, `${sec.length} image${sec.length > 1 ? 's' : ''} secondaire${sec.length > 1 ? 's' : ''}`),
        el('div', { class: 'galerie-grille' }, ...visibles.map((c, i) => el('button', { type: 'button', class: 'vignette', style: `--i:${i}`, title: 'Voir en grand',
          onclick: () => ouvrirVisionneuse(toutes, i + decalage) },
          el('img', { src: encoderChemin(c), alt: `Image ${i + 1} de ${e.nom}`, loading: 'lazy' }),
          i === MAX - 1 && reste > 0 ? el('span', { class: 'vignette-plus' }, `+${reste}`) : null)))));
  }

  // ---------- Visionneuse ----------
  let visImages = [], visIndex = 0;
  function montrerImage(i) {
    visIndex = (i + visImages.length) % visImages.length;
    const img = $('vis-image');
    img.classList.remove('arrivee'); void img.offsetWidth; img.classList.add('arrivee');
    img.src = visImages[visIndex];
    $('vis-compteur').textContent = visImages.length > 1 ? `${visIndex + 1} / ${visImages.length}` : '';
    $('vis-prec').hidden = $('vis-suiv').hidden = visImages.length < 2;
  }
  function ouvrirVisionneuse(liste, i) {
    if (!liste.length) return;
    visImages = liste; montrerImage(i);
    $('visionneuse').showModal();
  }
  $('vis-fermer').addEventListener('click', () => $('visionneuse').close());
  $('vis-prec').addEventListener('click', () => montrerImage(visIndex - 1));
  $('vis-suiv').addEventListener('click', () => montrerImage(visIndex + 1));
  $('visionneuse').addEventListener('click', ev => { if (ev.target === $('visionneuse')) $('visionneuse').close(); });
  $('visionneuse').addEventListener('keydown', ev => {
    if (ev.key === 'ArrowLeft') montrerImage(visIndex - 1);
    if (ev.key === 'ArrowRight') montrerImage(visIndex + 1);
  });
  let toucheX = null;
  $('visionneuse').addEventListener('touchstart', ev => { toucheX = ev.touches[0].clientX; }, { passive: true });
  $('visionneuse').addEventListener('touchend', ev => {
    if (toucheX === null) return;
    const dx = ev.changedTouches[0].clientX - toucheX; toucheX = null;
    if (Math.abs(dx) > 50) montrerImage(visIndex + (dx < 0 ? 1 : -1));
  });

  let ficheAffichee = null;
  function afficherFiche(id, garderOnglet) {
    const zone = $('vue-element');
    const e = catalogue.elements.find(x => x.id === id);
    if (!e) {
      zone.replaceChildren(el('div', { class: 'etat' }, catalogue.elements.length ? 'Cet élément n\'existe pas ou a été retiré.' : 'Chargement…',
        el('a', { href: '#catalogue', class: 'lien-retour' }, '← Retour au catalogue')));
      return;
    }
    compterVue(e.id);
    const coul = couleurType(e.type);
    const { f } = lienTelechargement(e);
    let ongletActif = garderOnglet && ficheAffichee?.id === e.id ? ficheAffichee.onglet : 'description';
    const corpsOnglet = el('div', { class: 'fiche-onglet-corps' });
    const onglets = el('div', { class: 'fiche-onglets', role: 'tablist' });
    const contenus = {
      description: () => el('div', { class: 'fiche-description' },
        el('h3', {}, 'À propos'),
        etatTelechargement(e),
        el('p', { class: 'fiche-texte' }, e.description || 'Pas de description.'),
        el('div', { class: 'fiche-actions-bas' },
          el('button', { type: 'button', class: 'bouton-contour', onclick: ev => {
            const url = location.href;
            (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => { ev.target.textContent = 'Lien copié ✓'; setTimeout(() => { ev.target.textContent = 'Partager'; }, 2000); },
              () => prompt('Copie ce lien :', url));
          } }, 'Partager'))),
      fichiers: () => el('div', { class: 'fiche-fichiers' },
        el('div', { class: 'fichier-ligne' },
          el('div', { class: 'fichier-infos' },
            el('strong', {}, f.nom || 'Fichier'),
            el('span', {}, [e.version ? 'Version ' + e.version.replace(/^v/i, '') : null, f.taille ? tailleLisible(f.taille) : f.url ? 'Lien externe' : null,
              'Mis à jour le ' + dateLisible(e.modifie_le || e.ajoute_le || '')].filter(Boolean).join(' · '))),
          boutonTelecharger(e, 'bouton-principal', 'Télécharger'))),
      commentaires: () => blocCommentaires(e, () => montrer('commentaires')),
    };
    const titres = { description: 'Description', fichiers: 'Fichiers', commentaires: 'Commentaires' };
    const comptes = { fichiers: () => f.nom || f.url ? '1' : '0', commentaires: () => statsDispo && 'commentaires' in (stats[e.id] || { commentaires: 0 }) ? String(stat(e.id, 'commentaires')) : null };
    function montrer(nom) {
      ongletActif = nom; ficheAffichee = { id: e.id, onglet: nom };
      onglets.replaceChildren(...Object.keys(contenus).map(k => el('button', { type: 'button', role: 'tab', class: 'fiche-onglet', 'aria-selected': String(k === ongletActif), onclick: () => montrer(k) },
        titres[k], comptes[k]?.() != null ? el('span', { class: 'compte-onglet' }, comptes[k]()) : null)));
      corpsOnglet.replaceChildren(contenus[nom]());
    }
    montrer(ongletActif);

    const aime = mesLikes.has(e.id);
    const boutonAime = el('button', { type: 'button', class: 'bouton-contour bouton-aime' + (aime ? ' actif' : ''), 'aria-pressed': String(aime),
      onclick: async () => { if (await basculerLike(e.id)) { majStatsFiche(e); afficher(); } } }, icone('pouce'), el('span', {}, aime ? "J'aime déjà" : "J'aime"));

    zone.replaceChildren(
      el('nav', { class: 'fil-ariane', 'aria-label': "Fil d'Ariane" },
        el('a', { href: '#catalogue' }, 'Catalogue'), el('span', {}, '/'),
        el('a', { href: '#catalogue', onclick: () => { criteres.types = new Set([e.type]); criteres.page = 1; afficher(); } }, e.type), el('span', {}, '/'),
        el('span', { class: 'actuel' }, e.nom)),
      el('div', { class: 'fiche-entete' },
        el('h2', { class: 'fiche-titre' }, e.nom),
        el('div', { class: 'fiche-boutons' },
          estGerant() ? el('button', { type: 'button', class: 'bouton-contour', onclick: () => gererElement(e, 'modifier') }, icone('crayon'), 'Modifier') : null,
          estGerant() ? el('button', { type: 'button', class: 'bouton-contour danger', onclick: () => gererElement(e, 'supprimer') }, icone('poubelle'), 'Supprimer') : null,
          boutonAime, boutonTelecharger(e, 'bouton-principal', 'Télécharger'))),
      blocStats(e),
      blocMedia(e, coul),
      el('div', { class: 'fiche-infos' },
        ligneInfo('Dernière mise à jour', dateLisible(e.modifie_le || e.ajoute_le || ''), tempsRelatif(e.modifie_le || e.ajoute_le)),
        ligneInfo('Mise en ligne', dateLisible(e.ajoute_le || ''), tempsRelatif(e.ajoute_le)),
        ligneInfo('Créé par', e.auteur || AUTEUR_DEFAUT),
        ligneInfo('Catégorie', e.type)),
      onglets,
      corpsOnglet);
  }

  // ---------- Commentaires ----------
  function blocCommentaires(e, rafraichir) {
    const zone = el('div', { class: 'commentaires' });
    const liste = el('ol', { class: 'liste-commentaires' }, el('li', { class: 'commentaires-etat' }, chargeur(), ' Chargement des commentaires…'));
    let formulaire;
    if (compte) {
      const texte = el('textarea', { rows: 3, maxlength: 1000, placeholder: 'Écris un commentaire…', 'aria-label': 'Ton commentaire' });
      const compteur = el('span', { class: 'aide' }, '0 / 1000');
      const etat = el('p', { class: 'statut', role: 'status' });
      const envoyer = el('button', { type: 'submit', class: 'bouton' }, 'Publier');
      texte.addEventListener('input', () => { compteur.textContent = `${texte.value.length} / 1000`; });
      const avatar = el('span', { class: 'avatar-compte' }); remplirAvatar(avatar, { avatar: compte.avatar, nom: compte.pseudo, gerant: estGerant() });
      formulaire = el('form', { class: 'nouveau-commentaire', onsubmit: async ev => {
        ev.preventDefault();
        if (!texte.value.trim()) return;
        envoyer.disabled = true; envoyer.replaceChildren(chargeur(), ' Envoi…');
        const { error } = await sb.rpc('catalogue_commenter', { p_id: e.id, p_texte: texte.value });
        envoyer.disabled = false; envoyer.textContent = 'Publier';
        if (error) {
          const m = /trop_rapide/.test(error.message) ? 'Attends quelques secondes entre deux commentaires.' : /non_connecte|JWT/.test(error.message) ? 'Ta session a expiré, reconnecte-toi.' : /function|schema/i.test(error.message) ? "Les commentaires ne sont pas encore activés sur le serveur." : "Le commentaire n'a pas pu être publié.";
          etat.textContent = m; etat.className = 'statut erreur'; return;
        }
        (stats[e.id] ||= { id: e.id, telechargements: 0, likes: 0, vues: 0, commentaires: 0 }).commentaires = stat(e.id, 'commentaires') + 1;
        compte.nb_commentaires = (compte.nb_commentaires || 0) + 1;
        rafraichir();
      } }, avatar, el('div', { class: 'nouveau-commentaire-corps' }, texte, el('div', { class: 'ligne actions' }, compteur, envoyer), etat));
    } else {
      formulaire = el('div', { class: 'commentaire-connexion' }, 'Connecte-toi pour participer à la discussion. ',
        el('button', { type: 'button', class: 'bouton-contour', onclick: () => ouvrirCompte('Connecte-toi ou crée un compte pour commenter.') }, 'Se connecter'));
    }
    zone.append(el('h3', {}, 'Commentaires'), formulaire, liste);
    sb.rpc('catalogue_commentaires_lire', { p_id: e.id }).then(({ data, error }) => {
      if (error) { liste.replaceChildren(el('li', { class: 'commentaires-etat' }, /function|schema/i.test(error.message) ? 'Les commentaires ne sont pas encore activés sur le serveur.' : 'Impossible de charger les commentaires.')); return; }
      if (!data.length) { liste.replaceChildren(el('li', { class: 'commentaires-etat' }, 'Aucun commentaire pour le moment. Sois le premier !')); return; }
      liste.replaceChildren(...data.map((c, i) => {
        const av = el('span', { class: 'avatar-compte' }); remplirAvatar(av, { avatar: c.avatar, nom: c.auteur, gerant: c.gerant });
        return el('li', { class: 'commentaire' + (c.gerant ? ' du-studio' : ''), style: `--i:${Math.min(i, 10)}` }, av,
          el('div', { class: 'commentaire-corps' },
            el('div', { class: 'commentaire-tete' }, el('strong', {}, c.auteur), c.gerant ? el('span', { class: 'badge-studio' }, 'Studio') : null,
              el('time', { datetime: c.cree_le, title: dateLisible(c.cree_le) }, tempsRelatif(c.cree_le)),
              c.a_moi || estGerant() ? el('button', { type: 'button', class: 'lien-discret supprimer-commentaire', onclick: async () => {
                if (!confirm('Supprimer ce commentaire ?')) return;
                const { error } = await sb.rpc('catalogue_commentaire_supprimer', { p_cid: c.id });
                if (error) return alert('Suppression impossible.');
                if (stats[e.id]) stats[e.id].commentaires = Math.max(0, stat(e.id, 'commentaires') - 1);
                if (c.a_moi && compte) compte.nb_commentaires = Math.max(0, (compte.nb_commentaires || 1) - 1);
                rafraichir();
              } }, 'Supprimer') : null),
            el('p', {}, c.texte)));
      }));
    });
    return zone;
  }

  // ---------- Raccourcis du gérant : ajouter / modifier / supprimer directement ----------
  async function preparerGestion() {
    if (!estGerant()) return false;
    if (session) return true;
    try {
      const infos = await chargerJeton();
      if (!infos) { afficherPanneau(); dialogue.showModal(); statut('c-statut', 'Relie d\'abord GitHub (une seule fois).', ''); return false; }
      infos.login = await verifierJeton(infos.jeton, infos.proprio, infos.depot);
      session = infos;
      return true;
    } catch (err) { afficherPanneau(); dialogue.showModal(); statut('c-statut', err.message + ' Enregistre un nouveau jeton.', 'erreur'); return false; }
  }
  async function gererElement(e, action) {
    if (!(await preparerGestion())) return;
    afficherPanneau();
    if (action === 'ajouter') { viderFormulaire(); dialogue.showModal(); setTimeout(() => $('f-nom').focus(), 50); return; }
    if (action === 'modifier') { dialogue.showModal(); modifierElement(e); return; }
    if (action === 'supprimer') {
      if (await supprimerElement(e)) { if (location.hash.includes('element/')) location.hash = '#catalogue'; }
      else if (!dialogue.open && $('f-statut').classList.contains('erreur')) { dialogue.showModal(); }
    }
  }
  $('ajouter-element').addEventListener('click', () => gererElement(null, 'ajouter'));

  // ---------- Mises à jour (frise) ----------
  const TYPES_MAJ = {
    nouveau: ['Nouveau', '#00ff95'], amelioration: ['Amélioration', '#00a3ff'],
    correction: ['Correction', '#ff8a00'], securite: ['Sécurité', '#e600ff'],
  };
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  function afficherMisesAJour() {
    const majs = site.mises_a_jour || [];
    const total = majs.reduce((t, m) => t + (m.nouveautes || []).length, 0);
    const derniere = majs[0];
    $('maj-resume').replaceChildren(
      el('div', { class: 'maj-actuelle-bloc' },
        el('span', { class: 'maj-etiquette' }, 'Version actuelle'),
        el('div', { class: 'maj-grand' }, el('span', { class: 'maj-numero' }, site.version || '—'),
          site.beta ? el('span', { class: 'badge-beta' }, 'Bêta') : null)),
      el('div', { class: 'maj-stats' },
        el('div', { class: 'maj-stat' }, el('strong', {}, String(majs.length)), el('span', {}, majs.length > 1 ? 'mises à jour' : 'mise à jour')),
        el('div', { class: 'maj-stat' }, el('strong', {}, String(total)), el('span', {}, total > 1 ? 'changements' : 'changement')),
        derniere ? el('div', { class: 'maj-stat' }, el('strong', {}, dateLisible(derniere.date).replace(/ \d{4}$/, '')), el('span', {}, 'dernière mise à jour')) : null));

    $('liste-maj').replaceChildren(...majs.map((m, i) => {
      const items = (m.nouveautes || []).map(n => typeof n === 'string' ? { type: 'nouveau', texte: n } : n);
      const li = el('li', { class: 'maj' + (i === 0 ? ' actuelle ouvert' : ''), style: `--couleur:${COULEURS[(i * 4 + 5) % COULEURS.length]};--i:${Math.min(i, 8)}` });
      const tete = el('button', { type: 'button', class: 'maj-tete', 'aria-expanded': String(i === 0),
        onclick: () => { const o = li.classList.toggle('ouvert'); tete.setAttribute('aria-expanded', String(o)); } },
        el('span', { class: 'maj-version' }, 'v' + m.version),
        el('time', { datetime: m.date }, dateLisible(m.date)),
        i === 0 ? el('span', { class: 'maj-pastille-actuelle' }, 'Actuelle') : null,
        el('span', { class: 'maj-compte' }, pluriel(items.length, 'changement')),
        el('span', { class: 'chevron', 'aria-hidden': 'true' }));
      const corps = el('div', { class: 'maj-corps' }, el('div', {}, el('ul', { class: 'maj-liste' },
        ...items.map((n, j) => {
          const [nom, coul] = TYPES_MAJ[n.type] || TYPES_MAJ.nouveau;
          return el('li', { style: `--j:${j}` }, el('span', { class: 'tag', style: `--tag:${coul}` }, nom), el('span', {}, n.texte));
        }))));
      li.append(tete, corps);
      return li;
    }));
  }

  // ---------- Actualités ----------
  const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function ilYA(dateTexte) {
    const d = new Date(dateTexte.length === 10 ? dateTexte + 'T12:00:00' : dateTexte);
    const jours = Math.round((new Date().setHours(12, 0, 0, 0) - new Date(d).setHours(12, 0, 0, 0)) / 864e5);
    if (isNaN(jours)) return '';
    if (jours <= 0) return "aujourd'hui";
    if (jours === 1) return 'hier';
    if (jours < 7) return `il y a ${jours} jours`;
    if (jours < 31) { const s = Math.round(jours / 7); return `il y a ${s} semaine${s > 1 ? 's' : ''}`; }
    if (jours < 365) return `il y a ${Math.round(jours / 30)} mois`;
    const a = Math.round(jours / 365); return `il y a ${a} an${a > 1 ? 's' : ''}`;
  }
  function carteActu(a, i) {
    const d = new Date((a.date || '').length === 10 ? a.date + 'T12:00:00' : a.date);
    const recente = (Date.now() - d) / 864e5 < 7;
    const longue = (a.texte || '').length > 260;
    const art = el('article', { class: 'actu' + (i === 0 ? ' une' : '') + (longue ? ' repliee' : ''),
      style: `--couleur:${COULEURS[(i * 5 + 5) % COULEURS.length]};--i:${Math.min(i, 8)}` });
    const plus = longue ? el('button', { type: 'button', class: 'actu-plus',
      onclick: () => { plus.textContent = art.classList.toggle('repliee') ? 'Lire la suite' : 'Réduire'; } }, 'Lire la suite') : null;
    art.append(
      el('time', { class: 'actu-date', datetime: a.date, title: dateLisible(a.date) },
        el('strong', {}, isNaN(d) ? '?' : String(d.getDate())), el('span', {}, isNaN(d) ? '' : MOIS_COURTS[d.getMonth()])),
      el('div', { class: 'actu-corps' },
        el('div', { class: 'actu-meta' },
          i === 0 ? el('span', { class: 'actu-une' }, 'À la une') : null,
          recente ? el('span', { class: 'actu-nouveau' }, 'Nouveau') : null,
          el('span', {}, `${dateLisible(a.date)} · ${ilYA(a.date)}`)),
        el('h3', {}, a.titre),
        el('p', {}, a.texte),
        plus));
    return art;
  }

  // ---------- Actualités & mises à jour ----------
  function afficherSite() {
    $('version-site').textContent = site.version || '—';
    const actus = [...(site.actualites || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('liste-actus').replaceChildren(...(actus.length ? actus.map(carteActu)
      : [el('div', { class: 'actus-vide' }, chargeur(true), el('span', {}, 'Aucune actualité pour le moment.'))]));
    afficherMisesAJour();
    listeActusGestion();
  }

  // ---------- API GitHub ----------
  // Le jeton déchiffré n'existe qu'en mémoire, jamais dans le stockage du navigateur.
  let session = null; // { jeton, proprio, depot, branche, login }
  const reglages = () => session || {};
  const urlApi = chemin => { const r = reglages(); return `https://api.github.com/repos/${r.proprio}/${r.depot}/contents/${encoderChemin(chemin)}`; };
  function entetes() {
    const r = reglages();
    if (!r.jeton) throw new Error('Gestion non connectée à GitHub.');
    return { Authorization: `Bearer ${r.jeton}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function erreurGitHub(status, message) {
    let msg = message || status;
    if (status === 401) msg = 'jeton refusé (expiré ou invalide)';
    else if (status === 403 || status === 404) msg += ' — vérifie le dépôt et la permission Contents du jeton';
    const err = new Error(`GitHub : ${msg}`); err.status = status; return err;
  }
  // Lecture (renvoie null si le fichier n'existe pas)
  async function lire(chemin) {
    const rep = await fetch(urlApi(chemin) + `?ref=${encodeURIComponent(reglages().branche)}`, { headers: entetes(), cache: 'no-store' });
    if (rep.status === 404) return null;
    if (!rep.ok) { let m; try { m = (await rep.json()).message; } catch {} throw erreurGitHub(rep.status, m); }
    return rep.json();
  }
  // Écriture avec progression (XMLHttpRequest pour suivre l'envoi)
  function ecrire(chemin, base64, message, sha, surProgression) {
    const corps = JSON.stringify({ message, content: base64, branch: reglages().branche, ...(sha ? { sha } : {}) });
    const h = entetes();
    return new Promise((ok, ko) => {
      const x = new XMLHttpRequest();
      x.open('PUT', urlApi(chemin));
      for (const [k, v] of Object.entries(h)) x.setRequestHeader(k, v);
      x.setRequestHeader('Content-Type', 'application/json');
      if (surProgression) x.upload.onprogress = e => e.lengthComputable && surProgression(e.loaded / e.total);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return ok(JSON.parse(x.responseText || 'null'));
        let m; try { m = JSON.parse(x.responseText).message; } catch {}
        ko(erreurGitHub(x.status, m));
      };
      x.onerror = () => ko(new Error('Connexion à GitHub impossible.'));
      x.send(corps);
    });
  }
  async function supprimer(chemin, message) {
    const info = await lire(chemin);
    if (!info) return;
    const rep = await fetch(urlApi(chemin), {
      method: 'DELETE', headers: { ...entetes(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sha: info.sha, branch: reglages().branche }),
    });
    if (!rep.ok) { let m; try { m = (await rep.json()).message; } catch {} throw erreurGitHub(rep.status, m); }
  }
  const texteVersBase64 = t => {
    const o = new TextEncoder().encode(t);
    let b = '';
    for (let i = 0; i < o.length; i += 0x8000) b += String.fromCharCode(...o.subarray(i, i + 0x8000));
    return btoa(b);
  };
  const base64VersTexte = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const fichierVersBase64 = f => new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onload = () => ok(lecteur.result.slice(lecteur.result.indexOf(',') + 1));
    lecteur.onerror = () => ko(lecteur.error);
    lecteur.readAsDataURL(f);
  });

  // Relit un JSON du dépôt, applique la modification, le réécrit (1 nouvel essai si conflit)
  async function modifierJson(chemin, defaut, modif, message) {
    for (let essai = 0; essai < 2; essai++) {
      const info = await lire(chemin);
      const actuel = info ? JSON.parse(base64VersTexte(info.content)) : structuredClone(defaut);
      modif(actuel);
      try {
        await ecrire(chemin, texteVersBase64(JSON.stringify(actuel, null, 1) + '\n'), message, info?.sha);
        return actuel;
      } catch (e) { if (e.status !== 409 || essai) throw e; }
    }
  }
  const modifierCatalogue = async (modif, message) => {
    catalogue = await modifierJson('catalogue.json', { version: 1, types: [], elements: [] }, c => { c.types ||= []; c.elements ||= []; modif(c); }, message);
  };
  const modifierSite = async (modif, message) => {
    site = await modifierJson('site.json', { version: '', beta: true, actualites: [], mises_a_jour: [] }, s => { s.actualites ||= []; modif(s); }, message);
  };

  // ---------- Panneau de gestion ----------
  const dialogue = $('gestion');
  let fichierChoisi = null, imageChoisie = null, imageRetiree = false;
  let imagesSec = [];   // [{ chemin }] déjà publiées ou [{ fichier, url }] à envoyer
  const MAX_IMAGES_SEC = 12;

  // Vérifie le jeton auprès de GitHub : valide, et droit d'écriture sur ce dépôt précis
  async function verifierJeton(jeton, proprio, depot) {
    const h = { Authorization: `Bearer ${jeton}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const u = await fetch('https://api.github.com/user', { headers: h });
    if (u.status === 401) throw new Error('Jeton refusé par GitHub (invalide ou expiré).');
    if (!u.ok) throw new Error(`GitHub ne répond pas correctement (${u.status}).`);
    const login = (await u.json()).login;
    const d = await fetch(`https://api.github.com/repos/${proprio}/${depot}`, { headers: h });
    if (d.status === 404 || d.status === 403) throw new Error(`Ce jeton n'a pas accès au dépôt ${proprio}/${depot}.`);
    if (!d.ok) throw new Error(`Impossible de vérifier le dépôt (${d.status}).`);
    if (!(await d.json()).permissions?.push) throw new Error('Ce jeton peut lire le dépôt mais pas y écrire : ajoute la permission Contents : Read and write.');
    return login;
  }

  // ---------- Affichage du panneau ----------
  function ongletPanneau(nom) {
    dialogue.querySelectorAll('.p-onglet').forEach(b => b.setAttribute('aria-selected', String(b.dataset.panneau === nom)));
    dialogue.querySelectorAll('.p-vue').forEach(v => { v.hidden = v.dataset.panneau !== nom; });
  }
  dialogue.querySelectorAll('.p-onglet').forEach(b => b.addEventListener('click', () => ongletPanneau(b.dataset.panneau)));

  function afficherPanneau() {
    const relie = !!session;
    $('panneau-onglets').hidden = !relie;
    $('changer-jeton').hidden = !relie;
    $('etat-connexion').textContent = relie ? `${compte.pseudo} (gérant) · GitHub ${session.proprio}/${session.depot}` : `${compte?.pseudo || ''} (gérant) · GitHub non relié`;
    $('etat-connexion').classList.toggle('ok', relie);
    if (relie) { ongletPanneau('element'); remplirTypes(); listeGestion(); listeActusGestion(); return; }
    ongletPanneau('connexion');
    $('c-jeton').value = '';
  }

  // Récupère le jeton GitHub rangé dans Supabase (réservé au gérant)
  async function chargerJeton() {
    const { data, error } = await sb.rpc('catalogue_jeton_lire');
    if (error) throw new Error(/reserve_gerant/.test(error.message) ? 'Réservé au gérant.' : 'Impossible de joindre la base du site.');
    if (!data) return null;
    let infos; try { infos = JSON.parse(data); } catch { infos = { jeton: data }; }
    return { proprio: 'entarsh-studio', depot: 'entarsh-studio.github.io', branche: 'main', ...infos };
  }

  $('ouvrir-gestion').addEventListener('click', async () => {
    if (!estGerant()) return;
    statut('c-statut', '');
    const btn = $('ouvrir-gestion'); btn.disabled = true;
    const pret = await preparerGestion();
    btn.disabled = false;
    if (pret) { afficherPanneau(); dialogue.showModal(); }
  });
  $('fermer-gestion').addEventListener('click', () => dialogue.close());
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });
  $('changer-jeton').addEventListener('click', () => { session = null; afficherPanneau(); $('c-jeton').focus(); });

  $('form-connexion').addEventListener('submit', async ev => {
    ev.preventDefault();
    const jeton = $('c-jeton').value.trim();
    const infos = { proprio: $('gh-proprio').value.trim(), depot: $('gh-depot').value.trim(), branche: $('gh-branche').value.trim() || 'main' };
    if (/^gh[pousr]_/.test(jeton)) return statut('c-statut', 'Ce jeton est un jeton « classique », qui donne accès à tout ton compte GitHub. Crée plutôt un jeton fine-grained limité au dépôt du site.', 'erreur');
    const bouton = $('c-valider');
    bouton.disabled = true; bouton.replaceChildren(chargeur(), ' Vérification…');
    try {
      const login = await verifierJeton(jeton, infos.proprio, infos.depot);
      const { error } = await sb.rpc('catalogue_jeton_ecrire', { p_jeton: JSON.stringify({ ...infos, jeton }) });
      if (error) throw new Error(/reserve_gerant/.test(error.message) ? 'Réservé au gérant.' : "Le jeton est valide mais n'a pas pu être enregistré.");
      session = { ...infos, jeton, login };
      afficherPanneau();
    } catch (err) { statut('c-statut', err.message, 'erreur'); }
    finally { bouton.disabled = false; bouton.textContent = 'Vérifier et enregistrer'; }
  });

  function remplirTypes() {
    $('liste-types').replaceChildren(...tousLesTypes().map(t => el('option', { value: t })));
  }
  function statut(id, txt, genre = '') {
    $(id).textContent = txt;
    $(id).className = 'statut ' + genre;
  }

  // Progression des envois
  function progression(etape, part) {
    const p = $('progression');
    if (etape === null) { p.hidden = true; return; }
    if (p.hidden) { p.querySelector('.chargeur-ici').replaceChildren(chargeur()); p.hidden = false; p.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    $('progression-etape').textContent = etape + (part != null ? ` — ${Math.round(part * 100)} %` : '');
    $('progression-barre').style.width = part != null ? `${part * 100}%` : '0';
  }

  // Zone de dépôt
  const depot = $('depot');
  function choisirFichier(f, texteActuel) {
    fichierChoisi = f || null;
    depot.classList.toggle('rempli', !!f);
    $('depot-texte').replaceChildren(...(f ? [el('b', {}, f.name), ` — ${tailleLisible(f.size)}`]
      : texteActuel ? [texteActuel] : [el('b', {}, 'Glisser le fichier ici'), ' ou cliquer pour choisir']));
    if (f && f.size > LIMITE_OCTETS) statut('f-statut', 'Fichier de plus de 95 Mo : GitHub le refusera. Mets-le dans une Release et colle le lien.', 'erreur');
    else statut('f-statut', '');
  }
  depot.addEventListener('click', () => $('f-fichier').click());
  depot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('f-fichier').click(); } });
  $('f-fichier').addEventListener('change', e => choisirFichier(e.target.files[0]));
  depot.addEventListener('dragover', e => { e.preventDefault(); depot.classList.add('survol'); });
  depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
  depot.addEventListener('drop', e => { e.preventDefault(); depot.classList.remove('survol'); choisirFichier(e.dataTransfer.files[0]); });

  // Image
  function apercu(url) {
    $('apercu-image').style.backgroundImage = url ? `url("${url}")` : '';
    $('retirer-image').hidden = !url;
  }
  $('f-image').addEventListener('change', e => {
    imageChoisie = e.target.files[0] || null;
    imageRetiree = false;
    apercu(imageChoisie ? URL.createObjectURL(imageChoisie) : null);
  });
  $('retirer-image').addEventListener('click', () => {
    imageChoisie = null; imageRetiree = true; $('f-image').value = ''; apercu(null);
  });

  function afficherImagesSec() {
    $('liste-images-sec').replaceChildren(...(imagesSec.length ? imagesSec.map((im, i) => el('div', { class: 'image-sec' },
      el('img', { src: im.url || encoderChemin(im.chemin), alt: '' }),
      im.fichier ? el('span', { class: 'image-sec-nouvelle' }, 'Nouvelle') : null,
      el('button', { type: 'button', class: 'image-sec-retirer', title: 'Retirer', 'aria-label': 'Retirer cette image',
        onclick: () => { if (im.url) URL.revokeObjectURL(im.url); imagesSec.splice(i, 1); afficherImagesSec(); } }, '✕')))
      : [el('p', { class: 'aide' }, 'Aucune image secondaire.')]));
  }
  afficherImagesSec();
  $('f-images').addEventListener('change', ev => {
    const fichiers = [...ev.target.files]; ev.target.value = '';
    const place = MAX_IMAGES_SEC - imagesSec.length;
    const trop = fichiers.filter(f => f.size > 5 * 1024 * 1024);
    for (const f of fichiers.filter(f => f.size <= 5 * 1024 * 1024).slice(0, place)) imagesSec.push({ fichier: f, url: URL.createObjectURL(f) });
    afficherImagesSec();
    if (trop.length) statut('f-statut', `${trop.length} image(s) ignorée(s) : 5 Mo maximum par image.`, 'erreur');
    else if (fichiers.length > place) statut('f-statut', `${MAX_IMAGES_SEC} images secondaires maximum.`, 'erreur');
  });

  function viderFormulaire() {
    $('formulaire').reset();
    $('f-id').value = '';
    imageChoisie = null; imageRetiree = false; apercu(null);
    imagesSec.forEach(im => im.url && URL.revokeObjectURL(im.url)); imagesSec = []; afficherImagesSec();
    choisirFichier(null);
    $('titre-formulaire').textContent = 'Ajouter un élément';
    $('f-valider').textContent = 'Publier';
    $('f-annuler').hidden = true;
  }
  $('f-annuler').addEventListener('click', () => { viderFormulaire(); statut('f-statut', ''); });

  function modifierElement(e) {
    viderFormulaire();
    $('f-id').value = e.id;
    $('f-nom').value = e.nom;
    $('f-type').value = e.type;
    $('f-version').value = e.version || '';
    $('f-auteur').value = e.auteur || '';
    $('f-description').value = e.description || '';
    $('f-lien').value = e.fichier?.url || '';
    choisirFichier(null, e.fichier?.chemin ? `Fichier actuel : ${e.fichier.nom} (déposer pour remplacer)` : null);
    if (e.image) apercu(encoderChemin(e.image));
    imagesSec = (e.images || []).map(chemin => ({ chemin })); afficherImagesSec();
    $('titre-formulaire').textContent = `Modifier « ${e.nom} »`;
    $('f-valider').textContent = 'Enregistrer';
    $('f-annuler').hidden = false;
    $('formulaire').scrollIntoView({ behavior: 'smooth' });
  }

  async function supprimerElement(e) {
    if (!confirm(`Supprimer « ${e.nom} » du catalogue et ses fichiers ?`)) return false;
    try {
      progression('Suppression…');
      await modifierCatalogue(c => { c.elements = c.elements.filter(x => x.id !== e.id); }, `Catalogue : suppression de ${e.nom}`);
      if (e.fichier?.chemin) await supprimer(e.fichier.chemin, `Suppression du fichier de ${e.nom}`);
      if (e.image) await supprimer(e.image, `Suppression de l'image de ${e.nom}`);
      for (const c of e.images || []) await supprimer(c, `Suppression d'une image de ${e.nom}`).catch(() => {});
      if ($('f-id').value === e.id) viderFormulaire();
      afficher(); listeGestion(); remplirTypes();
      statut('f-statut', `« ${e.nom} » supprimé. Le site public se met à jour d'ici une minute.`, 'ok');
      return true;
    } catch (err) { statut('f-statut', err.message, 'erreur'); return false; }
    finally { progression(null); }
  }

  function ligneGestion(texte, detail, actions) {
    return el('li', {}, el('span', {}, texte, el('small', {}, detail)),
      el('div', {}, ...actions.map(([nom, fn]) => el('button', { class: 'lien-discret', type: 'button', onclick: fn }, nom))));
  }
  function listeGestion() {
    const ul = $('liste-gestion');
    ul.replaceChildren(...(catalogue.elements.length
      ? catalogue.elements.map(e => ligneGestion(e.nom, e.type, [['Modifier', () => modifierElement(e)], ['Supprimer', () => supprimerElement(e)]]))
      : [el('li', {}, el('span', {}, 'Aucun élément.'))]));
  }

  $('formulaire').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id = $('f-id').value || nouvelId();
    const ancien = catalogue.elements.find(x => x.id === id);
    const nom = $('f-nom').value.trim();
    const type = $('f-type').value.trim();
    const lien = $('f-lien').value.trim();

    if (!fichierChoisi && !lien && !ancien?.fichier) return statut('f-statut', 'Ajoute un fichier ou un lien externe.', 'erreur');
    if (fichierChoisi && fichierChoisi.size > LIMITE_OCTETS) return statut('f-statut', 'Fichier trop lourd pour le dépôt : utilise un lien externe.', 'erreur');
    if (imageChoisie && imageChoisie.size > 5 * 1024 * 1024) return statut('f-statut', 'Image trop lourde (5 Mo maximum).', 'erreur');

    const bouton = $('f-valider');
    bouton.disabled = true;
    statut('f-statut', '');
    try {
      const dossier = `fichiers/${slug(nom)}-${id}`;
      let fichier = ancien?.fichier || null;
      const aSupprimer = [];

      if (fichierChoisi) {
        progression(`Préparation de ${fichierChoisi.name}`);
        const chemin = `${dossier}/${fichierChoisi.name}`;
        const [existant, contenu] = await Promise.all([lire(chemin), fichierVersBase64(fichierChoisi)]);
        await ecrire(chemin, contenu, `Fichier : ${nom}`, existant?.sha, p => progression(`Envoi de ${fichierChoisi.name}`, p));
        if (ancien?.fichier?.chemin && ancien.fichier.chemin !== chemin) aSupprimer.push(ancien.fichier.chemin);
        fichier = { chemin, nom: fichierChoisi.name, taille: fichierChoisi.size };
      } else if (lien) {
        if (ancien?.fichier?.chemin) aSupprimer.push(ancien.fichier.chemin);
        fichier = { url: lien, nom: decodeURIComponent(lien.split('/').pop().split('?')[0]) || 'Lien' };
      }

      let cheminImage = ancien?.image || null;
      if (imageChoisie) {
        progression('Envoi de l\'image');
        const ext = (imageChoisie.name.split('.').pop() || 'png').toLowerCase();
        const nouveau = `images/${id}.${ext}`;
        const [existant, contenu] = await Promise.all([lire(nouveau), fichierVersBase64(imageChoisie)]);
        await ecrire(nouveau, contenu, `Image : ${nom}`, existant?.sha, p => progression('Envoi de l\'image', p));
        if (cheminImage && cheminImage !== nouveau) aSupprimer.push(cheminImage);
        cheminImage = nouveau;
      } else if (imageRetiree && cheminImage) {
        aSupprimer.push(cheminImage);
        cheminImage = null;
      }

      // Images secondaires : envoi des nouvelles, suppression des retirées
      const cheminsSec = [];
      const aEnvoyer = imagesSec.filter(im => im.fichier);
      let n = 0;
      for (const im of imagesSec) {
        if (im.chemin) { cheminsSec.push(im.chemin); continue; }
        n++;
        const ext = (im.fichier.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const chemin = `images/${id}-${Date.now().toString(36)}${n}.${ext}`;
        const etape = `Envoi des images secondaires (${n}/${aEnvoyer.length})`;
        progression(etape);
        await ecrire(chemin, await fichierVersBase64(im.fichier), `Image secondaire : ${nom}`, null, p => progression(etape, p));
        cheminsSec.push(chemin);
      }
      for (const c of ancien?.images || []) if (!cheminsSec.includes(c)) aSupprimer.push(c);

      progression('Mise à jour du catalogue');
      const maintenant = new Date().toISOString();
      const element = {
        id, nom, type,
        version: $('f-version').value.trim(),
        auteur: $('f-auteur').value.trim(),
        description: $('f-description').value.trim(),
        fichier, image: cheminImage, images: cheminsSec,
        ajoute_le: ancien?.ajoute_le || maintenant,
        modifie_le: maintenant,
      };
      await modifierCatalogue(c => {
        const i = c.elements.findIndex(x => x.id === id);
        if (i >= 0) c.elements[i] = element; else c.elements.push(element);
        if (!c.types.includes(type)) c.types.push(type);
      }, `Catalogue : ${ancien ? 'modification' : 'ajout'} de ${nom}`);

      for (const p of aSupprimer) await supprimer(p, `Remplacement d'un fichier de ${nom}`).catch(() => {});

      afficher(); listeGestion(); remplirTypes(); rafraichirFiche(true);
      viderFormulaire();
      statut('f-statut', `« ${nom} » publié. Visible par tous d'ici une minute (le temps que GitHub Pages se mette à jour).`, 'ok');
    } catch (err) {
      statut('f-statut', err.message, 'erreur');
    } finally {
      progression(null);
      bouton.disabled = false;
    }
  });

  // ---------- Actualités (gestion) ----------
  function listeActusGestion() {
    const actus = [...(site.actualites || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('liste-actus-gestion').replaceChildren(...(actus.length
      ? actus.map(a => ligneGestion(a.titre, dateLisible(a.date), [['Supprimer', () => supprimerActu(a)]]))
      : [el('li', {}, el('span', {}, 'Aucune actualité.'))]));
  }
  async function supprimerActu(a) {
    if (!confirm(`Supprimer l'actualité « ${a.titre} » ?`)) return;
    try {
      await modifierSite(s => { s.actualites = s.actualites.filter(x => (x.id || x.titre) !== (a.id || a.titre)); }, `Actualité supprimée : ${a.titre}`);
      afficherSite();
      statut('a-statut', 'Actualité supprimée.', 'ok');
    } catch (err) { statut('a-statut', err.message, 'erreur'); }
  }
  $('form-actu').addEventListener('submit', async ev => {
    ev.preventDefault();
    const bouton = $('a-valider');
    const titre = $('a-titre').value.trim(), texte = $('a-texte').value.trim();
    bouton.disabled = true;
    bouton.replaceChildren(chargeur(), ' Publication…');
    try {
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await modifierSite(s => { s.actualites.push({ id: nouvelId(), date, titre, texte }); }, `Actualité : ${titre}`);
      afficherSite();
      $('form-actu').reset();
      statut('a-statut', 'Actualité publiée. Visible par tous d\'ici une minute.', 'ok');
    } catch (err) { statut('a-statut', err.message, 'erreur'); }
    finally { bouton.disabled = false; bouton.textContent = 'Publier l\'actualité'; }
  });

  // ---------- Démarrage ----------
  let affichageMemorise = false;
  try { affichageMemorise = localStorage.getItem(CLE_AFFICHAGE) !== null; } catch {}
  if (matchMedia('(max-width: 820px)').matches && !affichageMemorise) criteres.filtres = false;
  $('crit-par-page').value = String(criteres.parPage);
  appliquerFiltresVisibles(); appliquerVue();
  ['cp-mdp', 'cp-mdp2', 'pf-mdp', 'pf-mdp2', 'c-jeton'].forEach(id => ajouterOeil($(id)));
  changerVue();
  charger();
})();
