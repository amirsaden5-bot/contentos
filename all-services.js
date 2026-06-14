// ════════════════════════════════════════════════════════
// routes/oauth.js  —  OAuth 2.0 for all 4 platforms
//
// Flow per platform:
//   1. GET /oauth/:platform/connect?channelId=xxx
//      → redirects user to the platform's auth URL
//   2. GET /oauth/:platform/callback?code=xxx&state=xxx
//      → exchanges code for tokens, saves to DB, redirects back
// ════════════════════════════════════════════════════════
import { Router } from "express";
import crypto     from "crypto";
import { supabase } from "../server.js";
import {
  youtubeTokenExchange,
  tiktokTokenExchange,
  instagramTokenExchange,
  facebookTokenExchange,
} from "../services/oauth-exchange.js";

const router = Router();

// ── Config per platform ───────────────────────────────────────────────────────
const CONFIGS = {
  youtube: {
    authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
    clientId:   process.env.YOUTUBE_CLIENT_ID,
    scope:      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    exchange:   youtubeTokenExchange,
  },
  tiktok: {
    authUrl:    "https://www.tiktok.com/v2/auth/authorize/",
    clientId:   process.env.TIKTOK_CLIENT_KEY,
    scope:      "user.info.basic,video.publish,video.upload",
    exchange:   tiktokTokenExchange,
  },
  instagram: {
    authUrl:    "https://api.instagram.com/oauth/authorize",
    clientId:   process.env.INSTAGRAM_CLIENT_ID,
    scope:      "instagram_basic,instagram_content_publish,pages_read_engagement",
    exchange:   instagramTokenExchange,
  },
  facebook: {
    authUrl:    "https://www.facebook.com/v19.0/dialog/oauth",
    clientId:   process.env.FACEBOOK_APP_ID,
    scope:      "pages_manage_posts,pages_read_engagement,publish_video",
    exchange:   facebookTokenExchange,
  },
};

// ── Step 1: redirect to platform ─────────────────────────────────────────────
router.get("/:platform/connect", async (req, res) => {
  const { platform } = req.params;
  const { channelId } = req.query;
  const cfg = CONFIGS[platform];
  if (!cfg) return res.status(400).json({ error: "Unknown platform" });

  // CSRF token stored in Redis (10 min TTL)
  const state = crypto.randomBytes(16).toString("hex");
  await req.app.locals.redis.set(`oauth:state:${state}`, channelId, "EX", 600);

  const redirectUri = `${process.env.API_URL}/oauth/${platform}/callback`;

  const params = new URLSearchParams({
    client_id:     cfg.clientId,
    redirect_uri:  redirectUri,
    scope:         cfg.scope,
    response_type: "code",
    state,
    access_type:   "offline",   // Google: get refresh_token
    prompt:        "consent",   // Google: always show consent (fresh tokens)
  });

  res.redirect(`${cfg.authUrl}?${params}`);
});

// ── Step 2: handle callback ───────────────────────────────────────────────────
router.get("/:platform/callback", async (req, res) => {
  const { platform } = req.params;
  const { code, state, error } = req.query;
  const cfg = CONFIGS[platform];

  if (error)  return res.redirect(`${process.env.FRONTEND_URL}?oauth_error=${error}`);
  if (!cfg)   return res.status(400).json({ error: "Unknown platform" });
  if (!code)  return res.status(400).json({ error: "No code received" });

  // Verify CSRF state
  const channelId = await req.app.locals.redis.get(`oauth:state:${state}`);
  if (!channelId) return res.status(403).json({ error: "Invalid or expired state" });
  await req.app.locals.redis.del(`oauth:state:${state}`);

  const redirectUri = `${process.env.API_URL}/oauth/${platform}/callback`;

  // Exchange code for tokens (platform-specific)
  const tokens = await cfg.exchange(code, redirectUri);
  // tokens = { access_token, refresh_token, expires_in, platform_user_id, platform_username }

  // Encrypt tokens before saving (AES-256-GCM)
  const encrypted = encryptTokens(tokens);

  // Upsert into connections table
  const { error: dbErr } = await supabase
    .from("connections")
    .upsert({
      channel_id:   channelId,
      platform,
      tokens_enc:   encrypted,
      platform_uid: tokens.platform_user_id,
      username:     tokens.platform_username,
      connected_at: new Date().toISOString(),
    }, { onConflict: "channel_id,platform" });

  if (dbErr) {
    console.error("DB upsert error:", dbErr);
    return res.redirect(`${process.env.FRONTEND_URL}?oauth_error=db`);
  }

  // Back to frontend with success flag
  res.redirect(`${process.env.FRONTEND_URL}/channels/${channelId}?connected=${platform}`);
});

// ── Encryption helper (AES-256-GCM) ──────────────────────────────────────────
function encryptTokens(tokens) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");   // 32-byte hex key
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain  = JSON.stringify(tokens);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptTokens(enc) {
  const key  = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const buf  = Buffer.from(enc, "base64");
  const iv   = buf.slice(0, 12);
  const tag  = buf.slice(12, 28);
  const data = buf.slice(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

export default router;
