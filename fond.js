/* Fond : grille de gros carrés fixes qui s'allument (serpents + motifs). */
(() => {
  const toile = document.getElementById('fond');
  const ctx = toile.getContext('2d');
  // Couleurs de l'icône
  const COULEURS = ['#8b00ff', '#ffe000', '#ff0000', '#e600ff', '#40ff00', '#00a3ff', '#00ff95', '#ff0080', '#ff8a00'];
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let taille, ecart, cols, lignes, ox, oy, cases = [], serpents = [], file = [];
  let dpr = 1, temps = 0;

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
    cases = Array.from({ length: cols * lignes }, () => ({ e: 0, c: 0 }));
    serpents = Array.from({ length: Math.max(3, Math.round(cols * lignes / 45)) }, nouveauSerpent);
    file = [];
  }

  const hasard = n => Math.floor(Math.random() * n);
  const idx = (x, y) => y * cols + x;
  function allumer(x, y, c, e = 1) {
    if (x < 0 || y < 0 || x >= cols || y >= lignes) return;
    const k = cases[idx(x, y)];
    if (e >= k.e) { k.e = e; k.c = c; }
  }

  // --- Serpents : avancent case par case, sans faire demi-tour ---
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function nouveauSerpent() {
    return { x: hasard(cols), y: hasard(lignes), d: hasard(4), c: hasard(COULEURS.length) };
  }
  function avancer(s) {
    if (Math.random() < 0.25) {
      const choix = [0, 1, 2, 3].filter(d => d !== (s.d ^ 1));
      s.d = choix[hasard(choix.length)];
    }
    s.x += DIRS[s.d][0]; s.y += DIRS[s.d][1];
    if (s.x < 0 || s.y < 0 || s.x >= cols || s.y >= lignes) Object.assign(s, nouveauSerpent());
    allumer(s.x, s.y, s.c, 1);
  }

  // --- Motifs : programmés dans une file (moment, case, couleur) ---
  function programmer(dt, x, y, c, e = 0.9) { file.push({ t: temps + dt, x, y, c, e }); }
  const MOTIFS = [
    // vague diagonale
    () => { const c = hasard(COULEURS.length);
      for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) programmer((x + y) * 70, x, y, c, 0.55); },
    // anneau qui s'élargit
    () => { const c = hasard(COULEURS.length), cx = hasard(cols), cy = hasard(lignes);
      for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) {
        const r = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        if (r <= 6) programmer(r * 110, x, y, c, 0.85 - r * 0.1);
      } },
    // balayage d'une ligne
    () => { const c = hasard(COULEURS.length), y = hasard(lignes), sens = Math.random() < 0.5;
      for (let x = 0; x < cols; x++) programmer((sens ? x : cols - 1 - x) * 60, x, y, c, 0.9); },
    // balayage d'une colonne
    () => { const c = hasard(COULEURS.length), x = hasard(cols);
      for (let y = 0; y < lignes; y++) programmer(y * 60, x, y, c, 0.9); },
    // damier qui clignote
    () => { const c = hasard(COULEURS.length), p = hasard(2);
      for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++)
        if ((x + y) % 2 === p) programmer(hasard(400), x, y, c, 0.35); },
  ];

  function rect(x, y, l, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, l, h, r) : ctx.rect(x, y, l, h);
    ctx.fill();
  }

  function dessiner() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const pas = taille + ecart, r = taille * 0.16;
    for (let y = 0; y < lignes; y++) for (let x = 0; x < cols; x++) {
      const k = cases[idx(x, y)], px = ox + x * pas, py = oy + y * pas;
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      rect(px, py, taille, taille, r);
      if (k.e > 0.02) {
        ctx.fillStyle = COULEURS[k.c];
        ctx.globalAlpha = k.e * 0.18;                     // halo
        rect(px - 5, py - 5, taille + 10, taille + 10, r + 4);
        ctx.globalAlpha = k.e * 0.75;
        rect(px, py, taille, taille, r);
      }
    }
    ctx.globalAlpha = 1;
  }

  let dernier = 0, pasSerpent = 0, prochainMotif = 1500;
  function boucle(t) {
    const dt = Math.min(t - dernier, 100); dernier = t; temps += dt;
    const att = Math.pow(0.9965, dt);                  // extinction progressive
    for (const k of cases) k.e *= att;

    pasSerpent += dt;
    while (pasSerpent >= 140) { pasSerpent -= 140; serpents.forEach(avancer); }

    prochainMotif -= dt;
    if (prochainMotif <= 0) { MOTIFS[hasard(MOTIFS.length)](); prochainMotif = 3500 + hasard(3000); }

    file = file.filter(m => (m.t <= temps ? (allumer(m.x, m.y, m.c, m.e), false) : true));
    dessiner();
    requestAnimationFrame(boucle);
  }

  dimensionner();
  addEventListener('resize', () => { dimensionner(); if (reduit) statique(); });

  function statique() {
    for (let i = 0; i < cases.length / 8; i++) cases[hasard(cases.length)] = { e: 0.25 + Math.random() * 0.3, c: hasard(COULEURS.length) };
    dessiner();
  }
  if (reduit) statique();
  else requestAnimationFrame(t => { dernier = t; requestAnimationFrame(boucle); });
})();
