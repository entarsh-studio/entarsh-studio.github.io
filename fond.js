/* Fond d'écran : grille de gros carrés fixes. Deux motifs au choix :
   - « carres » : les carrés s'allument (serpents + motifs) ;
   - « tetris » : des pièces tombent, les lignes pleines clignotent en blanc puis disparaissent,
     et quand tout est plein, la grille se vide et la partie recommence. */
(() => {
  const toile = document.getElementById('fond');
  const ctx = toile.getContext('2d');
  const COULEURS = ['#8b00ff', '#ffe000', '#ff0000', '#e600ff', '#40ff00', '#00a3ff', '#00ff95', '#ff0080', '#ff8a00'];
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CLE = 'entarsh-catalogue-fond';
  let mode = 'carres';
  try { if (['carres', 'tetris'].includes(localStorage.getItem(CLE))) mode = localStorage.getItem(CLE); } catch {}

  let taille, ecart, cols, lignes, ox, oy, dpr = 1, temps = 0;
  const hasard = n => Math.floor(Math.random() * n);

  function dimensionner() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const l = innerWidth, h = innerHeight;
    toile.width = l * dpr; toile.height = h * dpr;
    toile.style.width = l + 'px'; toile.style.height = h + 'px';
    taille = l < 600 ? 64 : 96;
    ecart = l < 600 ? 8 : 12;
    const pas = taille + ecart;
    cols = Math.ceil(l / pas) + 1;
    lignes = Math.ceil(h / pas) + 1;
    ox = (l - (cols * pas - ecart)) / 2;
    oy = (h - (lignes * pas - ecart)) / 2;
    Carres.init(); Tetris.init();
  }

  function rect(x, y, l, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, l, h, r) : ctx.rect(x, y, l, h);
    ctx.fill();
  }
  // Dessine une case de la grille : vide (très discrète), colorée, ou blanche
  function caseGrille(x, y, couleur, intensite, blanc) {
    const pas = taille + ecart, r = taille * 0.16, px = ox + x * pas, py = oy + y * pas;
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.016)';
    rect(px, py, taille, taille, r);
    if (intensite > 0.02) {
      ctx.fillStyle = blanc ? '#ffffff' : couleur;
      ctx.globalAlpha = intensite * 0.18;
      rect(px - 5, py - 5, taille + 10, taille + 10, r + 4);
      ctx.globalAlpha = intensite * (blanc ? 0.9 : 0.75);
      rect(px, py, taille, taille, r);
    }
  }
  function effacer() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // =================== Motif 1 : carrés lumineux ===================
  const Carres = (() => {
    let cases = [], serpents = [], file = [], pasSerpent = 0, prochainMotif = 1500;
    const idx = (x, y) => y * cols + x;
    function allumer(x, y, c, e = 1) {
      if (x < 0 || y < 0 || x >= cols || y >= lignes) return;
      const k = cases[idx(x, y)];
      if (e >= k.e) { k.e = e; k.c = c; }
    }
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nouveauSerpent = () => ({ x: hasard(cols), y: hasard(lignes), d: hasard(4), c: hasard(COULEURS.length) });
    function avancer(s) {
      if (Math.random() < 0.25) {
        const choix = [0, 1, 2, 3].filter(d => d !== (s.d ^ 1));
        s.d = choix[hasard(choix.length)];
      }
      s.x += DIRS[s.d][0]; s.y += DIRS[s.d][1];
      if (s.x < 0 || s.y < 0 || s.x >= cols || s.y >= lignes) Object.assign(s, nouveauSerpent());
      allumer(s.x, s.y, s.c, 1);
    }
    const programmer = (dt, x, y, c, e = 0.9) => file.push({ t: temps + dt, x, y, c, e });
    const MOTIFS = [
      () => { const c = hasard(COULEURS.length); for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) programmer((x + y) * 70, x, y, c, 0.55); },
      () => { const c = hasard(COULEURS.length), cx = hasard(cols), cy = hasard(lignes);
        for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) { const r = Math.max(Math.abs(x - cx), Math.abs(y - cy)); if (r <= 6) programmer(r * 110, x, y, c, 0.85 - r * 0.1); } },
      () => { const c = hasard(COULEURS.length), y = hasard(lignes), sens = Math.random() < 0.5; for (let x = 0; x < cols; x++) programmer((sens ? x : cols - 1 - x) * 60, x, y, c, 0.9); },
      () => { const c = hasard(COULEURS.length), x = hasard(cols); for (let y = 0; y < lignes; y++) programmer(y * 60, x, y, c, 0.9); },
      () => { const c = hasard(COULEURS.length), p = hasard(2); for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) if ((x + y) % 2 === p) programmer(hasard(400), x, y, c, 0.35); },
    ];
    return {
      init() {
        cases = Array.from({ length: cols * lignes }, () => ({ e: 0, c: 0 }));
        serpents = Array.from({ length: Math.max(3, Math.round(cols * lignes / 45)) }, nouveauSerpent);
        file = [];
      },
      avancer(dt) {
        const att = Math.pow(0.9965, dt);
        for (const k of cases) k.e *= att;
        pasSerpent += dt;
        while (pasSerpent >= 140) { pasSerpent -= 140; serpents.forEach(avancer); }
        prochainMotif -= dt;
        if (prochainMotif <= 0) { MOTIFS[hasard(MOTIFS.length)](); prochainMotif = 3500 + hasard(3000); }
        file = file.filter(m => (m.t <= temps ? (allumer(m.x, m.y, m.c, m.e), false) : true));
      },
      dessiner() {
        effacer();
        for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) { const k = cases[idx(x, y)]; caseGrille(x, y, COULEURS[k.c], k.e); }
      },
      statique() {
        for (let i = 0; i < cases.length / 8; i++) cases[hasard(cases.length)] = { e: 0.25 + Math.random() * 0.3, c: hasard(COULEURS.length) };
      },
    };
  })();

  // =================== Motif 2 : Tetris ===================
  const Tetris = (() => {
    const FORMES = [
      [[0, 0], [1, 0], [2, 0], [3, 0]],          // I
      [[0, 0], [1, 0], [0, 1], [1, 1]],          // O
      [[1, 0], [0, 1], [1, 1], [2, 1]],          // T
      [[1, 0], [2, 0], [0, 1], [1, 1]],          // S
      [[0, 0], [1, 0], [1, 1], [2, 1]],          // Z
      [[0, 0], [0, 1], [1, 1], [2, 1]],          // J
      [[2, 0], [0, 1], [1, 1], [2, 1]],          // L
    ];
    // Les 4 rotations de chaque pièce, recalées en haut à gauche
    const ROTATIONS = FORMES.map(f => {
      const res = [], vus = new Set();
      let cur = f;
      for (let r = 0; r < 4; r++) {
        const mx = Math.min(...cur.map(c => c[0])), my = Math.min(...cur.map(c => c[1]));
        const norm = cur.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        const cle = JSON.stringify(norm);
        if (!vus.has(cle)) { vus.add(cle); res.push(norm); }
        cur = cur.map(([x, y]) => [-y, x]);
      }
      return res;
    });
    const PAS = 95;                 // une case de chute toutes les 95 ms
    let grille = [], piece = null, horloge = 0;
    let lignesFlash = null, flash = 0;   // lignes pleines en train de clignoter
    let vidage = 0;                      // grille pleine : tout clignote puis se vide

    const vide = () => Array.from({ length: lignes }, () => Array(cols).fill(-1));
    const libre = (g, cellules, x, y) => cellules.every(([cx, cy]) => {
      const gx = x + cx, gy = y + cy;
      return gx >= 0 && gx < cols && gy < lignes && (gy < 0 || g[gy][gx] < 0);
    });

    // Choisit où poser la pièce (petite « IA » : peu de trous, pile basse et régulière, lignes complètes)
    function meilleurPlacement(type) {
      let meilleur = null;
      ROTATIONS[type].forEach((cellules, rot) => {
        const larg = Math.max(...cellules.map(c => c[0])) + 1;
        for (let x = 0; x <= cols - larg; x++) {
          let y = -4;
          if (!libre(grille, cellules, x, y)) continue;
          while (libre(grille, cellules, x, y + 1)) y++;
          if (cellules.some(([, cy]) => y + cy < 0)) continue;
          const g = grille.map(l => l.slice());
          cellules.forEach(([cx, cy]) => { g[y + cy][x + cx] = 0; });
          const pleines = g.filter(l => l.every(v => v >= 0)).length;
          const hauteurs = Array.from({ length: cols }, (_, c) => { const r = g.findIndex(l => l[c] >= 0); return r < 0 ? 0 : lignes - r; });
          let trous = 0;
          for (let c = 0; c < cols; c++) { let toit = false; for (let r = 0; r < lignes; r++) { if (g[r][c] >= 0) toit = true; else if (toit) trous++; } }
          let bosses = 0; for (let c = 1; c < cols; c++) bosses += Math.abs(hauteurs[c] - hauteurs[c - 1]);
          const total = hauteurs.reduce((a, b) => a + b, 0);
          const score = 0.76 * pleines - 0.51 * total - 0.36 * trous * cols / 10 - 0.18 * bosses + Math.random() * 0.3;
          if (!meilleur || score > meilleur.score) meilleur = { rot, x, score };
        }
      });
      return meilleur;
    }

    function nouvellePiece() {
      const type = hasard(FORMES.length);
      const cible = meilleurPlacement(type);
      if (!cible) { vidage = 1; piece = null; return; }          // plus de place : on recommence
      const cellules = ROTATIONS[type][cible.rot];
      const depart = Math.max(0, Math.min(cols - 4, Math.round(cols / 2) - 2));
      piece = { cellules, x: depart, y: -3, cibleX: cible.x, c: (type * 4 + hasard(3)) % COULEURS.length };
    }

    function poser() {
      piece.cellules.forEach(([cx, cy]) => { const gy = piece.y + cy; if (gy >= 0) grille[gy][piece.x + cx] = piece.c; });
      const deborde = piece.cellules.some(([, cy]) => piece.y + cy < 0);
      piece = null;
      if (deborde) { vidage = 1; return; }
      const pleines = grille.map((l, i) => l.every(v => v >= 0) ? i : -1).filter(i => i >= 0);
      if (pleines.length) { lignesFlash = pleines; flash = 0; }
    }

    return {
      init() { grille = vide(); piece = null; lignesFlash = null; vidage = 0; horloge = 0; },
      avancer(dt) {
        if (vidage) {                                             // grille pleine : clignote, s'efface, recommence
          vidage += dt;
          if (vidage > 1400) { grille = vide(); vidage = 0; }
          return;
        }
        if (lignesFlash) {                                        // lignes complètes : 3 clignotements blancs
          flash += dt;
          if (flash > 600) {
            const garder = grille.filter((_, i) => !lignesFlash.includes(i));
            grille = [...Array.from({ length: lignesFlash.length }, () => Array(cols).fill(-1)), ...garder];
            lignesFlash = null;
          }
          return;
        }
        horloge += dt;
        while (horloge >= PAS && !lignesFlash && !vidage) {
          horloge -= PAS;
          if (!piece) { nouvellePiece(); continue; }
          if (piece.x !== piece.cibleX) {                         // glisse vers sa colonne en tombant
            const dx = Math.sign(piece.cibleX - piece.x);
            if (libre(grille, piece.cellules, piece.x + dx, piece.y)) piece.x += dx;
            else piece.cibleX = piece.x;
          }
          if (libre(grille, piece.cellules, piece.x, piece.y + 1)) piece.y++;
          else poser();
        }
      },
      dessiner() {
        effacer();
        const blanc = lignesFlash && Math.floor(flash / 100) % 2 === 0;
        const fondu = vidage ? Math.max(0, 1 - vidage / 1400) : 1;
        const clignoteTout = vidage && Math.floor(vidage / 120) % 2 === 0 && vidage < 720;
        const actives = new Set(piece ? piece.cellules.map(([cx, cy]) => `${piece.x + cx},${piece.y + cy}`) : []);
        for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) {
          if (actives.has(`${x},${y}`)) { caseGrille(x, y, COULEURS[piece.c], 1); continue; }
          const v = grille[y][x];
          if (v < 0) { caseGrille(x, y, '', 0); continue; }
          if (lignesFlash?.includes(y)) caseGrille(x, y, COULEURS[v], blanc ? 1 : 0.85, blanc);
          else if (vidage) caseGrille(x, y, COULEURS[v], clignoteTout ? 1 : 0.7 * fondu, clignoteTout);
          else caseGrille(x, y, COULEURS[v], 0.7);
        }
      },
      statique() {
        for (let y = Math.floor(lignes / 2); y < lignes; y++) for (let x = 0; x < cols; x++) if (Math.random() < 0.6) grille[y][x] = hasard(COULEURS.length);
      },
    };
  })();

  const MOTIF = () => mode === 'tetris' ? Tetris : Carres;
  let dernier = 0;
  function boucle(t) {
    const dt = Math.min(t - dernier, 100); dernier = t; temps += dt;
    MOTIF().avancer(dt);
    MOTIF().dessiner();
    requestAnimationFrame(boucle);
  }

  dimensionner();
  addEventListener('resize', () => { dimensionner(); if (reduit) { MOTIF().statique(); MOTIF().dessiner(); } });
  if (reduit) { MOTIF().statique(); MOTIF().dessiner(); }
  else requestAnimationFrame(t => { dernier = t; requestAnimationFrame(boucle); });

  // Choix du motif (menu « Fond d'écran »), mémorisé dans le navigateur
  window.EntarshFond = {
    get mode() { return mode; },
    choisir(m) {
      if (!['carres', 'tetris'].includes(m)) return;
      mode = m;
      try { localStorage.setItem(CLE, m); } catch {}
      MOTIF().init();
      if (reduit) { MOTIF().statique(); MOTIF().dessiner(); }
    },
  };
})();
