import express          from "express";
import cors             from "cors";
import helmet           from "helmet";
import rateLimit        from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import dotenv           from "dotenv";
import crypto           from "crypto";
import fetch            from "node-fetch";

dotenv.config();

// ── Clients ───────────────────────────────────────────────────────────────────
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true }));

// ── Middleware ────────────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });
  req.user = user;
  next();
}

// ── Encryption ────────────────────────────────────────────────────────────────
function encryptTokens(tokens) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY || "a".repeat(64), "hex");
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptTokens(enc) {
  const key  = Buffer.from(process.env.ENCRYPTION_KEY || "a".repeat(64), "hex");
  const buf  = Buffer.from(enc, "base64");
  const iv   = buf.slice(0, 12);
  const tag  = buf.slice(12, 28);
  const data = buf.slice(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post("/api/auth/signup", async (req, res) => {
  const { email, password, name } = req.body;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── Channel routes ────────────────────────────────────────────────────────────
app.get("/api/channels", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("channels").select("*, connections(*)")
    .eq("user_id", req.user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/channels", requireAuth, async (req, res) => {
  const { name, handle, tagline, niche, logo } = req.body;
  if (!name || !niche) return res.status(400).json({ error: "name and niche required" });
  const { data, error } = await supabase
    .from("channels").insert({ user_id: req.user.id, name, handle, tagline, niche, logo })
    .select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/channels/:id", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("channels").select("*, connections(*), videos(*)")
    .eq("id", req.params.id).eq("user_id", req.user.id).single();
  if (error || !data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

app.delete("/api/channels/:id", requireAuth, async (req, res) => {
  await supabase.from("channels").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

// ── Ideas routes ──────────────────────────────────────────────────────────────
app.post("/api/ideas/generate", requireAuth, async (req, res) => {
  const { channelId, niche, channelName } = req.body;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 1000,
        messages: [{ role: "user", content: `Generate 5 viral short-video ideas for channel "${channelName}" in niche: ${niche}. Return ONLY valid JSON array: [{"title":"...","hook":"...","score":90}]` }]
      })
    });
    const d = await r.json();
    const raw = d.content?.[0]?.text?.replace(/```json|```/g, "").trim() || "[]";
    const ideas = JSON.parse(raw).map(x => ({ ...x, id: crypto.randomUUID() }));
    // Save to DB
    if (channelId) {
      for (const idea of ideas) {
        await supabase.from("ideas").insert({ channel_id: channelId, title: idea.title, hook: idea.hook, score: idea.score });
      }
    }
    res.json(ideas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/ideas/script", requireAuth, async (req, res) => {
  const { title, hook, niche, channelName } = req.body;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6", max_tokens: 1200,
        messages: [{ role: "user", content: `Write a 60-second script for "${title}" (niche: ${niche}). Return ONLY valid JSON: {"narration":"...","scenes":[{"id":1,"prompt":"...","duration":5,"text":"..."}],"hashtags":["#tag"],"description":"..."}` }]
      })
    });
    const d = await r.json();
    const raw = d.content?.[0]?.text?.replace(/```json|```/g, "").trim() || "{}";
    res.json(JSON.parse(raw));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Voice route ───────────────────────────────────────────────────────────────
app.post("/api/voice/generate", requireAuth, async (req, res) => {
  const { text, voiceId } = req.body;
  const vid = voiceId || "21m00Tcm4TlvDq8ikWAM";
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
    });
    if (!r.ok) throw new Error(await r.text());
    const buf = Buffer.from(await r.arrayBuffer());
    res.set("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Pipeline status ───────────────────────────────────────────────────────────
app.get("/api/pipeline/channel/:channelId", requireAuth, async (req, res) => {
  const { data } = await supabase
    .from("pipeline_runs").select("*")
    .eq("channel_id", req.params.channelId)
    .order("created_at", { ascending: false }).limit(20);
  res.json(data || []);
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get("/api/analytics/summary", requireAuth, async (req, res) => {
  const { data } = await supabase.from("user_stats").select("*").eq("id", req.user.id).single();
  res.json(data || {});
});

// ── OAuth ─────────────────────────────────────────────────────────────────────
const OAUTH_CONFIGS = {
  youtube: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: process.env.YOUTUBE_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  },
  tiktok: {
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    clientId: process.env.TIKTOK_CLIENT_KEY,
    scope: "user.info.basic,video.publish,video.upload",
  },
  instagram: {
    authUrl: "https://api.instagram.com/oauth/authorize",
    clientId: process.env.INSTAGRAM_CLIENT_ID,
    scope: "instagram_basic,instagram_content_publish",
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    clientId: process.env.FACEBOOK_APP_ID,
    scope: "pages_manage_posts,publish_video",
  },
};

app.get("/oauth/:platform/connect", async (req, res) => {
  const { platform } = req.params;
  const { channelId } = req.query;
  const cfg = OAUTH_CONFIGS[platform];
  if (!cfg || !cfg.clientId) return res.status(400).json({ error: "Platform not configured" });
  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${process.env.API_URL}/oauth/${platform}/callback`;
  const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri, scope: cfg.scope, response_type: "code", state, access_type: "offline", prompt: "consent" });
  res.redirect(`${cfg.authUrl}?${params}`);
});

app.get("/oauth/:platform/callback", async (req, res) => {
  const { platform } = req.params;
  const { code, error } = req.query;
  if (error) return res.redirect(`${process.env.FRONTEND_URL}?oauth_error=${error}`);
  res.redirect(`${process.env.FRONTEND_URL}?connected=${platform}&code=${code}`);
});

// ── Videos ────────────────────────────────────────────────────────────────────
app.get("/api/videos/channel/:channelId", requireAuth, async (req, res) => {
  const { data } = await supabase
    .from("videos").select("*, publishes(*)")
    .eq("channel_id", req.params.channelId)
    .order("created_at", { ascending: false });
  res.json(data || []);
});

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get("/api/admin/users", requireAuth, async (req, res) => {
  const { data } = await supabase.from("user_stats").select("*");
  res.json(data || []);
});

app.get("/api/admin/stats", requireAuth, async (req, res) => {
  const [users, videos, analytics] = await Promise.all([
    supabase.from("profiles").select("id, status, plan"),
    supabase.from("videos").select("id, status"),
    supabase.from("analytics").select("views, subs_gained"),
  ]);
  const totalViews = (analytics.data || []).reduce((a, r) => a + (r.views || 0), 0);
  const totalSubs  = (analytics.data || []).reduce((a, r) => a + (r.subs_gained || 0), 0);
  res.json({
    total_users:   users.data?.length || 0,
    active_users:  users.data?.filter(u => u.status === "active").length || 0,
    total_videos:  videos.data?.length || 0,
    total_views:   totalViews,
    total_subs:    totalSubs,
  });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ContentOS API running on port ${PORT}`));
