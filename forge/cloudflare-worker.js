// =====================================================================
// Forge — Worker Cloudflare pour le cloud de fichiers (stockage R2)
//
// À coller dans Cloudflare > Workers & Pages > ton Worker > Modifier le code.
// Réglages nécessaires (onglet « Paramètres » du Worker) :
//   Liaison R2 :  BUCKET          -> ton bucket R2 (ex. forge-cloud)
//   Variable   :  SUPABASE_URL    -> https://xxxx.supabase.co
//   Variable   :  SUPABASE_KEY    -> la clé publishable / anon de Supabase
//   Secret     :  SIGN_SECRET     -> une longue phrase secrète au hasard
//   Variable   :  ALLOWED_ORIGIN  -> https://entarsh-studio.github.io
//
// Règles :
//   - il faut être connecté à Forge (session Supabase) pour tout, sauf
//     pour ouvrir un lien signé, qui expire tout seul ;
//   - chacun ne peut envoyer ou supprimer que dans son propre dossier
//     (ses fichiers) ; tout le monde (connecté) peut lire tous les fichiers.
// =====================================================================

const MAX_UPLOAD = 95 * 1024 * 1024;      // un envoi = un morceau (< 100 Mo, limite des Workers)
const MAX_TTL = 24 * 3600;                // durée maximale d'un lien signé (s)
const authCache = new Map();
let usageCache = { at: 0, bytes: 0, files: 0 };

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "*";
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Type, ETag",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (o, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!env.BUCKET) return json({ error: "Liaison R2 « BUCKET » manquante dans les réglages du Worker" }, 500);
    if (!env.SIGN_SECRET) return json({ error: "Secret « SIGN_SECRET » manquant dans les réglages du Worker" }, 500);

    const url = new URL(req.url);
    try {
      // ---------- lecture par lien signé (images, vidéos, téléchargements) ----------
      if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/f/")) {
        const key = decodeURIComponent(url.pathname.slice(3));
        const exp = Number(url.searchParams.get("e"));
        const sig = url.searchParams.get("s") || "";
        if (!exp || exp < Date.now() / 1000) return json({ error: "Lien expiré" }, 403);
        if (!(await verify(env, key + "|" + exp, sig))) return json({ error: "Lien invalide" }, 403);

        const hasRange = req.headers.has("Range");
        const obj = req.method === "HEAD"
          ? await env.BUCKET.head(key)
          : await env.BUCKET.get(key, hasRange ? { range: req.headers } : undefined);
        if (!obj) return json({ error: "Fichier introuvable" }, 404);

        const h = new Headers(cors);
        obj.writeHttpMetadata(h);
        h.set("ETag", obj.httpEtag);
        h.set("Accept-Ranges", "bytes");
        h.set("Cache-Control", "private, max-age=3600");
        const dl = url.searchParams.get("dl");
        if (dl) h.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(dl));

        if (req.method === "HEAD") { h.set("Content-Length", String(obj.size)); return new Response(null, { headers: h }); }
        if (hasRange && obj.range) {
          const off = obj.range.offset ?? (obj.range.suffix != null ? obj.size - obj.range.suffix : 0);
          const len = obj.range.length ?? (obj.size - off);
          h.set("Content-Range", `bytes ${off}-${off + len - 1}/${obj.size}`);
          h.set("Content-Length", String(len));
          return new Response(obj.body, { status: 206, headers: h });
        }
        h.set("Content-Length", String(obj.size));
        return new Response(obj.body, { headers: h });
      }

      if (url.pathname === "/" || url.pathname === "/ping") return json({ ok: true, service: "forge-cloud" });

      // ---------- tout le reste demande d'être connecté ----------
      const user = await authUser(req, env);
      if (!user) return json({ error: "Non connecté (session Forge invalide ou expirée)" }, 401);

      // liens signés pour lire des fichiers
      if (url.pathname === "/sign" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const keys = Array.isArray(body.keys) ? body.keys.slice(0, 500) : [];
        const ttl = Math.min(MAX_TTL, Math.max(60, Number(body.ttl) || 6 * 3600));
        const exp = Math.floor(Date.now() / 1000) + ttl;
        const base = url.origin + "/f/";
        const urls = {};
        for (const k of keys) {
          if (typeof k !== "string" || !k || k.length > 1000) continue;
          urls[k] = base + encodeURIComponent(k) + "?e=" + exp + "&s=" + (await hmac(env, k + "|" + exp));
        }
        return json({ urls, expires: exp });
      }

      // place utilisée dans le bucket
      if (url.pathname === "/usage" && req.method === "GET") {
        if (Date.now() - usageCache.at > 60000) {
          let bytes = 0, files = 0, cursor;
          do {
            const page = await env.BUCKET.list({ cursor, limit: 1000 });
            for (const o of page.objects) { bytes += o.size; files++; }
            cursor = page.truncated ? page.cursor : undefined;
          } while (cursor);
          usageCache = { at: Date.now(), bytes, files };
        }
        return json({ bytes: usageCache.bytes, files: usageCache.files });
      }

      // envoi / suppression : seulement dans son propre dossier
      if (url.pathname.startsWith("/o/")) {
        const key = decodeURIComponent(url.pathname.slice(3));
        if (!key.startsWith(user.id + "/") || key.includes("..") || key.length > 1000)
          return json({ error: "Tu ne peux modifier que tes propres fichiers" }, 403);

        if (req.method === "PUT") {
          const len = Number(req.headers.get("Content-Length") || 0);
          if (!len) return json({ error: "Fichier vide ou taille inconnue" }, 411);
          if (len > MAX_UPLOAD) return json({ error: "Morceau trop gros (95 Mo maximum par envoi)" }, 413);
          if (await env.BUCKET.head(key)) return json({ error: "Un fichier porte déjà ce nom" }, 409);
          const ct = req.headers.get("Content-Type") || "application/octet-stream";
          await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: ct } });
          usageCache.at = 0;
          return json({ ok: true, key });
        }
        if (req.method === "DELETE") {
          await env.BUCKET.delete(key);
          usageCache.at = 0;
          return json({ ok: true });
        }
      }

      return json({ error: "Adresse inconnue" }, 404);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};

// Vérifie la session Forge auprès de Supabase (résultat gardé 1 minute)
async function authUser(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  const hit = authCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/auth/v1/user", {
    headers: { Authorization: "Bearer " + token, apikey: env.SUPABASE_KEY },
  });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.id) return null;
  if (authCache.size > 500) authCache.clear();
  authCache.set(token, { user: { id: u.id }, exp: Date.now() + 60000 });
  return { id: u.id };
}

async function hmac(env, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  let b = ""; for (const c of s) b += String.fromCharCode(c);
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verify(env, msg, sig) {
  const good = await hmac(env, msg);
  if (good.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < good.length; i++) d |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}
