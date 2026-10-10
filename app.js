/* Entarsh Catalogue : catalogue, actualités, mises à jour + gestion (dépôt via l'API GitHub). */
(() => {
  const COULEURS = ['#8b00ff', '#ffe000', '#ff0000', '#e600ff', '#40ff00', '#00a3ff', '#00ff95', '#ff0080', '#ff8a00'];
  const TYPES_DE_BASE = ['Jeu vidéo', 'Éditeur', 'Logiciel', 'Outil'];
  const LIMITE_OCTETS = 95 * 1024 * 1024; // GitHub refuse les fichiers de plus de 100 Mo
  const CLE_COFFRE = 'entarsh-catalogue-coffre';   // jeton chiffré (AES-GCM) + infos du dépôt
  const DELAI_VERROU = 30 * 60 * 1000;             // verrouillage après 30 min sans activité
  try { localStorage.removeItem('entarsh-catalogue-github'); } catch {} // ancien stockage en clair (v0.1–0.2)
  const VUES = ['catalogue', 'actualites', 'mises-a-jour'];

  const $ = id => document.getElementById(id);
  let catalogue = { version: 1, types: [], elements: [] };
  let site = { version: '', beta: true, actualites: [], mises_a_jour: [] };
  const criteres = { types: new Set(), tri: 'ajout', periode: 0 };

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
    const vue = VUES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'catalogue';
    for (const v of VUES) $('vue-' + v).hidden = v !== vue;
    document.querySelectorAll('.onglet').forEach(o => {
      if (o.dataset.vue === vue) o.setAttribute('aria-current', 'page'); else o.removeAttribute('aria-current');
    });
    $('criteres').hidden = vue !== 'catalogue';
  }
  addEventListener('hashchange', changerVue);

  // ---------- Chargement ----------
  async function charger() {
    $('etat').replaceChildren(chargeur(true), el('span', {}, 'Chargement du catalogue…'));
    const lire = async f => { const r = await fetch(f, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return r.json(); };
    const [cat, inf] = await Promise.allSettled([lire('catalogue.json'), lire('site.json')]);
    if (inf.status === 'fulfilled') site = { ...site, ...inf.value };
    afficherSite();
    if (cat.status !== 'fulfilled') { $('etat').textContent = 'Impossible de charger le catalogue.'; return; }
    catalogue = { types: [], elements: [], ...cat.value };
    afficher();
  }

  // ---------- Critères ----------
  function afficherCriteres() {
    const comptes = {};
    for (const e of catalogue.elements) comptes[e.type] = (comptes[e.type] || 0) + 1;
    const types = Object.keys(comptes).sort((a, b) => a.localeCompare(b, 'fr'));
    for (const t of [...criteres.types]) if (!comptes[t]) criteres.types.delete(t);
    $('crit-types').replaceChildren(...(types.length ? types.map(t => el('label', { class: 'crit-type' },
      el('input', { type: 'checkbox', ...(criteres.types.has(t) ? { checked: '' } : {}),
        onchange: ev => { ev.target.checked ? criteres.types.add(t) : criteres.types.delete(t); afficher(); } }),
      el('span', { class: 'pastille', style: `background:${couleurType(t)}` }),
      t, el('small', {}, String(comptes[t]))))
      : [el('p', { class: 'crit-vide' }, 'Aucun type pour le moment.')]));
  }
  $('crit-tri').addEventListener('change', e => { criteres.tri = e.target.value; afficher(); });
  $('crit-periode').addEventListener('change', e => { criteres.periode = +e.target.value; afficher(); });
  $('crit-reset').addEventListener('click', () => {
    criteres.types.clear(); criteres.tri = 'ajout'; criteres.periode = 0;
    $('crit-tri').value = 'ajout'; $('crit-periode').value = '0'; $('recherche').value = '';
    afficher();
  });
  $('recherche').addEventListener('input', () => afficher());

  // ---------- Catalogue ----------
  function afficher() {
    afficherCriteres();
    const q = normaliser($('recherche').value.trim());
    const limite = criteres.periode ? Date.now() - criteres.periode * 864e5 : 0;
    const tris = {
      ajout: (a, b) => (b.ajoute_le || '').localeCompare(a.ajoute_le || ''),
      maj: (a, b) => (b.modifie_le || '').localeCompare(a.modifie_le || ''),
      nom: (a, b) => a.nom.localeCompare(b.nom, 'fr'),
      'nom-inv': (a, b) => b.nom.localeCompare(a.nom, 'fr'),
    };
    const liste = catalogue.elements
      .filter(e => !criteres.types.size || criteres.types.has(e.type))
      .filter(e => !limite || new Date(e.ajoute_le).getTime() >= limite)
      .filter(e => !q || normaliser(`${e.nom} ${e.type} ${e.description}`).includes(q))
      .sort(tris[criteres.tri]);

    $('compte').textContent = catalogue.elements.length || '';
    $('grille').replaceChildren(...liste.map(carte));
    $('etat').textContent = catalogue.elements.length === 0 ? 'Le catalogue est vide pour le moment.'
      : liste.length === 0 ? 'Aucun résultat avec ces critères.' : '';
  }

  function carte(e) {
    const coul = couleurType(e.type);
    const image = e.image
      ? el('img', { src: encoderChemin(e.image), alt: '', loading: 'lazy' })
      : el('div', { class: 'initiale', style: `background:${coul}` }, (e.nom || '?').trim().charAt(0).toUpperCase());
    const f = e.fichier || {};
    const href = f.url || (f.chemin ? encoderChemin(f.chemin) : null);
    return el('article', { class: 'carte' },
      el('div', { class: 'carte-image' }, image),
      el('div', { class: 'carte-corps' },
        el('div', { class: 'carte-haut' },
          el('h2', {}, e.nom),
          e.version ? el('span', { class: 'version' }, 'v' + e.version.replace(/^v/i, '')) : null),
        el('span', { class: 'type', style: `background:${coul}` }, e.type),
        el('p', {}, e.description || ''),
        href ? el('a', { class: 'telecharger', href, download: f.url ? null : (f.nom || ''), rel: f.url ? 'noopener' : null },
          'Télécharger', el('span', {}, [f.nom, tailleLisible(f.taille)].filter(Boolean).join(' · '))) : null));
  }

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

  // ---------- Actualités & mises à jour ----------
  function afficherSite() {
    $('version-site').textContent = site.version || '—';
    const actus = [...(site.actualites || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    $('liste-actus').replaceChildren(...(actus.length ? actus.map(a => el('article', { class: 'actu' },
      el('time', { datetime: a.date }, dateLisible(a.date)), el('h3', {}, a.titre), el('p', {}, a.texte)))
      : [el('p', { class: 'etat' }, 'Aucune actualité pour le moment.')]));
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
    if (!r.jeton) throw new Error('La gestion est verrouillée : reconnecte-toi.');
    activite();
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

  // ---------- Coffre : chiffrement du jeton avec le mot de passe (WebCrypto) ----------
  const b64 = o => btoa(String.fromCharCode(...new Uint8Array(o)));
  const deB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  async function cleDepuis(mdp, sel) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(mdp), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: 310000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  function coffre() {
    try { return JSON.parse(localStorage.getItem(CLE_COFFRE)); } catch { return null; }
  }
  async function enfermer(infos, jeton, mdp) {
    const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cleDepuis(mdp, sel), new TextEncoder().encode(jeton));
    localStorage.setItem(CLE_COFFRE, JSON.stringify({ ...infos, sel: b64(sel), iv: b64(iv), chiffre: b64(chiffre) }));
  }
  async function ouvrir(mdp) {
    const c = coffre();
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(c.iv) }, await cleDepuis(mdp, deB64(c.sel)), deB64(c.chiffre));
    return { proprio: c.proprio, depot: c.depot, branche: c.branche, login: c.login, jeton: new TextDecoder().decode(clair) };
  }

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

  // ---------- Verrouillage automatique ----------
  let minuteur = null;
  function activite() {
    if (!session) return;
    clearTimeout(minuteur);
    minuteur = setTimeout(() => verrouiller('Gestion verrouillée après 30 minutes sans activité.'), DELAI_VERROU);
  }
  function verrouiller(message) {
    session = null;
    clearTimeout(minuteur);
    afficherPanneau();
    if (message) statut('d-statut', message, 'erreur');
  }
  dialogue.addEventListener('input', activite);
  dialogue.addEventListener('click', activite);

  // ---------- Affichage du panneau selon l'état de connexion ----------
  function ongletPanneau(nom) {
    document.querySelectorAll('.p-onglet').forEach(b => b.setAttribute('aria-selected', String(b.dataset.panneau === nom)));
    document.querySelectorAll('.p-vue').forEach(v => { v.hidden = v.dataset.panneau !== nom; });
  }
  document.querySelectorAll('.p-onglet').forEach(b => b.addEventListener('click', () => ongletPanneau(b.dataset.panneau)));

  function afficherPanneau() {
    const connecte = !!session, c = coffre();
    $('panneau-onglets').hidden = !connecte;
    $('verrouiller').hidden = !connecte;
    $('etat-connexion').textContent = connecte ? `Connecté en tant que ${session.login} · ${session.proprio}/${session.depot}`
      : c ? 'Verrouillé' : 'Non connecté';
    $('etat-connexion').classList.toggle('ok', connecte);
    if (connecte) {
      ongletPanneau('element');
      remplirTypes(); listeGestion(); listeActusGestion();
      return;
    }
    ongletPanneau('connexion');
    $('form-deverrouiller').hidden = !c;
    $('form-connexion').hidden = !!c;
    if (c) $('d-info').textContent = `Connexion enregistrée sur cet appareil pour ${c.login} (${c.proprio}/${c.depot}). Entre ton mot de passe pour continuer.`;
    for (const id of ['d-mdp', 'c-jeton', 'c-mdp', 'c-mdp2']) $(id).value = '';
  }

  $('ouvrir-gestion').addEventListener('click', () => {
    afficherPanneau();
    statut('d-statut', ''); statut('c-statut', '');
    dialogue.showModal();
    (session ? null : $(coffre() ? 'd-mdp' : 'c-jeton'))?.focus();
  });
  $('fermer-gestion').addEventListener('click', () => dialogue.close());
  dialogue.addEventListener('click', e => { if (e.target === dialogue) dialogue.close(); });
  $('verrouiller').addEventListener('click', () => verrouiller());

  // Première connexion
  $('form-connexion').addEventListener('submit', async ev => {
    ev.preventDefault();
    const jeton = $('c-jeton').value.trim(), mdp = $('c-mdp').value;
    const infos = { proprio: $('gh-proprio').value.trim(), depot: $('gh-depot').value.trim(), branche: $('gh-branche').value.trim() || 'main' };
    if (mdp !== $('c-mdp2').value) return statut('c-statut', 'Les deux mots de passe ne sont pas identiques.', 'erreur');
    if (mdp.length < 8) return statut('c-statut', 'Mot de passe trop court (8 caractères minimum).', 'erreur');
    if (/^gh[pousr]_/.test(jeton)) return statut('c-statut', 'Ce jeton est un jeton « classique », qui donne accès à tout ton compte. Crée plutôt un jeton fine-grained limité au dépôt du site.', 'erreur');
    const bouton = $('c-valider');
    bouton.disabled = true; bouton.replaceChildren(chargeur(), ' Vérification…');
    try {
      infos.login = await verifierJeton(jeton, infos.proprio, infos.depot);
      await enfermer(infos, jeton, mdp);
      session = { ...infos, jeton };
      activite();
      afficherPanneau();
    } catch (err) { statut('c-statut', err.message, 'erreur'); }
    finally { bouton.disabled = false; bouton.textContent = 'Vérifier et se connecter'; }
  });

  // Déverrouillage (avec pause après 5 essais ratés)
  let essaisRates = 0, bloqueJusqua = 0;
  $('form-deverrouiller').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (Date.now() < bloqueJusqua) return statut('d-statut', `Trop d'essais. Réessaie dans ${Math.ceil((bloqueJusqua - Date.now()) / 1000)} s.`, 'erreur');
    const bouton = $('d-valider');
    bouton.disabled = true; bouton.replaceChildren(chargeur(), ' Déverrouillage…');
    try {
      let s;
      try { s = await ouvrir($('d-mdp').value); }
      catch {
        if (++essaisRates >= 5) { essaisRates = 0; bloqueJusqua = Date.now() + 30000; }
        throw new Error('Mot de passe incorrect.');
      }
      essaisRates = 0;
      await verifierJeton(s.jeton, s.proprio, s.depot).catch(e => { throw new Error(e.message + ' Utilise un autre jeton.'); });
      session = s;
      activite();
      afficherPanneau();
    } catch (err) { statut('d-statut', err.message, 'erreur'); }
    finally { bouton.disabled = false; bouton.textContent = 'Déverrouiller'; }
  });
  $('d-oublier').addEventListener('click', () => {
    if (!confirm('Effacer la connexion enregistrée sur cet appareil ?')) return;
    localStorage.removeItem(CLE_COFFRE);
    verrouiller();
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

  function viderFormulaire() {
    $('formulaire').reset();
    $('f-id').value = '';
    imageChoisie = null; imageRetiree = false; apercu(null);
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
    $('f-description').value = e.description || '';
    $('f-lien').value = e.fichier?.url || '';
    choisirFichier(null, e.fichier?.chemin ? `Fichier actuel : ${e.fichier.nom} (déposer pour remplacer)` : null);
    if (e.image) apercu(encoderChemin(e.image));
    $('titre-formulaire').textContent = `Modifier « ${e.nom} »`;
    $('f-valider').textContent = 'Enregistrer';
    $('f-annuler').hidden = false;
    $('formulaire').scrollIntoView({ behavior: 'smooth' });
  }

  async function supprimerElement(e) {
    if (!confirm(`Supprimer « ${e.nom} » du catalogue et ses fichiers ?`)) return;
    try {
      progression('Suppression…');
      await modifierCatalogue(c => { c.elements = c.elements.filter(x => x.id !== e.id); }, `Catalogue : suppression de ${e.nom}`);
      if (e.fichier?.chemin) await supprimer(e.fichier.chemin, `Suppression du fichier de ${e.nom}`);
      if (e.image) await supprimer(e.image, `Suppression de l'image de ${e.nom}`);
      if ($('f-id').value === e.id) viderFormulaire();
      afficher(); listeGestion(); remplirTypes();
      statut('f-statut', `« ${e.nom} » supprimé. Le site public se met à jour d'ici une minute.`, 'ok');
    } catch (err) { statut('f-statut', err.message, 'erreur'); }
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

      progression('Mise à jour du catalogue');
      const maintenant = new Date().toISOString();
      const element = {
        id, nom, type,
        version: $('f-version').value.trim(),
        description: $('f-description').value.trim(),
        fichier, image: cheminImage,
        ajoute_le: ancien?.ajoute_le || maintenant,
        modifie_le: maintenant,
      };
      await modifierCatalogue(c => {
        const i = c.elements.findIndex(x => x.id === id);
        if (i >= 0) c.elements[i] = element; else c.elements.push(element);
        if (!c.types.includes(type)) c.types.push(type);
      }, `Catalogue : ${ancien ? 'modification' : 'ajout'} de ${nom}`);

      for (const p of aSupprimer) await supprimer(p, `Remplacement d'un fichier de ${nom}`).catch(() => {});

      afficher(); listeGestion(); remplirTypes();
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
  if (matchMedia('(max-width: 820px)').matches) $('criteres').open = false;
  changerVue();
  charger();
})();
