/* Entarsh Catalogue : affichage du catalogue + gestion (dépôt via l'API GitHub). */
(() => {
  const COULEURS = ['#8b00ff', '#ffe000', '#ff0000', '#e600ff', '#40ff00', '#00a3ff', '#00ff95', '#ff0080', '#ff8a00'];
  const TYPES_DE_BASE = ['Jeu vidéo', 'Éditeur', 'Logiciel', 'Outil'];
  const LIMITE_OCTETS = 95 * 1024 * 1024; // GitHub refuse les fichiers de plus de 100 Mo
  const CLE_REGLAGES = 'entarsh-catalogue-github';

  const $ = id => document.getElementById(id);
  let catalogue = { version: 1, types: [], elements: [] };
  let filtreType = null;

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
  function couleurType(type) {
    let h = 0;
    for (const ch of type) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return COULEURS[h % COULEURS.length];
  }
  function taillLisible(o) {
    if (!o) return '';
    const u = ['o', 'Ko', 'Mo', 'Go'];
    let i = 0;
    while (o >= 1024 && i < u.length - 1) { o /= 1024; i++; }
    return (i ? o.toFixed(1).replace('.', ',') : o) + ' ' + u[i];
  }
  const normaliser = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = s => normaliser(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'element';
  const encoderChemin = p => p.split('/').map(encodeURIComponent).join('/');
  const tousLesTypes = () => [...new Set([...TYPES_DE_BASE, ...catalogue.types, ...catalogue.elements.map(e => e.type)])];

  // ---------- Affichage public ----------
  async function charger() {
    try {
      const r = await fetch('catalogue.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(r.status);
      catalogue = await r.json();
      catalogue.types ||= [];
      catalogue.elements ||= [];
    } catch {
      $('etat').textContent = 'Impossible de charger le catalogue.';
      return;
    }
    afficher();
  }

  function afficher() {
    // Filtres : seulement les types réellement présents
    const presents = [...new Set(catalogue.elements.map(e => e.type))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (filtreType && !presents.includes(filtreType)) filtreType = null;
    const zone = $('filtres');
    zone.replaceChildren(
      ...[null, ...presents].map(t => el('button', {
        class: 'puce', type: 'button', 'aria-pressed': String(t === filtreType),
        onclick: () => { filtreType = t; afficher(); },
      }, t ?? 'Tout'))
    );
    zone.hidden = presents.length < 2;

    const q = normaliser($('recherche').value.trim());
    const liste = catalogue.elements
      .filter(e => !filtreType || e.type === filtreType)
      .filter(e => !q || normaliser(`${e.nom} ${e.type} ${e.description}`).includes(q))
      .sort((a, b) => (b.modifie_le || '').localeCompare(a.modifie_le || ''));

    $('grille').replaceChildren(...liste.map(carte));
    $('etat').textContent = catalogue.elements.length === 0 ? 'Le catalogue est vide pour le moment.'
      : liste.length === 0 ? 'Aucun résultat.' : '';
    $('etat').hidden = !$('etat').textContent;
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
        e.description ? el('p', {}, e.description) : el('p'),
        href ? el('a', { class: 'telecharger', href, download: f.url ? null : (f.nom || '') , rel: f.url ? 'noopener' : null },
          'Télécharger', el('span', {}, [f.nom, taillLisible(f.taille)].filter(Boolean).join(' · '))) : null));
  }

  $('recherche').addEventListener('input', afficher);

  // ---------- API GitHub ----------
  function reglages() {
    try { return JSON.parse(localStorage.getItem(CLE_REGLAGES)) || {}; } catch { return {}; }
  }
  async function gh(chemin, options = {}) {
    const r = reglages();
    if (!r.jeton) throw new Error('Renseignez d\'abord le jeton GitHub (Connexion GitHub).');
    const url = `https://api.github.com/repos/${r.proprio}/${r.depot}/contents/${encoderChemin(chemin)}`;
    const rep = await fetch(url + (options.method ? '' : `?ref=${encodeURIComponent(r.branche)}`), {
      ...options,
      headers: {
        Authorization: `Bearer ${r.jeton}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (rep.status === 404 && !options.method) return null;
    if (!rep.ok) {
      let msg = rep.status;
      try { msg = (await rep.json()).message || msg; } catch {}
      if (rep.status === 401) msg = 'jeton refusé (expiré ou invalide)';
      if (rep.status === 403 || rep.status === 404) msg += ' — vérifiez le dépôt et la permission Contents du jeton';
      const err = new Error(`GitHub : ${msg}`); err.status = rep.status; throw err;
    }
    return rep.status === 204 ? null : rep.json();
  }
  async function ecrire(chemin, base64, message, sha) {
    const { branche } = reglages();
    return gh(chemin, { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: branche, ...(sha ? { sha } : {}) }) });
  }
  async function supprimer(chemin, message) {
    const info = await gh(chemin);
    if (!info) return;
    await gh(chemin, { method: 'DELETE', body: JSON.stringify({ message, sha: info.sha, branch: reglages().branche }) });
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

  // Relit catalogue.json depuis GitHub, applique la modification, le réécrit (1 nouvel essai si conflit)
  async function modifierCatalogue(modif, message) {
    for (let essai = 0; essai < 2; essai++) {
      const info = await gh('catalogue.json');
      const actuel = info ? JSON.parse(base64VersTexte(info.content)) : { version: 1, types: [], elements: [] };
      actuel.types ||= []; actuel.elements ||= [];
      modif(actuel);
      try {
        await ecrire('catalogue.json', texteVersBase64(JSON.stringify(actuel, null, 1) + '\n'), message, info?.sha);
        catalogue = actuel;
        return;
      } catch (e) { if (e.status !== 409 || essai) throw e; }
    }
  }

  // ---------- Panneau de gestion ----------
  const dialogue = $('gestion');
  let fichierChoisi = null;

  $('ouvrir-gestion').addEventListener('click', () => {
    const r = reglages();
    if (r.proprio) $('gh-proprio').value = r.proprio;
    if (r.depot) $('gh-depot').value = r.depot;
    if (r.branche) $('gh-branche').value = r.branche;
    $('gh-jeton').value = r.jeton || '';
    $('reglages').open = !r.jeton;
    remplirTypes();
    listeGestion();
    dialogue.showModal();
  });

  $('gh-enregistrer').addEventListener('click', () => {
    localStorage.setItem(CLE_REGLAGES, JSON.stringify({
      proprio: $('gh-proprio').value.trim(), depot: $('gh-depot').value.trim(),
      branche: $('gh-branche').value.trim() || 'main', jeton: $('gh-jeton').value.trim(),
    }));
    $('reglages').open = false;
    statut('Connexion enregistrée.', 'ok');
  });
  $('gh-oublier').addEventListener('click', () => {
    const r = reglages(); delete r.jeton;
    localStorage.setItem(CLE_REGLAGES, JSON.stringify(r));
    $('gh-jeton').value = '';
    statut('Jeton effacé de ce navigateur.', 'ok');
  });

  function remplirTypes() {
    $('liste-types').replaceChildren(...tousLesTypes().map(t => el('option', { value: t })));
  }
  function statut(txt, genre = '') {
    $('f-statut').textContent = txt;
    $('f-statut').className = 'statut ' + genre;
  }

  // Zone de dépôt
  const depot = $('depot');
  function choisirFichier(f) {
    fichierChoisi = f || null;
    $('depot-texte').textContent = f ? `${f.name} — ${taillLisible(f.size)}` : 'Glisser le fichier ici ou choisir';
    if (f && f.size > LIMITE_OCTETS) statut('Fichier de plus de 95 Mo : GitHub le refusera. Mettez-le dans une Release et collez le lien.', 'erreur');
    else statut('');
  }
  depot.addEventListener('click', () => $('f-fichier').click());
  depot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('f-fichier').click(); } });
  $('f-fichier').addEventListener('change', e => choisirFichier(e.target.files[0]));
  depot.addEventListener('dragover', e => { e.preventDefault(); depot.classList.add('survol'); });
  depot.addEventListener('dragleave', () => depot.classList.remove('survol'));
  depot.addEventListener('drop', e => { e.preventDefault(); depot.classList.remove('survol'); choisirFichier(e.dataTransfer.files[0]); });

  function viderFormulaire() {
    $('formulaire').reset();
    $('f-id').value = '';
    choisirFichier(null);
    $('titre-formulaire').textContent = 'Ajouter un élément';
    $('f-valider').textContent = 'Publier';
    $('f-annuler').hidden = true;
  }
  $('f-annuler').addEventListener('click', () => { viderFormulaire(); statut(''); });

  function modifierElement(e) {
    $('f-id').value = e.id;
    $('f-nom').value = e.nom;
    $('f-type').value = e.type;
    $('f-version').value = e.version || '';
    $('f-description').value = e.description || '';
    $('f-lien').value = e.fichier?.url || '';
    choisirFichier(null);
    $('depot-texte').textContent = e.fichier?.chemin ? `Fichier actuel : ${e.fichier.nom} (déposer pour remplacer)` : 'Glisser le fichier ici ou choisir';
    $('titre-formulaire').textContent = `Modifier « ${e.nom} »`;
    $('f-valider').textContent = 'Enregistrer';
    $('f-annuler').hidden = false;
    $('formulaire').scrollIntoView({ behavior: 'smooth' });
  }

  async function supprimerElement(e) {
    if (!confirm(`Supprimer « ${e.nom} » du catalogue et ses fichiers ?`)) return;
    try {
      statut('Suppression…');
      await modifierCatalogue(c => { c.elements = c.elements.filter(x => x.id !== e.id); }, `Catalogue : suppression de ${e.nom}`);
      if (e.fichier?.chemin) await supprimer(e.fichier.chemin, `Suppression du fichier de ${e.nom}`);
      if (e.image) await supprimer(e.image, `Suppression de l'image de ${e.nom}`);
      if ($('f-id').value === e.id) viderFormulaire();
      afficher(); listeGestion(); remplirTypes();
      statut(`« ${e.nom} » supprimé. Le site public se met à jour d'ici une minute.`, 'ok');
    } catch (err) { statut(err.message, 'erreur'); }
  }

  function listeGestion() {
    const ul = $('liste-gestion');
    if (!catalogue.elements.length) { ul.replaceChildren(el('li', {}, el('span', {}, 'Aucun élément.'))); return; }
    ul.replaceChildren(...catalogue.elements.map(e => el('li', {},
      el('span', {}, e.nom, el('small', {}, e.type)),
      el('div', {},
        el('button', { class: 'bouton-discret', type: 'button', onclick: () => modifierElement(e) }, 'Modifier'),
        el('button', { class: 'bouton-discret', type: 'button', onclick: () => supprimerElement(e) }, 'Supprimer')))));
  }

  $('formulaire').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id = $('f-id').value || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const ancien = catalogue.elements.find(x => x.id === id);
    const nom = $('f-nom').value.trim();
    const type = $('f-type').value.trim();
    const lien = $('f-lien').value.trim();
    const image = $('f-image').files[0];

    if (!fichierChoisi && !lien && !ancien?.fichier) return statut('Ajoutez un fichier ou un lien externe.', 'erreur');
    if (fichierChoisi && fichierChoisi.size > LIMITE_OCTETS) return statut('Fichier trop lourd pour le dépôt : utilisez un lien externe.', 'erreur');
    if (image && image.size > 5 * 1024 * 1024) return statut('Image trop lourde (5 Mo maximum).', 'erreur');

    const bouton = $('f-valider');
    bouton.disabled = true;
    try {
      const dossier = `fichiers/${slug(nom)}-${id}`;
      let fichier = ancien?.fichier || null;
      const aSupprimer = [];

      if (fichierChoisi) {
        statut(`Envoi de ${fichierChoisi.name} (${taillLisible(fichierChoisi.size)})…`);
        const chemin = `${dossier}/${fichierChoisi.name}`;
        const existant = await gh(chemin);
        await ecrire(chemin, await fichierVersBase64(fichierChoisi), `Fichier : ${nom}`, existant?.sha);
        if (ancien?.fichier?.chemin && ancien.fichier.chemin !== chemin) aSupprimer.push(ancien.fichier.chemin);
        fichier = { chemin, nom: fichierChoisi.name, taille: fichierChoisi.size };
      } else if (lien) {
        if (ancien?.fichier?.chemin) aSupprimer.push(ancien.fichier.chemin);
        fichier = { url: lien, nom: decodeURIComponent(lien.split('/').pop().split('?')[0]) || 'Lien' };
      }

      let cheminImage = ancien?.image || null;
      if (image) {
        statut('Envoi de l\'image…');
        const ext = (image.name.split('.').pop() || 'png').toLowerCase();
        const nouveau = `images/${id}.${ext}`;
        const existant = await gh(nouveau);
        await ecrire(nouveau, await fichierVersBase64(image), `Image : ${nom}`, existant?.sha);
        if (cheminImage && cheminImage !== nouveau) aSupprimer.push(cheminImage);
        cheminImage = nouveau;
      }

      statut('Mise à jour du catalogue…');
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
      statut(`« ${nom} » publié. Visible par tous d'ici une minute (le temps que GitHub Pages se mette à jour).`, 'ok');
    } catch (err) {
      statut(err.message, 'erreur');
    } finally {
      bouton.disabled = false;
    }
  });

  charger();
})();
