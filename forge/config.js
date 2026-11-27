// Remplace ces deux valeurs par celles de ton projet Supabase
// (Supabase > Project Settings > API).
// La clé "anon public" peut être publique : la sécurité est assurée par supabase.sql.
window.FORGE_CONFIG = {
  url: "https://nipojbslomagcjpvosnk.supabase.co",
  // Taille du stockage Supabase en Go (1 sur l’offre gratuite, 100 sur l’offre Pro)
  storageGB: 1,
  anonKey: "sb_publishable_e1s4ftSwoxQBbDCBsJqW_g_-CSRha1K",
  // Cloud de 10 Go (Backblaze B2 via un Worker Cloudflare) : colle ici l'adresse du Worker (voir README).
  // Laisse tel quel pour garder le cloud sur Supabase.
  r2Worker: "https://TON-WORKER.workers.dev",
  // Taille du cloud externe en Go (10 gratuits chez Backblaze)
  r2StorageGB: 10
};
