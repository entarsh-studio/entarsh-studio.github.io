// =====================================================================
// Forge — Worker Cloudflare pour le cloud de fichiers
//
// Le Worker vérifie qu'on est connecté à Forge, puis range les fichiers
// dans Backblaze B2 (10 Go gratuits, sans carte bancaire).
// (Il sait aussi utiliser Cloudflare R2 si une liaison « BUCKET » existe.)
//
// Réglages du Worker (Settings > Variables and Secrets) :
//   SUPABASE_URL    (Text)   https://xxxx.supabase.co
//   SUPABASE_KEY    (Text)   la clé publishable / anon de Supabase
//   ALLOWED_ORIGIN  (Text)   https://entarsh-studio.github.io
//   SIGN_SECRET     (Secret) une longue phrase secrète au hasard
//   B2_ENDPOINT     (Text)   ex. https://s3.eu-central-003.backblazeb2.com
//   B2_REGION       (Text)   ex. eu-central-003
//   B2_BUCKET       (Text)   ex. forge-cloud-entarsh
//   B2_KEY_ID       (Text)   le keyID de la clé d'application Backblaze
//   B2_APP_KEY      (Secret) l'applicationKey de Backblaze
//
// Règles : il faut être connecté à Forge pour tout (sauf ouvrir un lien
// signé, qui expire tout seul) ; chacun n'envoie et ne supprime que dans
// son propre dossier ; tout le monde (connecté) peut lire tous les fichiers.
// =====================================================================

const MAX_UPLOAD = 95 * 1024 * 1024;      // un envoi = un morceau (< 100 Mo, limite des Workers gratuits)
const MAX_TTL = 24 * 3600;
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
    const st = store(env);
    if (!st) return json({ error: "Stockage non configuré : ajoute les variables B2_… (ou une liaison R2 « BUCKET »)" }, 500);
    if (!env.SIGN_SECRET) return json({ error: "Secret « SIGN_SECRET » manquant dans les réglages du Worker" }, 500);

    const url = new URL(req.url);
    try {
      // ---------- lecture par lien signé ----------
      if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/f/")) {
        const key = decodeURIComponent(url.pathname.slice(3));
        const exp = Number(url.searchParams.get("e"));
        const sig = url.searchParams.get("s") || "";
        if (!exp || exp < Date.now() / 1000) return json({ error: "Lien expiré" }, 403);
        if (!(await verify(env, key + "|" + exp, sig))) return json({ error: "Lien invalide" }, 403);
        const r = await st.get(key, req.method, req.headers.get("Range"));
        if (!r) return json({ error: "Fichier introuvable" }, 404);
        const h = new Headers(cors);
        for (const [k, v] of Object.entries(r.headers)) if (v != null) h.set(k, v);
        h.set("Accept-Ranges", "bytes");
        h.set("Cache-Control", "private, max-age=3600");
        const dl = url.searchParams.get("dl");
        if (dl) h.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(dl));
        return new Response(req.method === "HEAD" ? null : r.body, { status: r.status, headers: h });
      }

      if (url.pathname === "/" || url.pathname === "/ping") return json({ ok: true, service: "forge-cloud", storage: st.name });

      // ---------- tout le reste demande d'être connecté ----------
      const user = await authUser(req, env);
      if (!user) return json({ error: "Non connecté (session Forge invalide ou expirée)" }, 401);

      if (url.pathname === "/sign" && req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const keys = Array.isArray(body.keys) ? body.keys.slice(0, 500) : [];
        const ttl = Math.min(MAX_TTL, Math.max(60, Number(body.ttl) || 6 * 3600));
        const exp = Math.floor(Date.now() / 1000) + ttl;
        const urls = {};
        for (const k of keys) {
          if (typeof k !== "string" || !k || k.length > 1000) continue;
          urls[k] = url.origin + "/f/" + encodeURIComponent(k) + "?e=" + exp + "&s=" + (await hmac(env, k + "|" + exp));
        }
        return json({ urls, expires: exp });
      }

      if (url.pathname === "/usage" && req.method === "GET") {
        if (Date.now() - usageCache.at > 120000) usageCache = { at: Date.now(), ...(await st.usage()) };
        return json({ bytes: usageCache.bytes, files: usageCache.files, storage: st.name });
      }

      if (url.pathname.startsWith("/o/")) {
        const key = decodeURIComponent(url.pathname.slice(3));
        if (!key.startsWith(user.id + "/") || key.includes("..") || key.length > 1000)
          return json({ error: "Tu ne peux modifier que tes propres fichiers" }, 403);
        if (req.method === "PUT") {
          const len = Number(req.headers.get("Content-Length") || 0);
          if (!len) return json({ error: "Fichier vide ou taille inconnue" }, 411);
          if (len > MAX_UPLOAD) return json({ error: "Morceau trop gros (95 Mo maximum par envoi)" }, 413);
          if (await st.exists(key)) return json({ error: "Un fichier porte déjà ce nom" }, 409);
          await st.put(key, req.body, len, req.headers.get("Content-Type") || "application/octet-stream");
          usageCache.at = 0;
          return json({ ok: true, key });
        }
        if (req.method === "DELETE") {
          await st.del(key);
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

// ---------------------------------------------------------------------
// Stockages
// ---------------------------------------------------------------------
function store(env) {
  if (env.B2_ENDPOINT && env.B2_BUCKET && env.B2_KEY_ID && env.B2_APP_KEY) return b2Store(env);
  if (env.BUCKET) return r2Store(env.BUCKET);
  return null;
}

function r2Store(B) {
  return {
    name: "Cloudflare R2",
    async exists(k) { return !!(await B.head(k)); },
    async put(k, body, len, ct) { await B.put(k, body, { httpMetadata: { contentType: ct } }); },
    async del(k) { await B.delete(k); },
    async get(k, method, range) {
      const h = range ? new Headers({ Range: range }) : null;
      const o = method === "HEAD" ? await B.head(k) : await B.get(k, h ? { range: h } : undefined);
      if (!o) return null;
      const hh = new Headers(); o.writeHttpMetadata(hh);
      const headers = { "Content-Type": hh.get("Content-Type") || "application/octet-stream", ETag: o.httpEtag };
      if (range && o.range && method !== "HEAD") {
        const off = o.range.offset ?? (o.range.suffix != null ? o.size - o.range.suffix : 0);
        const len = o.range.length ?? (o.size - off);
        headers["Content-Range"] = `bytes ${off}-${off + len - 1}/${o.size}`;
        headers["Content-Length"] = String(len);
        return { status: 206, headers, body: o.body };
      }
      headers["Content-Length"] = String(o.size);
      return { status: 200, headers, body: o.body };
    },
    async usage() {
      let bytes = 0, files = 0, cursor;
      do { const p = await B.list({ cursor, limit: 1000 }); for (const o of p.objects) { bytes += o.size; files++; } cursor = p.truncated ? p.cursor : undefined; } while (cursor);
      return { bytes, files };
    },
  };
}

function b2Store(env) {
  const s3 = (method, key, opt) => s3Fetch(env, method, key, opt);
  const fail = async (r, what) => { const t = await r.text().catch(() => ""); const m = /<Message>([^<]*)<\/Message>/.exec(t); throw new Error("Backblaze (" + what + ") : " + (m ? m[1] : "erreur " + r.status)); };
  return {
    name: "Backblaze B2",
    // Backblaze répond 403 (et non 404) quand un fichier n'existe pas encore : on le traite comme « absent ».
    // Les noms de fichiers sont de toute façon uniques (date + code au hasard).
    async exists(k) { const r = await s3("HEAD", k); return r.ok; },
    async put(k, body, len, ct) {
      let b = body;
      if (typeof FixedLengthStream !== "undefined" && body) { const fl = new FixedLengthStream(len); body.pipeTo(fl.writable); b = fl.readable; }
      const r = await s3("PUT", k, { body: b, headers: { "Content-Type": ct, "Content-Length": String(len) } });
      if (!r.ok) await fail(r, "envoi");
    },
    async del(k) { const r = await s3("DELETE", k); if (!r.ok && r.status !== 404) await fail(r, "suppression"); },
    async get(k, method, range) {
      const r = await s3(method === "HEAD" ? "HEAD" : "GET", k, { headers: range ? { Range: range } : {} });
      if (r.status === 404) return null;
      if (!r.ok) await fail(r, "lecture");
      const pick = (n) => r.headers.get(n);
      return { status: r.status, body: r.body, headers: { "Content-Type": pick("Content-Type"), "Content-Length": pick("Content-Length"), "Content-Range": pick("Content-Range"), ETag: pick("ETag") } };
    },
    async usage() {
      let bytes = 0, files = 0, token = "";
      for (let i = 0; i < 200; i++) {
        const q = { "list-type": "2", "max-keys": "1000" }; if (token) q["continuation-token"] = token;
        const r = await s3("GET", null, { query: q });
        if (!r.ok) await fail(r, "mesure");
        const x = await r.text();
        for (const m of x.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); files++; }
        const t = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(x);
        if (/<IsTruncated>true<\/IsTruncated>/.test(x) && t) token = t[1].replace(/&amp;/g, "&"); else break;
      }
      return { bytes, files };
    },
  };
}

// ---------------------------------------------------------------------
// Signature AWS (S3) pour Backblaze B2
// ---------------------------------------------------------------------
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256hex(s) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))); }
async function hmacRaw(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? new TextEncoder().encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}
async function s3Sign(env, method, key, query, now) {
  const ep = new URL(String(env.B2_ENDPOINT).replace(/\/$/, ""));
  const region = env.B2_REGION || (ep.host.match(/^s3\.([^.]+)\./) || [])[1] || "us-east-1";
  const path = "/" + enc(env.B2_BUCKET) + (key != null ? "/" + String(key).split("/").map(enc).join("/") : "");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const cq = Object.keys(query || {}).sort().map((k) => enc(k) + "=" + enc(query[k])).join("&");
  const sh = { host: ep.host, "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amzDate };
  const names = Object.keys(sh).sort();
  const creq = [method, path, cq, names.map((n) => n + ":" + sh[n] + "\n").join(""), names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const scope = day + "/" + region + "/s3/aws4_request";
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256hex(creq)].join("\n");
  let k = await hmacRaw("AWS4" + env.B2_APP_KEY, day);
  k = await hmacRaw(k, region); k = await hmacRaw(k, "s3"); k = await hmacRaw(k, "aws4_request");
  const sig = hex(await hmacRaw(k, sts));
  return {
    url: ep.origin + path + (cq ? "?" + cq : ""),
    headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD", "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` },
  };
}
async function s3Fetch(env, method, key, opt = {}) {
  const s = await s3Sign(env, method, key, opt.query, new Date());
  const init = { method, headers: { ...s.headers, ...(opt.headers || {}) } };
  if (opt.body) { init.body = opt.body; init.duplex = "half"; }
  return fetch(s.url, init);
}

// ---------------------------------------------------------------------
// Session Forge (Supabase) + liens signés
// ---------------------------------------------------------------------
async function authUser(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_KEY) return null;
  const hit = authCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(String(env.SUPABASE_URL).replace(/\/$/, "") + "/auth/v1/user", { headers: { Authorization: "Bearer " + token, apikey: env.SUPABASE_KEY } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || !u.id) return null;
  if (authCache.size > 500) authCache.clear();
  authCache.set(token, { user: { id: u.id }, exp: Date.now() + 60000 });
  return { id: u.id };
}
async function hmac(env, msg) {
  const s = new Uint8Array(await hmacRaw(env.SIGN_SECRET, msg));
  let b = ""; for (const c of s) b += String.fromCharCode(c);
  return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function verify(env, msg, sig) {
  const good = await hmac(env, msg);
  if (good.length !== sig.length) return false;
  let d = 0; for (let i = 0; i < good.length; i++) d |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return d === 0;
}

export { s3Sign };
