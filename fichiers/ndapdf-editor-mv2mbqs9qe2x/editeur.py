"""
editeur.py — Fenêtre principale (point d'entrée)

    python editeur.py

Présentation (cf. maquette) :

    ┌──────────────────────────────────────────────────────────────┐
    │ MENUS                                                        │
    ├──────────────────────────────────────────────────────────────┤
    │ RUBAN                                                        │
    ├──────────────────────────────────────────────────────────────┤
    │ contexte                                                     │
    ├────┬────┬──────────┬──────────────┬──────────┬────┬──────────┤
    │ M  │ ‹‹ │ page     │              │ page     │ ›› │ I        │
    │ e  │    │ précéd.  │  PAGE        │ d'après  │    │ n        │
    │ n  │    │          │  UTILISÉE    │          │    │ f        │
    │ u  │    │          │              │          │    │ o        │
    │ sp │    │          │              │          │    │          │
    └────┴────┴──────────┴──────────────┴──────────┴────┴──────────┘

Les pages voisines, les flèches et la page courante vivent dans un seul
canevas : c'est ce qui permet l'animation de défilement latéral.
"""

from __future__ import annotations

import base64
import os
import time
import uuid
import tkinter as tk
from dataclasses import replace
from tkinter import filedialog, messagebox, simpledialog
from tkinter import font as tkfont

import ruban as rb
from document import (FORMATS_PAGE, INTERLIGNE, MARGE_TEXTE, Document, Element, Fragment,
                      appliquer_sur_plage, hauteur_texte, mettre_en_page,
                      soulignements)
from lecteur import PYMUPDF_DISPO, Lecteur, exporter_pdf

try:
    import io

    from PIL import Image, ImageTk
    PIL_DISPO = True
except ImportError:
    PIL_DISPO = False

MARGE_V = 24              # marge verticale autour de la page
ESPACEMENT = 70           # espace entre deux pages voisines
DUREE_ANIM = 260          # ms
ZOOMS = [0.25, 0.35, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0]

POIGNEE = 4.0             # demi-côté d'une poignée, en pixels écran
MIN_TAILLE = 10.0         # taille minimale d'un objet, en points

# poignées : n = nord, s = sud, e = est, o = ouest
POIGNEES = ("no", "n", "ne", "e", "se", "s", "so", "o")
CURSEURS = {
    "no": "sizing", "ne": "sizing", "se": "sizing", "so": "sizing",
    "n": "sb_v_double_arrow", "s": "sb_v_double_arrow",
    "e": "sb_h_double_arrow", "o": "sb_h_double_arrow",
    "debut": "sizing", "fin": "sizing",
}
ALIGNEMENTS = {"gauche": "left", "centre": "center", "droite": "right"}

# Information Éditeur : (numéro, titre). Les numéros remplacent les symboles
# tant que les icônes ne sont pas dessinées.
INFOS = [
    ("1", "Zoom"),
    ("2", "Page"),
    ("3", "Document"),
    ("4", "Sélection"),
    ("5", "Système"),
]


# =========================================================== petits widgets ==
class EtiquetteVerticale(tk.Canvas):
    """Texte pivoté à 90°, pour les barres latérales."""

    def __init__(self, parent, texte: str, largeur: int = 30,
                 fond: str = rb.PANNEAU, couleur: str = rb.TEXTE_FAIBLE) -> None:
        super().__init__(parent, bg=fond, width=largeur, bd=0, highlightthickness=0)
        self._texte = texte
        self._couleur = couleur
        self.bind("<Configure>", lambda _ev: self.redessiner())

    def definir_texte(self, texte: str) -> None:
        self._texte = texte
        self.redessiner()

    def redessiner(self) -> None:
        self.delete("all")
        self.create_text(self.winfo_width() / 2, self.winfo_height() / 2,
                         text=self._texte, angle=90, fill=self._couleur,
                         font=rb.POLICE)


class Fleche(tk.Canvas):
    """Double chevron de navigation entre les pages."""

    LARGEUR = 62

    def __init__(self, parent, sens: int, action) -> None:
        super().__init__(parent, bg=rb.FOND, width=self.LARGEUR, bd=0,
                         highlightthickness=0, cursor="hand2")
        self.sens = sens                  # -1 = page précédente, +1 = page suivante
        self.action = action
        self.actif = True
        self.couleur = rb.TEXTE_FAIBLE
        self.bind("<Configure>", lambda _ev: self.redessiner())
        self.bind("<Enter>", lambda _ev: self._teinter(rb.ACCENT))
        self.bind("<Leave>", lambda _ev: self._teinter(rb.TEXTE_FAIBLE))
        self.bind("<Button-1>", lambda _ev: self.action() if self.actif else None)

    def _teinter(self, couleur: str) -> None:
        if not self.actif:
            return
        self.couleur = couleur
        self.redessiner()

    def definir_actif(self, actif: bool) -> None:
        self.actif = actif
        self.couleur = rb.TEXTE_FAIBLE if actif else rb.BORDURE
        self.configure(cursor="hand2" if actif else "arrow")
        self.redessiner()

    def redessiner(self) -> None:
        self.delete("all")
        cx, cy = self.winfo_width() / 2, self.winfo_height() / 2
        b, h = 11, 15                      # demi-base et demi-hauteur du chevron
        # la pointe est du côté du déplacement : les bras partent dans l'autre sens
        for decalage in (-9, 9):
            x = cx + decalage
            self.create_line(x - b * self.sens, cy - h, x, cy, x - b * self.sens, cy + h,
                             fill=self.couleur, width=7, capstyle="round",
                             joinstyle="round")


# ============================================================= Menu Spécial ==
class MenuSpecial(tk.Frame):
    """
    Barre verticale gauche : options internes de l'outil choisi au ruban.
    Chaque option affiche le réglage courant dans un cadre placé après son nom.
    """

    REPLIE = 30
    DEPLIE = 258

    def __init__(self, parent, commandes: dict[str, callable]) -> None:
        super().__init__(parent, bg=rb.PANNEAU, width=self.REPLIE)
        self.pack_propagate(False)
        self.commandes = commandes
        self._titre = ""
        self._entrees: list[dict] = []
        self._lire_valeur = None
        self._deplie = False
        self.lie_selection = True      # se referme quand plus rien n'est sélectionné

        self.etiquette = EtiquetteVerticale(self, "MENU SPÉCIAL")
        self.etiquette.bind("<Button-1>", lambda _ev: self.rouvrir())
        self.contenu = tk.Frame(self, bg=rb.PANNEAU)
        self.replier()

    # -- affichage
    def afficher(self, titre: str, options: list[dict], lire_valeur=None,
                 lie_selection: bool = True) -> None:
        self._titre = titre
        self._entrees = options
        self.lie_selection = lie_selection
        if lire_valeur is not None:
            self._lire_valeur = lire_valeur
        self._deplie = True
        self.etiquette.pack_forget()
        self.configure(width=self.DEPLIE)
        self.contenu.pack(fill="both", expand=True)
        self._construire()

    def rafraichir(self) -> None:
        """Remet à jour les cadres de valeur (sélection ou réglage modifié)."""
        if self._deplie:
            self._construire()

    def rouvrir(self) -> None:
        if self._entrees:
            self.afficher(self._titre, self._entrees)

    def replier(self) -> None:
        self._deplie = False
        self.contenu.pack_forget()
        self.configure(width=self.REPLIE)
        self.etiquette.pack(fill="both", expand=True)

    # -- construction
    def _construire(self) -> None:
        for enfant in self.contenu.winfo_children():
            enfant.destroy()

        entete = tk.Frame(self.contenu, bg=rb.ACCENT_SOMBRE)
        entete.pack(fill="x")
        tk.Label(entete, text=self._titre.upper(), bg=rb.ACCENT_SOMBRE, fg="#FFFFFF",
                 font=rb.POLICE_TITRE, anchor="w", padx=12, pady=7).pack(side="left")
        fermer = tk.Label(entete, text="✕", bg=rb.ACCENT_SOMBRE, fg="#FFFFFF",
                          font=rb.POLICE, padx=10, cursor="hand2")
        fermer.pack(side="right")
        fermer.bind("<Button-1>", lambda _ev: self.replier())

        for option in self._entrees:
            self._ligne(option)

        tk.Label(self.contenu, text="Cliquez une option pour la modifier.",
                 bg=rb.PANNEAU, fg=rb.TEXTE_FAIBLE, font=rb.POLICE_MINUSCULE,
                 wraplength=self.DEPLIE - 30, justify="left",
                 anchor="w", padx=12, pady=10).pack(fill="x", side="bottom")

    def _ligne(self, option: dict) -> None:
        ligne = tk.Frame(self.contenu, bg=rb.PANNEAU)
        ligne.pack(fill="x", pady=1)

        nom = tk.Label(ligne, text=option["libelle"], bg=rb.PANNEAU, fg=rb.TEXTE,
                       font=rb.POLICE, anchor="w", padx=12, pady=8)
        nom.pack(side="left")

        pieces = [ligne, nom]
        cle = option.get("valeur")
        if cle and self._lire_valeur:
            texte, pastille = self._lire_valeur(cle)
            cadre = tk.Frame(ligne, bg=rb.CHAMP, highlightthickness=1,
                             highlightbackground=rb.BORDURE)
            cadre.pack(side="right", padx=10, pady=6)
            if pastille:
                echantillon = tk.Frame(cadre, bg=pastille, width=13, height=13,
                                       highlightthickness=1,
                                       highlightbackground=rb.BORDURE)
                echantillon.pack(side="left", padx=(5, 0), pady=4)
                echantillon.pack_propagate(False)
            valeur = tk.Label(cadre, text=texte, bg=rb.CHAMP, fg=rb.TEXTE,
                              font=rb.POLICE_PETITE, padx=6, pady=2)
            valeur.pack(side="left")
            pieces += [cadre, valeur]

        for piece in pieces:
            piece.bind("<Enter>", lambda _ev, p=pieces: self._teinter(p, True))
            piece.bind("<Leave>", lambda _ev, p=pieces: self._teinter(p, False))
            piece.bind("<Button-1>", lambda _ev, c=option["commande"]: self._executer(c))

    @staticmethod
    def _teinter(pieces: list, dedans: bool) -> None:
        pieces[0].configure(bg=rb.SURVOL if dedans else rb.PANNEAU)
        pieces[1].configure(bg=rb.SURVOL if dedans else rb.PANNEAU,
                            fg=rb.ACCENT if dedans else rb.TEXTE)

    def _executer(self, nom: str) -> None:
        fonction = self.commandes.get(nom)
        if fonction is None:
            print(f"[menu spécial] commande inconnue : {nom}")
            return
        try:
            fonction()
        except Exception:
            import traceback
            print(f"[menu spécial] erreur dans « {nom} » :")
            traceback.print_exc()


# ======================================================= Information Éditeur ==
class InfoEditeur(tk.Frame):
    """Barre verticale droite : boutons numérotés + rectangle d'informations."""

    LARGEUR = 30

    def __init__(self, parent, zone: tk.Misc, fournisseur, commandes) -> None:
        super().__init__(parent, bg=rb.PANNEAU, width=self.LARGEUR)
        self.pack_propagate(False)
        self.zone = zone
        self.fournisseur = fournisseur
        self.commandes = commandes
        self.ouvert: str | None = None
        self.popup: tk.Frame | None = None
        self._boutons: dict[str, tk.Label] = {}

        for numero, titre in INFOS:
            b = tk.Label(self, text=numero, bg=rb.PANNEAU, fg=rb.TEXTE_FAIBLE,
                         font=rb.POLICE, pady=7, cursor="hand2")
            b.pack(fill="x")
            b.bind("<Button-1>", lambda _ev, n=numero: self.basculer(n))
            b.bind("<Enter>", lambda _ev, w=b: w.configure(fg=rb.ACCENT))
            b.bind("<Leave>", lambda _ev, w=b, n=numero:
                   w.configure(fg=rb.ACCENT if self.ouvert == n else rb.TEXTE_FAIBLE))
            self._boutons[numero] = b

        EtiquetteVerticale(self, "INFORMATION ÉDITEUR").pack(fill="both", expand=True)

    def basculer(self, numero: str) -> None:
        if self.ouvert == numero:
            self.fermer()
            return
        self.fermer()
        self.ouvert = numero
        self._boutons[numero].configure(fg=rb.ACCENT)
        self._construire(numero)

    def fermer(self) -> None:
        if self.popup is not None:
            self.popup.destroy()
            self.popup = None
        if self.ouvert:
            self._boutons[self.ouvert].configure(fg=rb.TEXTE_FAIBLE)
        self.ouvert = None

    def rafraichir(self) -> None:
        if self.ouvert:
            numero = self.ouvert
            if self.popup is not None:
                self.popup.destroy()
            self._construire(numero)

    def _construire(self, numero: str) -> None:
        titre, lignes = self.fournisseur(numero)
        cadre = tk.Frame(self.zone, bg=rb.CONTEXTE, highlightthickness=1,
                         highlightbackground=rb.BORDURE)
        tk.Label(cadre, text=titre.upper(), bg=rb.CONTEXTE, fg=rb.ACCENT,
                 font=rb.POLICE_TITRE, anchor="w", padx=12, pady=6).pack(fill="x")
        for ligne in lignes:
            tk.Label(cadre, text=ligne, bg=rb.CONTEXTE, fg=rb.TEXTE, font=rb.POLICE,
                     anchor="w", padx=12, pady=1).pack(fill="x")

        if numero == "1":                       # zoom : commandes rapides
            rangee = tk.Frame(cadre, bg=rb.CONTEXTE)
            rangee.pack(fill="x", padx=8, pady=8)
            for libelle, commande in (("−", "zoom_moins"), ("+", "zoom_plus"),
                                      ("100 %", "zoom_100"), ("Ajuster", "zoom_ajuster")):
                b = tk.Label(rangee, text=libelle, bg=rb.PANNEAU, fg=rb.TEXTE,
                             font=rb.POLICE, padx=8, pady=3, cursor="hand2")
                b.pack(side="left", padx=2)
                b.bind("<Button-1>",
                       lambda _ev, c=commande: (self.commandes[c](), self.rafraichir()))
        else:
            tk.Frame(cadre, bg=rb.CONTEXTE, height=8).pack()

        y = self._boutons[numero].winfo_rooty() - self.zone.winfo_rooty()
        cadre.place(in_=self.zone, relx=1.0, x=-(self.LARGEUR + 8), y=y, anchor="ne")
        cadre.lift()
        self.popup = cadre


# =================================================================== Éditeur ==
class Editeur(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("ndaPDF — éditeur")
        self.geometry("1320x840")
        self.configure(bg=rb.FOND)
        self.minsize(900, 560)

        # état
        self.lecteur = Lecteur()
        self.document = Document.nouveau("A4", 3)
        self.index_page = 0
        self.zoom = 1.0
        self.zoom_auto = True
        self.selection: Element | None = None
        self._fonds: dict[tuple[int, float], object] = {}
        self._origine = (0.0, 0.0)      # coin haut-gauche de la page courante
        self._saisie = None
        self._decalage = 0.0            # défilement en cours (animation)
        self._focus: int | None = None  # page mise en avant pendant l'animation
        self._anim = False
        self._pan_y = 0.0

        # outils et manipulation directe
        self.outil: str | None = None       # outil armé (tracé du prochain objet)
        self._mode: str | None = None       # "creer" | "deplacer" | "redimensionner"
        self._poignee: str | None = None    # poignée saisie
        self._apercu: tuple | None = None   # cadre en cours de tracé (coords page)
        self._edition: Element | None = None
        self._zone_edition: tk.Text | None = None
        self._polices: dict[tuple, tkfont.Font] = {}   # cache des polices Tk
        self._presse_papier: Element | None = None     # objet copié
        self._etiquettes: dict[str, dict] = {}         # tag Tk -> mise en forme

        self._construire_interface()
        self.after(60, self._premier_rendu)

    # ------------------------------------------------------------- commandes
    @property
    def commandes(self) -> dict[str, callable]:
        return {
            # fichier
            "nouveau": self.nouveau,
            "ouvrir_pdf": self.ouvrir_pdf,
            "ouvrir_nda": self.ouvrir_nda,
            "enregistrer": self.enregistrer,
            "enregistrer_sous": self.enregistrer_sous,
            "exporter_pdf": self.exporter,
            # outils
            "outil_selection": lambda: self.armer_outil(None),
            "outil_texte": lambda: self.armer_outil("texte"),
            "outil_image": lambda: self.armer_outil("image"),
            "outil_rectangle": lambda: self.armer_outil("rectangle"),
            "outil_ligne": lambda: self.armer_outil("ligne"),
            "modifier_element": self.modifier_element,
            "supprimer_element": self.supprimer_element,
            "premier_plan": self.premier_plan,
            # texte
            "align_gauche": lambda: self.aligner("gauche"),
            "align_centre": lambda: self.aligner("centre"),
            "align_droite": lambda: self.aligner("droite"),
            "texte_agrandir": lambda: self.changer_taille_texte(1),
            "texte_reduire": lambda: self.changer_taille_texte(-1),
            "format_page": self.format_page,
            "texte_puissance": lambda: self.basculer_exposant(1),
            "texte_indice": lambda: self.basculer_exposant(-1),
            "souligne_couleur": self.souligne_couleur,
            "souligne_epaisseur": self.souligne_epaisseur,
            "souligne_type": self.souligne_type,
            "couper": lambda: self.copier_objet(couper=True),
            "copier": self.copier_objet,
            "coller": self.coller_objet,
            "format_objet": self.format_objet,
            "texte_alignement": self.choisir_alignement,
            "texte_ajuster": self.ajuster_hauteur_element,
            # menu spécial
            "police_nom": self.police_nom,
            "police_taille": self.police_taille,
            "police_couleur": self.couleur_texte,
            "texte_surlignage": self.surlignage_texte,
            "style_souligne": self.basculer_souligne,
            "style_gras": lambda: self.basculer_style("B"),
            "style_italique": lambda: self.basculer_style("I"),
            "trait_couleur": lambda: self.definir_couleur("couleur"),
            "trait_type": self.trait_type,
            "trait_epaisseur": self.trait_epaisseur,
            "forme_remplissage": lambda: self.definir_couleur("remplissage"),
            "format_a4": lambda: self.definir_format("A4"),
            "format_a3": lambda: self.definir_format("A3"),
            "format_a5": lambda: self.definir_format("A5"),
            "format_lettre": lambda: self.definir_format("Lettre"),
            # pages
            "page_ajouter": self.page_ajouter,
            "page_dupliquer": self.page_dupliquer,
            "page_supprimer": self.page_supprimer,
            "page_monter": lambda: self.deplacer_page(-1),
            "page_descendre": lambda: self.deplacer_page(1),
            "page_pivoter": self.page_pivoter,
            "page_precedente": lambda: self.naviguer(-1),
            "page_suivante": lambda: self.naviguer(1),
            # affichage
            "zoom_plus": lambda: self.changer_zoom(1),
            "zoom_moins": lambda: self.changer_zoom(-1),
            "zoom_100": lambda: self.definir_zoom(1.0),
            "zoom_ajuster": self.zoom_ajuster,
            "quitter": self.destroy,
            "a_propos": self.a_propos,
        }

    # ------------------------------------------------------------- interface
    def _construire_interface(self) -> None:
        cmd = self.commandes
        rb.lier_raccourcis(self, cmd)

        self.ruban = rb.Ruban(self, cmd, sur_special=self._ouvrir_special)
        self.ruban.pack(fill="x")

        # barre d'état (bas de fenêtre)
        etat = tk.Frame(self, bg=rb.BARRE, height=24)
        etat.pack(side="bottom", fill="x")
        etat.pack_propagate(False)
        tk.Frame(self, bg=rb.BORDURE, height=1).pack(side="bottom", fill="x")
        self.etat_gauche = tk.Label(etat, text="", bg=rb.BARRE, fg=rb.TEXTE_FAIBLE,
                                    font=rb.POLICE_PETITE, anchor="w", padx=12)
        self.etat_gauche.pack(side="left")
        self.etat_droite = tk.Label(etat, text="", bg=rb.BARRE, fg=rb.TEXTE_FAIBLE,
                                    font=rb.POLICE_PETITE, anchor="e", padx=12)
        self.etat_droite.pack(side="right")

        corps = tk.Frame(self, bg=rb.FOND)
        corps.pack(fill="both", expand=True)
        self.corps = corps

        self.menu_special = MenuSpecial(corps, cmd)
        self.menu_special.pack(side="left", fill="y")

        self.fleche_g = Fleche(corps, -1, lambda: self.naviguer(-1))
        self.fleche_g.pack(side="left", fill="y")

        self.info = InfoEditeur(corps, corps, self._info, cmd)
        self.info.pack(side="right", fill="y")

        self.fleche_d = Fleche(corps, 1, lambda: self.naviguer(1))
        self.fleche_d.pack(side="right", fill="y")

        self.canevas = tk.Canvas(corps, bg=rb.FOND, bd=0, highlightthickness=0)
        self.canevas.pack(side="left", fill="both", expand=True)

        self.canevas.bind("<Configure>", self._sur_redimension)
        self.canevas.bind("<Button-1>", self._sur_clic)
        self.canevas.bind("<B1-Motion>", self._sur_glissement)
        self.canevas.bind("<ButtonRelease-1>", self._sur_relachement)
        self.canevas.bind("<Motion>", self._sur_survol)
        self.canevas.bind("<Double-Button-1>", self._sur_double_clic)
        self.canevas.bind("<Delete>", lambda _ev: self.supprimer_element())
        self.canevas.bind("<Button-3>", self._menu_contextuel)
        self.canevas.bind("<Escape>", lambda _ev: self.armer_outil(None))
        self.canevas.bind("<Return>", lambda _ev: self.modifier_element())
        # navigation liée au canevas seulement, pour ne pas gêner la saisie
        self.canevas.bind("<Left>", lambda _ev: self.naviguer(-1))
        self.canevas.bind("<Right>", lambda _ev: self.naviguer(1))
        self.canevas.bind("<Prior>", lambda _ev: self.naviguer(-1))
        self.canevas.bind("<Next>", lambda _ev: self.naviguer(1))
        self.canevas.bind("<MouseWheel>", self._sur_molette)
        self.canevas.bind("<Control-MouseWheel>",
                          lambda ev: self.changer_zoom(1 if ev.delta > 0 else -1))
        self.canevas.configure(takefocus=True)

    def _premier_rendu(self) -> None:
        self.zoom_ajuster()
        self.rafraichir()

    def _ouvrir_special(self, titre: str, options: list[dict],
                        lie_selection: bool = True) -> None:
        self.menu_special.afficher(titre, options, self.lire_valeur, lie_selection)

    def lire_valeur(self, cle: str) -> tuple[str, str | None]:
        """
        Réglage courant à afficher dans le cadre du Menu Spécial.
        Renvoie (texte, couleur de la pastille ou None).
        """
        page = self.document.page(self.index_page)
        if cle.startswith("dim:"):                      # formats de page
            nom = cle[4:]
            largeur, hauteur = FORMATS_PAGE[nom]
            actif = page is not None and abs(page.largeur - largeur) < 1 \
                and abs(page.hauteur - hauteur) < 1
            return f"{largeur:.0f} × {hauteur:.0f}" + ("  ✓" if actif else ""), None

        el = self.selection if self._edition is None else self._edition
        if el is None:
            return "—", None
        if el.type == "texte" and cle in ("couleur", "surlignage", "police", "taille"):
            mise_en_forme = self._style_plage(el)
            valeur = mise_en_forme.get(cle)
            if cle == "couleur":
                return (valeur, valeur) if valeur else ("aucune", None)
            if cle == "surlignage":
                return (valeur, valeur) if valeur else ("aucun", None)
            if cle == "taille":
                return f"{valeur:g} pt", None
            return str(valeur), None
        if cle == "couleur":
            return (el.couleur, el.couleur) if el.couleur else ("aucune", None)
        if cle == "remplissage":
            return (el.remplissage, el.remplissage) if el.remplissage else ("aucun", None)
        if cle == "tirets":
            motif = el.style.get("tirets")
            for nom, valeur in rb.TYPES_TRAIT.items():
                if valeur == motif:
                    return nom, None
            return "personnalisé", None
        if cle == "epaisseur":
            return f"{el.epaisseur:g} pt", None
        if cle == "police":
            return el.police, None
        if cle == "taille":
            return f"{el.taille:g} pt", None
        if cle == "alignement":
            return el.style.get("alignement", "gauche"), None
        if cle.startswith("souligne_"):
            mise = self._style_plage(el)
            if cle == "souligne_couleur":
                teinte = mise.get("souligne_couleur") or mise.get("couleur")
                return (teinte, teinte) if teinte else ("aucune", None)
            if cle == "souligne_epaisseur":
                valeur = mise.get("souligne_epaisseur")
                return (f"{valeur:g} pt" if valeur else "auto"), None
            motif = mise.get("souligne_tirets")
            for nom, valeur in rb.TYPES_TRAIT.items():
                if valeur == motif:
                    return nom, None
            return "personnalisé", None
        if cle == "surlignage":
            return (el.surlignage, el.surlignage) if getattr(el, "surlignage", "") else ("aucun", None)
        return "—", None

    # -------------------------------------------------------------- affichage
    def rafraichir(self) -> None:
        self.dessiner()
        self.fleche_g.definir_actif(self.index_page > 0)
        self.fleche_d.definir_actif(self.index_page < len(self.document.pages) - 1)
        if self.menu_special.lie_selection and self.selection is None \
                and self._edition is None:
            self.menu_special.replier()    # plus d'objet visé : le menu n'a plus d'objet
        else:
            self.menu_special.rafraichir()
        self.info.rafraichir()
        self._maj_etat()

    def _maj_etat(self) -> None:
        nom = self.document.titre + (" *" if self.document.modifie else "")
        gauche = [nom]
        if self.selection is not None:
            gauche.append(f"{self.selection.type} sélectionné")
        elif not PYMUPDF_DISPO:
            gauche.append("PyMuPDF absent — PDF désactivé")
        self.etat_gauche.configure(text="      ·      ".join(gauche))

        page = self.document.page(self.index_page)
        droite = f"Page {self.index_page + 1} sur {len(self.document.pages)}"
        if page is not None:
            droite += f"      ·      {page.largeur:.0f} × {page.hauteur:.0f} pt"
        droite += f"      ·      {self.zoom * 100:.0f} %"
        self.etat_droite.configure(text=droite)
        self.ruban.definir_document(nom)

    def _sur_redimension(self, _evenement) -> None:
        if self.zoom_auto:
            self._ajuster()
        self.dessiner()

    def dessiner(self) -> None:
        largeur_vue = self.canevas.winfo_width()
        hauteur_vue = self.canevas.winfo_height()
        if largeur_vue < 30 or hauteur_vue < 30:
            return
        self.canevas.delete("all")

        courante = self.document.page(self.index_page)
        if courante is None:
            return
        ecart = courante.largeur * self.zoom + ESPACEMENT
        focus = self.index_page if self._focus is None else self._focus

        for i in range(self.index_page - 2, self.index_page + 3):
            page = self.document.page(i)
            if page is None:
                continue
            largeur = page.largeur * self.zoom
            cx = largeur_vue / 2 + self._decalage + (i - self.index_page) * ecart
            if cx + largeur / 2 < -20 or cx - largeur / 2 > largeur_vue + 20:
                continue
            self._dessiner_page(page, i, cx, hauteur_vue, i == focus)
        self._replacer_zone()

    def _dessiner_page(self, page, index: int, cx: float, hauteur_vue: int,
                       actif: bool) -> None:
        largeur = page.largeur * self.zoom
        hauteur = page.hauteur * self.zoom
        x0 = cx - largeur / 2
        if hauteur > hauteur_vue - 2 * MARGE_V:
            y0 = MARGE_V - self._pan_y
        else:
            y0 = (hauteur_vue - hauteur) / 2

        detaillee = actif or self._anim
        self.canevas.create_rectangle(x0 + 5, y0 + 5, x0 + largeur + 5, y0 + hauteur + 5,
                                      fill="#000000", outline="")
        self.canevas.create_rectangle(x0, y0, x0 + largeur, y0 + hauteur,
                                      fill=rb.PAPIER if detaillee else rb.VOISINE,
                                      outline=rb.BORDURE)

        image = self._fond_page(page.source_index) if detaillee else None
        if image is not None:
            self.canevas.create_image(x0, y0, image=image, anchor="nw")
        if actif or self._anim:
            for el in page.elements:
                self._dessiner_element(el, x0, y0)

        if actif:
            self._origine = (x0, y0)
            marge = 56 * self.zoom          # repères de marge, comme dans Word
            if largeur > 4 * marge and hauteur > 4 * marge:
                self.canevas.create_rectangle(x0 + marge, y0 + marge,
                                              x0 + largeur - marge, y0 + hauteur - marge,
                                              outline=rb.GUIDE, dash=(2, 4))
            if self.selection is not None and self.selection in page.elements:
                self._dessiner_poignees(self.selection, x0, y0)
            if self._apercu is not None:
                ax1, ay1, ax2, ay2 = self._apercu
                self.canevas.create_rectangle(x0 + ax1 * self.zoom, y0 + ay1 * self.zoom,
                                              x0 + ax2 * self.zoom, y0 + ay2 * self.zoom,
                                              outline=rb.ACCENT, dash=(3, 3))
        else:
            # pendant l'animation la page voisine montre son contenu : on l'assombrit
            if self._anim:
                self.canevas.create_rectangle(x0, y0, x0 + largeur, y0 + hauteur,
                                              fill="#0A0A0A", stipple="gray50", outline="")
            else:
                avant = index < self.index_page
                texte = "Page précédente" if avant else "Page d'après"
                x = x0 + largeur - 20 if avant else x0 + 20
                self.canevas.create_text(x, y0 + hauteur / 2, text=texte, angle=90,
                                         fill="#D0D0D0", font=rb.POLICE)

    def _dessiner_element(self, el: Element, x0: float, y0: float) -> None:
        if el is self._edition:
            return                        # le contenu est dans la zone de saisie
        x1, y1 = x0 + el.x * self.zoom, y0 + el.y * self.zoom
        x2, y2 = x0 + el.x2 * self.zoom, y0 + el.y2 * self.zoom
        tirets = el.style.get("tirets")
        motif = {"dash": tuple(tirets)} if tirets else {}

        if el.type == "texte":
            self._dessiner_texte(el, x1, y1, x2, y2)
        elif el.type == "rectangle":
            self.canevas.create_rectangle(x1, y1, x2, y2, outline=el.couleur,
                                          fill=el.remplissage or "",
                                          width=max(1, el.epaisseur), **motif)
        elif el.type == "ligne":
            self.canevas.create_line(x1, y1, x2, y2, fill=el.couleur,
                                     width=max(1, el.epaisseur), **motif)
        elif el.type == "image":
            self.canevas.create_rectangle(x1, y1, x2, y2, outline=rb.TEXTE_FAIBLE,
                                          dash=(3, 3))
            self.canevas.create_text((x1 + x2) / 2, (y1 + y2) / 2, fill=rb.TEXTE_FAIBLE,
                                     font=rb.POLICE_PETITE,
                                     text=os.path.basename(el.contenu) or "image")

    # ------------------------------------------------------ texte à fragments
    FAMILLES = {"helv": "Helvetica", "times": "Times", "cour": "Courier",
                "symb": "Symbol", "zadb": "Helvetica"}

    def police_tk(self, mise_en_forme: dict, zoom: float = 1.0) -> tkfont.Font:
        """
        Police Tk correspondant à une mise en forme, avec cache.
        La taille est donnée en PIXELS (valeur négative) : une taille positive
        serait interprétée en points et convertie selon les DPI de l'écran,
        ce qui dessinerait le texte plus grand que la mise en page calculée.
        Le soulignement n'est pas confié à la police : il est tracé à part,
        pour être continu et pour avoir sa couleur, son épaisseur et son type.
        """
        nom = mise_en_forme["police"] or "helv"
        racine = nom.rstrip("BI")
        suffixe = nom[len(racine):]
        taille = max(1, int(round(mise_en_forme["taille"] * zoom)))
        cle = (racine, suffixe, taille)
        if cle not in self._polices:
            self._polices[cle] = tkfont.Font(
                family=self.FAMILLES.get(racine, "Helvetica"), size=-taille,
                weight="bold" if "B" in suffixe else "normal",
                slant="italic" if "I" in suffixe else "roman",
            )
        return self._polices[cle]

    PRECISION = 4          # on mesure en gros puis on divise : moins d'arrondis

    def mesurer(self, texte: str, mise_en_forme: dict) -> float:
        """Largeur en points, indépendante du zoom : l'écran et le PDF s'accordent."""
        return self.police_tk(mise_en_forme, self.PRECISION).measure(texte) / self.PRECISION

    def _dessiner_texte(self, el: Element, x1: float, y1: float,
                        x2: float, y2: float) -> None:
        if el.remplissage:
            self.canevas.create_rectangle(x1, y1, x2, y2, fill=el.remplissage, outline="")
        marge = MARGE_TEXTE * self.zoom
        origine_x, origine_y = x1 + marge, y1 + marge

        for ligne in mettre_en_page(el, self.mesurer):
            haut = origine_y + ligne["haut"] * self.zoom
            bas = origine_y + (ligne["haut"] + ligne["hauteur"]) * self.zoom
            # les surlignages d'abord, sinon ils masqueraient le texte voisin
            for segment in ligne["segments"]:
                if segment["style"]["surlignage"]:
                    gauche = origine_x + segment["x"] * self.zoom
                    self.canevas.create_rectangle(
                        gauche, haut, gauche + segment["largeur"] * self.zoom, bas,
                        fill=segment["style"]["surlignage"], outline="")
            for segment in ligne["segments"]:
                mise_en_forme = segment["style"]
                if not mise_en_forme["couleur"] or not segment["texte"].strip():
                    continue
                police = self.police_tk(mise_en_forme, self.zoom)
                gauche = origine_x + segment["x"] * self.zoom
                ligne_base = ligne["base"] + mise_en_forme["decalage"]
                sommet = origine_y + ligne_base * self.zoom - police.metrics("ascent")
                self.canevas.create_text(
                    gauche, sommet, text=segment["texte"], anchor="nw",
                    fill=mise_en_forme["couleur"], font=police)

            for trait in soulignements(ligne):
                y = origine_y + (ligne["base"] + trait["y"]) * self.zoom
                motif = {"dash": tuple(trait["tirets"])} if trait["tirets"] else {}
                self.canevas.create_line(
                    origine_x + trait["debut"] * self.zoom, y,
                    origine_x + trait["fin"] * self.zoom, y,
                    fill=trait["couleur"],
                    width=max(1, round(trait["epaisseur"] * self.zoom)), **motif)

    # ------------------------------------------------------- poignées / cadre
    def _poignees(self, el: Element, x0: float, y0: float) -> dict[str, tuple[float, float]]:
        """Position à l'écran de chaque poignée de l'élément sélectionné."""
        x1, y1 = x0 + el.x * self.zoom, y0 + el.y * self.zoom
        x2, y2 = x0 + el.x2 * self.zoom, y0 + el.y2 * self.zoom
        if el.type == "ligne":
            return {"debut": (x1, y1), "fin": (x2, y2)}
        milieu_x, milieu_y = (x1 + x2) / 2, (y1 + y2) / 2
        return {
            "no": (x1, y1), "n": (milieu_x, y1), "ne": (x2, y1),
            "e": (x2, milieu_y), "se": (x2, y2), "s": (milieu_x, y2),
            "so": (x1, y2), "o": (x1, milieu_y),
        }

    def _dessiner_poignees(self, el: Element, x0: float, y0: float) -> None:
        x1, y1 = x0 + el.x * self.zoom, y0 + el.y * self.zoom
        x2, y2 = x0 + el.x2 * self.zoom, y0 + el.y2 * self.zoom
        if el.type != "ligne":
            self.canevas.create_rectangle(x1, y1, x2, y2, outline=rb.ACCENT, dash=(4, 3))
        for x, y in self._poignees(el, x0, y0).values():
            self.canevas.create_rectangle(x - POIGNEE, y - POIGNEE,
                                          x + POIGNEE, y + POIGNEE,
                                          fill="#FFFFFF", outline=rb.ACCENT)

    def _poignee_a(self, ex: float, ey: float) -> str | None:
        """Nom de la poignée sous le pointeur (coordonnées écran), sinon None."""
        if self.selection is None:
            return None
        x0, y0 = self._origine
        for nom, (x, y) in self._poignees(self.selection, x0, y0).items():
            if abs(ex - x) <= POIGNEE + 2 and abs(ey - y) <= POIGNEE + 2:
                return nom
        return None

    def _fond_page(self, source_index: int | None):
        """Rendu PNG de la page d'origine, mis en cache par (index, zoom)."""
        if source_index is None or not self.lecteur.ouvert:
            return None
        cle = (source_index, round(self.zoom, 2))
        if cle in self._fonds:
            return self._fonds[cle]
        donnees = self.lecteur.rendre(source_index, self.zoom)
        if donnees is None:
            return None
        if PIL_DISPO:
            image = ImageTk.PhotoImage(Image.open(io.BytesIO(donnees)))
        else:
            image = tk.PhotoImage(data=base64.b64encode(donnees))
        self._fonds[cle] = image     # référence conservée, sinon Tk libère l'image
        return image

    # ------------------------------------------------------------ navigation
    def naviguer(self, sens: int) -> None:
        """Change de page avec l'animation de défilement latéral."""
        if self._anim:
            return
        self.terminer_edition()
        cible = self.index_page + sens
        if not 0 <= cible < len(self.document.pages):
            return

        page = self.document.page(self.index_page)
        ecart = page.largeur * self.zoom + ESPACEMENT
        self._anim = True
        self._focus = cible
        self.selection = None
        self.info.fermer()
        depart = time.perf_counter()

        def etape() -> None:
            avancement = (time.perf_counter() - depart) * 1000 / DUREE_ANIM
            if avancement >= 1.0:
                self._anim = False
                self._focus = None
                self._decalage = 0.0
                self._pan_y = 0.0
                self.index_page = cible
                if self.zoom_auto:
                    self._ajuster()
                self.rafraichir()
                return
            adouci = 1 - (1 - avancement) ** 3        # sortie en douceur
            self._decalage = -sens * ecart * adouci
            self.dessiner()
            self.after(16, etape)

        etape()

    def _sur_molette(self, evenement) -> None:
        page = self.document.page(self.index_page)
        if page is None:
            return
        hauteur = page.hauteur * self.zoom
        vue = self.canevas.winfo_height() - 2 * MARGE_V
        if hauteur > vue:                     # page plus haute que la vue : on la fait défiler
            self._pan_y = max(0.0, min(hauteur - vue,
                                       self._pan_y - evenement.delta * 0.5))
            self.dessiner()
        else:                                 # sinon on change de page
            self.naviguer(-1 if evenement.delta > 0 else 1)

    # ---------------------------------------------------------- coordonnées
    def ecran_vers_page(self, x: float, y: float) -> tuple[float, float]:
        x0, y0 = self._origine
        return (x - x0) / self.zoom, (y - y0) / self.zoom

    # -------------------------------------------------------------- souris
    def _sur_clic(self, evenement) -> None:
        self.canevas.focus_set()
        self.info.fermer()
        self.terminer_edition()
        page = self.document.page(self.index_page)
        if page is None or self._anim:
            return
        x, y = self.ecran_vers_page(evenement.x, evenement.y)

        # 1. un outil est armé : on trace le cadre du futur objet
        if self.outil:
            self._mode = "creer"
            self._saisie = (x, y)
            self._apercu = (x, y, x, y)
            return

        # 2. poignée de l'objet sélectionné : redimensionnement
        poignee = self._poignee_a(evenement.x, evenement.y)
        if poignee:
            self._mode = "redimensionner"
            self._poignee = poignee
            return

        # 3. sinon : sélection puis déplacement
        self.selection = page.element_a(x, y)
        self._mode = "deplacer" if self.selection else None
        self._saisie = (x, y) if self.selection else None
        self.rafraichir()

    def _sur_glissement(self, evenement) -> None:
        if self._mode is None:
            return
        x, y = self.ecran_vers_page(evenement.x, evenement.y)

        if self._mode == "creer":
            x1, y1 = self._saisie
            self._apercu = (min(x1, x), min(y1, y), max(x1, x), max(y1, y)) \
                if self.outil != "ligne" else (x1, y1, x, y)
            self.dessiner()
        elif self._mode == "deplacer" and self.selection and self._saisie:
            self.selection.deplacer(x - self._saisie[0], y - self._saisie[1])
            self._saisie = (x, y)
            self.document.modifie = True
            self.dessiner()
        elif self._mode == "redimensionner" and self.selection:
            self._redimensionner(self.selection, self._poignee, x, y)
            self.document.modifie = True
            self.dessiner()

    def _sur_relachement(self, evenement) -> None:
        if self._mode == "creer" and self._apercu:
            x, y = self.ecran_vers_page(evenement.x, evenement.y)
            self._creer_objet(*self._apercu)
        self._mode = None
        self._poignee = None
        self._saisie = None
        self._apercu = None
        self.rafraichir()

    def _sur_survol(self, evenement) -> None:
        """Curseur adapté à ce qui se trouve sous le pointeur."""
        if self.outil:
            self._curseur("crosshair")
            return
        poignee = self._poignee_a(evenement.x, evenement.y)
        if poignee:
            self._curseur(CURSEURS.get(poignee, "sizing"))
            return
        page = self.document.page(self.index_page)
        x, y = self.ecran_vers_page(evenement.x, evenement.y)
        survole = page.element_a(x, y) if page else None
        self._curseur("fleur" if survole else "arrow")

    def _curseur(self, nom: str) -> None:
        try:
            self.canevas.configure(cursor=nom)
        except tk.TclError:                 # curseur absent sur cette plateforme
            self.canevas.configure(cursor="arrow")

    def _sur_double_clic(self, evenement) -> None:
        page = self.document.page(self.index_page)
        if page is None:
            return
        x, y = self.ecran_vers_page(evenement.x, evenement.y)
        el = page.element_a(x, y)
        if el is not None and el.type == "texte":
            self.selection = el
            self.commencer_edition(el)
        else:
            self.modifier_element()

    # ------------------------------------------------- création et poignées
    def armer_outil(self, type_element: str | None) -> None:
        """Prépare le tracé du prochain objet (ou revient au mode sélection)."""
        self.terminer_edition()
        self.outil = type_element
        self._curseur("crosshair" if type_element else "arrow")
        if type_element:
            noms = {"texte": "Zone de texte", "image": "Image",
                    "rectangle": "Rectangle", "ligne": "Ligne"}
            self.ruban.definir_contexte(
                f"{noms[type_element]} — tracez le cadre sur la page (Échap pour annuler)")
        else:
            self.ruban.definir_contexte("Sélection")

    def _creer_objet(self, x1: float, y1: float, x2: float, y2: float) -> None:
        page = self.document.page(self.index_page)
        if page is None or not self.outil:
            return
        type_element = self.outil

        if type_element == "ligne":
            largeur, hauteur = x2 - x1, y2 - y1
            if abs(largeur) < 2 and abs(hauteur) < 2:
                largeur, hauteur = 160.0, 0.0
        else:
            largeur, hauteur = x2 - x1, y2 - y1
            if largeur < MIN_TAILLE or hauteur < MIN_TAILLE:   # simple clic
                largeur, hauteur = (220.0, 60.0) if type_element == "texte" else (180.0, 90.0)

        el = Element(type=type_element, x=x1, y=y1, largeur=largeur, hauteur=hauteur)
        if type_element == "texte":
            el.style["alignement"] = "gauche"
        elif type_element == "image":
            chemin = filedialog.askopenfilename(
                title="Choisir une image",
                filetypes=[("Images", "*.png *.jpg *.jpeg *.bmp"), ("Tous", "*.*")])
            if not chemin:
                self.armer_outil(None)
                return
            el.contenu = chemin

        page.ajouter(el)
        self.selection = el
        self.document.modifie = True
        self.armer_outil(None)
        if type_element == "texte":
            self.rafraichir()
            self.commencer_edition(el)      # on tape tout de suite, comme dans Word

    def _redimensionner(self, el: Element, poignee: str, x: float, y: float) -> None:
        if el.verrouille:
            return
        if el.type == "ligne":
            if poignee == "debut":
                el.largeur += el.x - x
                el.hauteur += el.y - y
                el.x, el.y = x, y
            else:
                el.largeur, el.hauteur = x - el.x, y - el.y
            return

        gauche, haut, droite, bas = el.x, el.y, el.x2, el.y2
        if "o" in poignee:
            gauche = min(x, droite - MIN_TAILLE)
        if "e" in poignee:
            droite = max(x, gauche + MIN_TAILLE)
        if "n" in poignee:
            haut = min(y, bas - MIN_TAILLE)
        if "s" in poignee:
            bas = max(y, haut + MIN_TAILLE)
        el.x, el.y = gauche, haut
        el.largeur, el.hauteur = droite - gauche, bas - haut

    # --------------------------------------------- saisie directe sur la page
    def commencer_edition(self, el: Element | None = None) -> None:
        """Ouvre une zone de saisie à l'emplacement exact de la zone de texte."""
        el = el or self.selection
        if el is None or el.type != "texte":
            return
        self.terminer_edition()
        self.dessiner()          # garantit une origine de page à jour

        self._edition = el
        zone = tk.Text(
            self.canevas, bd=0, highlightthickness=0, wrap="word", undo=True,
            bg=el.remplissage or rb.PAPIER, fg=el.couleur or "#000000",
            insertbackground=el.couleur or "#000000",
            selectbackground=rb.ACCENT, selectforeground="#FFFFFF",
            # la sélection doit rester visible quand un menu prend le focus,
            # et aucun autre widget ne doit pouvoir se l'approprier
            inactiveselectbackground=rb.SELECTION_INACTIVE, exportselection=0,
            font=self.police_tk(el.resoudre(Fragment()), self.zoom),
            padx=0, pady=0, spacing3=0,
        )
        self._zone_edition = zone
        self._replacer_zone()
        self._remplir_zone(el)
        zone.focus_set()
        zone.mark_set("insert", "end")
        zone.bind("<KeyRelease>", self._sur_frappe)
        zone.bind("<Button-3>", lambda ev: self._menu_contextuel(ev, sur_texte=True))
        zone.bind("<Escape>", lambda _ev: self.terminer_edition())
        zone.bind("<Control-Return>", lambda _ev: self.terminer_edition())

        self.dessiner()
        self.ruban.definir_contexte("Saisie — sélectionnez du texte pour le mettre en forme")

    def _replacer_zone(self) -> None:
        """
        Recale la zone de saisie sur son cadre. Appelée à chaque redessin :
        sans ça, un changement de page, un défilement ou un redimensionnement
        de la fenêtre laisserait la saisie à son ancienne place.
        """
        zone, el = self._zone_edition, self._edition
        if zone is None or el is None:
            return
        x0, y0 = self._origine
        marge = MARGE_TEXTE * self.zoom
        zone.place(
            x=x0 + el.x * self.zoom + marge,
            y=y0 + el.y * self.zoom + marge,
            width=max(20.0, el.largeur * self.zoom - 2 * marge),
            height=max(16.0, el.hauteur * self.zoom - 2 * marge),
        )

    def _remplir_zone(self, el: Element, debut: int | None = None,
                      fin: int | None = None) -> None:
        """Recharge la zone de saisie à partir des fragments, étiquettes comprises."""
        zone = self._zone_edition
        if zone is None:
            return
        position = zone.index("insert") if zone.get("1.0", "end-1c") else "1.0"
        zone.delete("1.0", "end")
        self._etiquettes.clear()

        for numero, fragment in enumerate(el.morceaux()):
            mise_en_forme = el.resoudre(fragment)
            etiquette = f"mef{numero}"
            self._etiquettes[etiquette] = fragment
            reglages = {
                "foreground": mise_en_forme["couleur"] or "#000000",
                "background": mise_en_forme["surlignage"] or (el.remplissage or rb.PAPIER),
                "font": self.police_tk(mise_en_forme, self.zoom),
                "underline": 1 if mise_en_forme["souligne"] else 0,
                "offset": int(round(-mise_en_forme["decalage"] * self.zoom)),
            }
            zone.tag_configure(etiquette, **reglages)
            if mise_en_forme["souligne"]:
                try:      # couleur de soulignement : Tk 8.6.6 et plus
                    zone.tag_configure(etiquette, underlinefg=(
                        mise_en_forme["souligne_couleur"] or mise_en_forme["couleur"]))
                except tk.TclError:
                    pass
            zone.insert("end", fragment.texte, etiquette)

        alignement = el.style.get("alignement", "gauche")
        zone.tag_configure("alignement", justify=ALIGNEMENTS.get(alignement, "left"))
        zone.tag_add("alignement", "1.0", "end")
        self._caler_interligne(el)
        # « sel » est créée par Tk avant les nôtres, donc moins prioritaire : le
        # fond des fragments masquerait la sélection. On la repasse au-dessus.
        zone.tag_raise("sel")

        if debut is not None and fin is not None:
            zone.tag_add("sel", f"1.0 + {debut} chars", f"1.0 + {fin} chars")
            zone.mark_set("insert", f"1.0 + {fin} chars")
        else:
            try:
                zone.mark_set("insert", position)
            except tk.TclError:
                zone.mark_set("insert", "end")

    def _caler_interligne(self, el: Element) -> None:
        """
        La zone de saisie espace ses lignes selon la police ; le rendu utilise
        INTERLIGNE. On ajoute la différence pour que le texte ne saute pas
        quand on entre ou sort de la saisie.
        """
        zone = self._zone_edition
        if zone is None:
            return
        tailles = [el.resoudre(f)["taille"] for f in el.morceaux()] or [el.taille]
        reference = el.resoudre(Fragment(taille=max(tailles)))
        police = self.police_tk(reference, self.zoom)
        cible = max(tailles) * INTERLIGNE * self.zoom
        supplement = max(0, int(round(cible - police.metrics("linespace"))))
        zone.configure(spacing1=supplement, spacing2=supplement, spacing3=0)

    def _fragments_depuis_zone(self) -> list[Fragment]:
        """Reconstruit les fragments à partir du contenu et des étiquettes de la zone."""
        zone = self._zone_edition
        if zone is None:
            return []
        fragments, actives = [], []
        for genre, valeur, _position in zone.dump("1.0", "end-1c", text=True, tag=True):
            if genre == "tagon" and valeur.startswith("mef"):
                actives.append(valeur)
            elif genre == "tagoff" and valeur in actives:
                actives.remove(valeur)
            elif genre == "text":
                modele = self._etiquettes.get(actives[-1]) if actives else None
                fragments.append(replace(modele, texte=valeur) if modele is not None
                                 else Fragment(texte=valeur))
        return fragments

    def _propager_etiquettes(self) -> None:
        """
        Tk n'applique une étiquette au texte inséré que si elle est présente des
        DEUX côtés du point d'insertion. En fin de ligne ou en fin de texte, la
        frappe arrivait donc sans mise en forme. On recolle ici chaque portion
        orpheline sur l'étiquette de son voisin de gauche, sinon de droite.
        """
        zone = self._zone_edition
        if zone is None:
            return
        actives, orphelines = [], []
        for genre, valeur, position in zone.dump("1.0", "end-1c", text=True, tag=True):
            if genre == "tagon" and valeur.startswith("mef"):
                actives.append(valeur)
            elif genre == "tagoff" and valeur in actives:
                actives.remove(valeur)
            elif genre == "text" and not actives:
                orphelines.append((position, f"{position} + {len(valeur)} chars"))

        for debut, fin in orphelines:
            voisines = [t for t in zone.tag_names(f"{debut} - 1 chars")
                        if t.startswith("mef")]
            if not voisines:
                voisines = [t for t in zone.tag_names(fin) if t.startswith("mef")]
            if voisines:
                zone.tag_add(voisines[0], debut, fin)

    def _sur_frappe(self, _evenement=None) -> None:
        """Report immédiat de la frappe dans le modèle, mise en forme comprise."""
        if self._edition is None or self._zone_edition is None:
            return
        self._propager_etiquettes()
        self._edition.definir_fragments(self._fragments_depuis_zone())
        self._zone_edition.tag_add("alignement", "1.0", "end")
        self.document.modifie = True
        self._grandir_zone()
        self._maj_etat()
        self.menu_special.rafraichir()
        self.info.rafraichir()

    def _grandir_zone(self) -> None:
        """La zone s'agrandit vers le bas quand le texte dépasse, comme dans Word."""
        zone, el = self._zone_edition, self._edition
        if zone is None or el is None:
            return
        requise = hauteur_texte(el, self.mesurer)
        if requise > el.hauteur + 0.5:
            el.hauteur = requise
            self.dessiner()          # redessine et recale la zone

    def terminer_edition(self) -> None:
        if self._zone_edition is None:
            return
        el, zone = self._edition, self._zone_edition
        if el is not None:
            el.definir_fragments(self._fragments_depuis_zone())
        self._edition, self._zone_edition = None, None
        zone.destroy()

        page = self.document.page(self.index_page)
        if el is not None and page is not None and not el.contenu.strip():
            page.supprimer(el)              # zone vide abandonnée : on la retire
            if self.selection is el:
                self.selection = None
        self.ruban.definir_contexte()
        self.rafraichir()

    # ------------------------------------------------------ mise en forme
    def aligner(self, alignement: str) -> None:
        el = self._selection_requise()
        if el is None or el.type != "texte":
            return
        el.style["alignement"] = alignement
        self.document.modifie = True
        self.rafraichir()

    def choisir_alignement(self) -> None:
        el = self._selection_requise()
        if el is None:
            return
        self.mini_menu("Alignement",
                       [("Gauche", "gauche"), ("Centre", "centre"), ("Droite", "droite")],
                       self.aligner, actif=el.style.get("alignement", "gauche"))

    def ajuster_hauteur_element(self) -> None:
        """Ajuste la hauteur de la zone de texte à son contenu."""
        el = self._selection_requise()
        if el is None or el.type != "texte":
            return
        el.hauteur = hauteur_texte(el, self.mesurer)
        self.document.modifie = True
        self.rafraichir()

    # -------------------------------------------------------------- fichier
    def _confirmer_abandon(self) -> bool:
        if not self.document.modifie:
            return True
        return messagebox.askyesno("Modifications non enregistrées",
                                   "Le document a été modifié. Continuer sans enregistrer ?")

    def _apres_chargement(self) -> None:
        self.terminer_edition()
        self.armer_outil(None)
        self.index_page = 0
        self.selection = None
        self._pan_y = 0.0
        self.zoom_auto = True
        self._ajuster()
        self.rafraichir()

    def nouveau(self) -> None:
        if not self._confirmer_abandon():
            return
        self.lecteur.fermer()
        self._fonds.clear()
        self.document = Document.nouveau("A4", 3)
        self._apres_chargement()

    def ouvrir_pdf(self) -> None:
        if not PYMUPDF_DISPO:
            messagebox.showerror("PyMuPDF manquant", "Installez-le : pip install pymupdf")
            return
        if not self._confirmer_abandon():
            return
        chemin = filedialog.askopenfilename(
            title="Ouvrir un PDF", filetypes=[("Documents PDF", "*.pdf"), ("Tous", "*.*")])
        if not chemin:
            return
        try:
            self._fonds.clear()
            self.document = self.lecteur.ouvrir(chemin)
        except Exception as erreur:
            messagebox.showerror("Ouverture impossible", str(erreur))
            return
        self._apres_chargement()

    def ouvrir_nda(self) -> None:
        if not self._confirmer_abandon():
            return
        chemin = filedialog.askopenfilename(
            title="Ouvrir un document ndaPDF",
            filetypes=[("Document ndaPDF", "*.ndaPDF"), ("Tous", "*.*")])
        if not chemin:
            return
        try:
            self.document = Document.charger(chemin)
        except Exception as erreur:
            messagebox.showerror("Ouverture impossible", str(erreur))
            return

        self._fonds.clear()
        self.lecteur.fermer()
        source = self.document.chemin_source
        if source and os.path.isfile(source) and PYMUPDF_DISPO:
            try:
                self.lecteur.ouvrir(source, extraire_texte=False,
                                    fond_sans_texte=any(
                                        el.origine == "pdf"
                                        for p in self.document.pages
                                        for el in p.elements))
            except Exception:
                pass
        self._apres_chargement()

    def enregistrer(self) -> None:
        if not self.document.chemin_nda:
            self.enregistrer_sous()
            return
        self.document.enregistrer()
        self.info.rafraichir()

    def enregistrer_sous(self) -> None:
        chemin = filedialog.asksaveasfilename(
            title="Enregistrer le document", defaultextension=".ndaPDF",
            initialfile=self.document.titre,
            filetypes=[("Document ndaPDF", "*.ndaPDF")])
        if chemin:
            self.document.enregistrer(chemin)
            self.info.rafraichir()

    def exporter(self) -> None:
        if not PYMUPDF_DISPO:
            messagebox.showerror("PyMuPDF manquant", "Installez-le : pip install pymupdf")
            return
        chemin = filedialog.asksaveasfilename(
            title="Exporter en PDF", defaultextension=".pdf",
            initialfile=self.document.titre, filetypes=[("Documents PDF", "*.pdf")])
        if not chemin:
            return
        try:
            exporter_pdf(self.document, chemin, self.lecteur)
        except Exception as erreur:
            messagebox.showerror("Export impossible", str(erreur))
            return
        messagebox.showinfo("Export terminé", f"Fichier écrit :\n{chemin}")

    # ------------------------------------------------------------- éléments
    def modifier_element(self) -> None:
        """Zone de texte : saisie directe sur la page. Autre objet : couleur."""
        el = self.selection
        if el is None:
            return
        if el.type == "texte":
            self.commencer_edition(el)
        else:
            self.definir_couleur("couleur")

    def supprimer_element(self) -> None:
        page = self.document.page(self.index_page)
        if page is None or self.selection is None:
            return
        page.supprimer(self.selection)
        self.selection = None
        self.document.modifie = True
        self.rafraichir()

    def premier_plan(self) -> None:
        page = self.document.page(self.index_page)
        if page and self.selection:
            page.premier_plan(self.selection)
            self.document.modifie = True
            self.rafraichir()

    # ------------------------------------------------- options (Menu Spécial)
    def _selection_requise(self) -> Element | None:
        if self.selection is None and self._edition is not None:
            self.selection = self._edition
        if self.selection is None:
            messagebox.showinfo("Aucune sélection",
                                "Sélectionnez d'abord un élément sur la page.")
        return self.selection

    def definir_couleur(self, champ: str) -> None:
        el = self._selection_requise()
        if el is None:
            return
        titres = {"couleur": "Couleur du trait", "remplissage": "Remplissage"}

        def appliquer(couleur: str | None) -> None:
            setattr(el, champ, couleur or "")     # None = sans fond / sans contour
            self.document.modifie = True
            self.rafraichir()

        rb.MenuCouleur(self, titres.get(champ, "Couleur"), getattr(el, champ) or None,
                       appliquer)

    # ------------------------------------------------- mise en forme du texte
    def _plage_texte(self, el: Element) -> tuple[int, int]:
        """
        Bornes à mettre en forme : la sélection en cours de saisie,
        ou tout le texte si rien n'est sélectionné.
        """
        zone = self._zone_edition
        if zone is not None and self._edition is el:
            try:
                debut = len(zone.get("1.0", "sel.first"))
                fin = len(zone.get("1.0", "sel.last"))
                if fin > debut:
                    return debut, fin
            except tk.TclError:
                pass
        return 0, len(el.contenu)

    def _style_plage(self, el: Element | None = None) -> dict:
        """Mise en forme effective au début de la plage visée."""
        el = el or self.selection
        if el is None or el.type != "texte":
            return {}
        debut, _fin = self._plage_texte(el)
        curseur = 0
        for fragment in el.morceaux():
            if curseur <= debut < curseur + len(fragment.texte):
                return el.resoudre(fragment)
            curseur += len(fragment.texte)
        return el.resoudre(el.morceaux()[-1])

    def _appliquer_texte(self, **attributs) -> None:
        """Applique une mise en forme au texte sélectionné, sinon à toute la zone."""
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            messagebox.showinfo("Zone de texte",
                                "Sélectionnez une zone de texte, puis le texte à modifier.")
            return

        if self._zone_edition is not None and self._edition is el:
            el.definir_fragments(self._fragments_depuis_zone())
        debut, fin = self._plage_texte(el)
        el.definir_fragments(appliquer_sur_plage(el.morceaux(), debut, fin, **attributs))
        self.document.modifie = True
        if self._zone_edition is not None and self._edition is el:
            self._remplir_zone(el, debut, fin)
            self._zone_edition.focus_set()
        self.rafraichir()

    def basculer_style(self, lettre: str) -> None:
        """Ajoute ou retire B (gras) / I (italique) sur le texte visé."""
        el = self.selection if self._edition is None else self._edition
        if el is None:
            return
        if el.type != "texte":
            racine = el.police.rstrip("BI")
            suffixe = el.police[len(racine):]
            suffixe = suffixe.replace(lettre, "") if lettre in suffixe else suffixe + lettre
            el.police = racine + "".join(sorted(suffixe, reverse=True))
            self.document.modifie = True
            self.rafraichir()
            return

        actuelle = self._style_plage(el)["police"] or "helv"
        racine = actuelle.rstrip("BI")
        suffixe = actuelle[len(racine):]
        suffixe = suffixe.replace(lettre, "") if lettre in suffixe else suffixe + lettre
        self._appliquer_texte(police=racine + "".join(sorted(suffixe, reverse=True)))

    def basculer_souligne(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        self._appliquer_texte(souligne=not self._style_plage(el).get("souligne", False))

    def couleur_texte(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            self.definir_couleur("couleur")
            return
        rb.MenuCouleur(self, "Couleur du texte", self._style_plage(el).get("couleur"),
                       lambda couleur: self._appliquer_texte(couleur=couleur or "#000000"))

    def surlignage_texte(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            messagebox.showinfo("Surlignage", "Sélectionnez d'abord une zone de texte.")
            return
        rb.MenuCouleur(self, "Surlignage", self._style_plage(el).get("surlignage") or None,
                       lambda couleur: self._appliquer_texte(surlignage=couleur or ""))

    def basculer_exposant(self, sens: int) -> None:
        """+1 = puissance, -1 = indice. Rappuyer sur le même revient au normal."""
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        actuel = self._style_plage(el).get("exposant", 0)
        self._appliquer_texte(exposant=0 if actuel == sens else sens)

    def souligne_couleur(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        mise = self._style_plage(el)
        rb.MenuCouleur(self, "Couleur du trait",
                       mise.get("souligne_couleur") or mise.get("couleur"),
                       lambda couleur: self._appliquer_texte(souligne=True,
                                                             souligne_couleur=couleur))

    def souligne_epaisseur(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        options = [("Automatique", None)] + [(f"{v:g} pt", v)
                                             for v in (0.5, 1.0, 1.5, 2.0, 3.0)]
        self.mini_menu("Épaisseur du trait", options,
                       lambda valeur: self._appliquer_texte(souligne=True,
                                                            souligne_epaisseur=valeur),
                       actif=self._style_plage(el).get("souligne_epaisseur"))

    def souligne_type(self) -> None:
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        actuel = next((nom for nom, motif in rb.TYPES_TRAIT.items()
                       if motif == self._style_plage(el).get("souligne_tirets")), "Plein")
        self.mini_menu("Type de trait", [(nom, nom) for nom in rb.TYPES_TRAIT],
                       lambda nom: self._appliquer_texte(
                           souligne=True, souligne_tirets=rb.TYPES_TRAIT[nom]),
                       actif=actuel)

    # ------------------------------------------------ presse-papiers d'objets
    def copier_objet(self, couper: bool = False) -> None:
        if self._edition is not None and self._zone_edition is not None:
            self._zone_edition.event_generate("<<Cut>>" if couper else "<<Copy>>")
            self._sur_frappe()
            return
        el = self._selection_requise()
        if el is None:
            return
        self._presse_papier = Element.depuis_dict(el.vers_dict())
        if couper:
            self.supprimer_element()

    def coller_objet(self) -> None:
        if self._edition is not None and self._zone_edition is not None:
            self._zone_edition.event_generate("<<Paste>>")
            self._sur_frappe()
            return
        page = self.document.page(self.index_page)
        if page is None or self._presse_papier is None:
            return
        copie = Element.depuis_dict(self._presse_papier.vers_dict())
        copie.id = uuid.uuid4().hex[:12]
        copie.x += 12
        copie.y += 12
        page.ajouter(copie)
        self.selection = copie
        self.document.modifie = True
        self.rafraichir()

    # ------------------------------------------------------ menu contextuel
    def format_objet(self) -> None:
        """Ouvre le Menu Spécial correspondant au type de l'objet sélectionné."""
        el = self.selection if self._edition is None else self._edition
        if el is None:
            return
        titre, options = rb.FORMAT_OBJET.get(el.type, rb.FORMAT_OBJET["rectangle"])
        self.menu_special.afficher(titre, options, self.lire_valeur)

    ECHELLE_TAILLES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72, 96]

    def changer_taille_texte(self, sens: int) -> None:
        """A+ / A− : taille suivante ou précédente de l'échelle."""
        el = self.selection if self._edition is None else self._edition
        if el is None or el.type != "texte":
            return
        actuelle = self._style_plage(el).get("taille_base") or el.taille
        candidates = [t for t in self.ECHELLE_TAILLES
                      if (t > actuelle if sens > 0 else t < actuelle)]
        if candidates:
            self._appliquer_texte(taille=float(min(candidates) if sens > 0
                                               else max(candidates)))

    def _outils_texte(self, el: Element) -> list[tuple[str, str]]:
        """Barre compacte de mise en forme, comme la mini barre de Word."""
        mise = self._style_plage(el)
        police = mise.get("police") or "helv"
        noms = {"helv": "Helvetica", "times": "Times", "cour": "Courier",
                "symb": "Symbol", "zadb": "Dingbats"}
        return [
            (noms.get(police.rstrip("BI"), "Helvetica") + " ▾", "police_nom"),
            (f"{mise.get('taille_base', el.taille):g} ▾", "police_taille"),
            ("A+", "texte_agrandir"), ("A−", "texte_reduire"),
            ("|", None),
            ("G", "style_gras"), ("I", "style_italique"), ("S", "style_souligne"),
            ("|", None),
            ("A", "police_couleur"), ("▨", "texte_surlignage"),
            ("|", None),
            ("X²", "texte_puissance"), ("X₂", "texte_indice"),
        ]

    def _menu_contextuel(self, evenement, sur_texte: bool = False) -> None:
        """
        Clic droit. Le menu dépend de ce qui est visé :
        le texte en cours de saisie, un objet de la page, ou la page elle-même.
        """
        page = self.document.page(self.index_page)
        if page is None:
            return

        if not sur_texte:
            x, y = self.ecran_vers_page(evenement.x, evenement.y)
            self.selection = page.element_a(x, y)
            self.rafraichir()

        el = self._edition if sur_texte else self.selection
        commandes = self.commandes
        lancer = lambda nom: commandes[nom]() if nom in commandes else None
        outils = None

        if sur_texte and el is not None:
            # clic dans le texte : mise en forme du texte, comme dans Word
            titre = "Texte"
            outils = self._outils_texte(el)
            entrees = [("Couper", "couper"), ("Copier", "copier"), ("Coller", "coller"),
                       ("-", None),
                       ("Police…", "police_nom"), ("Taille…", "police_taille"),
                       ("Couleur du texte…", "police_couleur"),
                       ("Surlignage…", "texte_surlignage"),
                       ("Soulignement…", "souligne_couleur"),
                       ("-", None),
                       ("Alignement…", "texte_alignement"),
                       ("Format de la forme…", "format_objet")]
        elif el is not None:
            # clic sur un objet : on agit sur l'objet, pas sur son contenu
            titre = {"texte": "Zone de texte", "rectangle": "Rectangle",
                     "ligne": "Ligne", "image": "Image"}[el.type]
            entrees = [("Couper", "couper"), ("Copier", "copier"), ("Coller", "coller"),
                       ("-", None)]
            if el.type == "texte":
                entrees.append(("Modifier le texte", "modifier_element"))
            entrees += [("Premier plan", "premier_plan"),
                        ("-", None),
                        ("Format de la forme", "format_objet"),
                        ("Supprimer", "supprimer_element")]
        else:
            titre = "Page"
            entrees = [("Coller", "coller"), ("-", None),
                       ("Ajouter une page", "page_ajouter"),
                       ("Format de page", "format_page")]

        rb.MiniMenu(self, titre, entrees, lancer, outils=outils)

    def format_page(self) -> None:
        titre, options = "Format", [
            entree for groupe in rb.ONGLETS["Mise en page"]
            for entree in groupe["entrees"] if entree["libelle"] == "Format"
        ][0]["special"]
        self.menu_special.afficher(titre, options, self.lire_valeur, lie_selection=False)

    def mini_menu(self, titre: str, options: list[tuple[str, object]], action,
                  actif: object = None) -> None:
        """Ouvre un mini menu flottant près du pointeur."""
        rb.MiniMenu(self, titre, options, action, actif=actif)

    def police_nom(self) -> None:
        el = self._selection_requise()
        if el is None:
            return
        polices = [("Helvetica", "helv"), ("Times", "times"), ("Courier", "cour"),
                   ("Symbol", "symb"), ("Zapf Dingbats", "zadb")]
        actuelle = (self._style_plage(el).get("police") if el.type == "texte"
                    else el.police) or "helv"
        racine = actuelle.rstrip("BI")
        suffixe = actuelle[len(racine):]

        def appliquer(nom: str) -> None:
            complet = nom + (suffixe if nom not in ("symb", "zadb") else "")
            if el.type == "texte":
                self._appliquer_texte(police=complet)
            else:
                el.police = complet
                self.document.modifie = True
                self.rafraichir()

        self.mini_menu("Nom de la police", polices, appliquer, actif=racine)

    def police_taille(self) -> None:
        el = self._selection_requise()
        if el is None:
            return
        tailles = [8, 9, 10, 11, 12, 14, 18, 24, 36]

        actuelle = (self._style_plage(el).get("taille_base") if el.type == "texte"
                    else el.taille)

        def appliquer(valeur) -> None:
            if valeur is None:
                valeur = simpledialog.askfloat("Taille", "Taille en points :",
                                               initialvalue=actuelle, minvalue=1,
                                               maxvalue=400, parent=self)
                if not valeur:
                    return
            if el.type == "texte":
                self._appliquer_texte(taille=float(valeur))
            else:
                el.taille = float(valeur)
                self.document.modifie = True
                self.rafraichir()

        options = [(f"{v} pt", float(v)) for v in tailles] + [("Autre…", None)]
        self.mini_menu("Taille", options, appliquer, actif=actuelle)

    def trait_type(self) -> None:
        el = self._selection_requise()
        if el is None:
            return
        actuel = next((nom for nom, motif in rb.TYPES_TRAIT.items()
                       if motif == el.style.get("tirets")), "Plein")

        def appliquer(nom: str) -> None:
            motif = rb.TYPES_TRAIT[nom]
            if motif:
                el.style["tirets"] = motif
            else:
                el.style.pop("tirets", None)
            self.document.modifie = True
            self.rafraichir()

        self.mini_menu("Type de trait", [(nom, nom) for nom in rb.TYPES_TRAIT],
                       appliquer, actif=actuel)

    def trait_epaisseur(self) -> None:
        el = self._selection_requise()
        if el is None:
            return
        epaisseurs = [0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0]

        def appliquer(valeur) -> None:
            if valeur is None:
                valeur = simpledialog.askfloat("Épaisseur", "Épaisseur en points :",
                                               initialvalue=el.epaisseur, minvalue=0.1,
                                               maxvalue=50, parent=self)
                if not valeur:
                    return
            el.epaisseur = float(valeur)
            self.document.modifie = True
            self.rafraichir()

        options = [(f"{v:g} pt", v) for v in epaisseurs] + [("Autre…", None)]
        self.mini_menu("Épaisseur", options, appliquer, actif=el.epaisseur)

    def definir_format(self, nom: str) -> None:
        page = self.document.page(self.index_page)
        if page is None:
            return
        page.largeur, page.hauteur = FORMATS_PAGE[nom]
        self.document.modifie = True
        if self.zoom_auto:
            self._ajuster()
        self.rafraichir()

    # ---------------------------------------------------------------- pages
    def page_ajouter(self) -> None:
        self.document.ajouter_page(self.index_page + 1)
        self.rafraichir()
        self.naviguer(1)

    def page_dupliquer(self) -> None:
        if self.document.dupliquer_page(self.index_page):
            self.rafraichir()
            self.naviguer(1)

    def page_supprimer(self) -> None:
        if self.document.supprimer_page(self.index_page):
            self.index_page = min(self.index_page, len(self.document.pages) - 1)
            self.selection = None
            self.rafraichir()
        else:
            messagebox.showinfo("Suppression impossible",
                                "Un document doit contenir au moins une page.")

    def deplacer_page(self, sens: int) -> None:
        cible = self.index_page + sens
        if self.document.deplacer_page(self.index_page, cible):
            self.index_page = cible
            self.rafraichir()

    def page_pivoter(self) -> None:
        page = self.document.page(self.index_page)
        if page:
            page.pivoter(90)
            self.document.modifie = True
            self.rafraichir()

    # ----------------------------------------------------------------- zoom
    def _ajuster(self) -> None:
        page = self.document.page(self.index_page)
        vue = self.canevas.winfo_height() - 2 * MARGE_V
        if page and vue > 60:
            self.zoom = vue / page.hauteur

    def definir_zoom(self, valeur: float) -> None:
        self.terminer_edition()
        self.zoom_auto = False
        self.zoom = max(0.1, min(6.0, valeur))
        self._pan_y = 0.0
        self.rafraichir()

    def changer_zoom(self, sens: int) -> None:
        proches = [z for z in ZOOMS if (z > self.zoom if sens > 0 else z < self.zoom)]
        if proches:
            self.definir_zoom(min(proches) if sens > 0 else max(proches))

    def zoom_ajuster(self) -> None:
        self.zoom_auto = True
        self._pan_y = 0.0
        self._ajuster()
        self.rafraichir()

    # ---------------------------------------------- Information Éditeur (1-5)
    def _info(self, numero: str) -> tuple[str, list[str]]:
        page = self.document.page(self.index_page)
        if numero == "1":
            return "Zoom", [
                f"Facteur : {self.zoom * 100:.0f} %",
                f"Mode : {'ajusté' if self.zoom_auto else 'manuel'}",
            ]
        if numero == "2":
            return "Page", [
                f"Numéro : {self.index_page + 1} / {len(self.document.pages)}",
                f"Format : {page.largeur:.0f} × {page.hauteur:.0f} pt",
                f"Rotation : {page.rotation}°",
                f"Éléments : {len(page.elements)}",
                f"Page source : {page.source_index if page.source_index is not None else '—'}",
            ]
        if numero == "3":
            return "Document", [
                f"Titre : {self.document.titre}",
                f"Pages : {len(self.document.pages)}",
                f"État : {'modifié' if self.document.modifie else 'enregistré'}",
                f"Fichier : {os.path.basename(self.document.chemin_nda) or '—'}",
                f"Source : {os.path.basename(self.document.chemin_source) or '—'}",
            ]
        if numero == "4":
            el = self.selection
            if el is None:
                return "Sélection", ["Aucun élément sélectionné."]
            return "Sélection", [
                f"Type : {el.type}",
                f"Position : {el.x:.0f} ; {el.y:.0f} pt",
                f"Taille : {el.largeur:.0f} × {el.hauteur:.0f} pt",
                f"Police : {el.police}  ·  {el.taille:.0f} pt",
                f"Couleur : {el.couleur}",
                f"Alignement : {el.style.get('alignement', 'gauche')}",
                f"Origine : {el.origine}",
            ]
        return "Système", [
            f"PyMuPDF : {'oui' if PYMUPDF_DISPO else 'non'}",
            f"Pillow : {'oui' if PIL_DISPO else 'non'}",
            "Format interne : .ndaPDF",
        ]

    def a_propos(self) -> None:
        messagebox.showinfo(
            "À propos",
            "ndaPDF — éditeur PDF libre\n\n"
            "document.py : modèle .ndaPDF\n"
            "lecteur.py  : import / rendu / export PDF\n"
            "ruban.py    : menus, ruban, menu spécial\n"
            "editeur.py  : présentation\n\n"
            f"PyMuPDF : {'oui' if PYMUPDF_DISPO else 'non'}   |   "
            f"Pillow : {'oui' if PIL_DISPO else 'non'}",
        )


if __name__ == "__main__":
    Editeur().mainloop()