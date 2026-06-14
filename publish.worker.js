// ════════════════════════════════════════════════════════
// ContentOS — Backend Server
// Node.js + Express + BullMQ (Redis) + Supabase
// ════════════════════════════════════════════════════════
import express          from "express";
import cors             from "cors";
import helmet           from "helmet";
import rateLimit        from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { Queue }        from "bullmq";
import IORedis          from "ioredis";
import dotenv           from "dotenv";

import authRoutes     from "./routes/auth.js";
import channelRoutes  from "./routes/channels.js";
import pipelineRoutes from "./routes/pipeline.js";
import publishRoutes  from "./routes/publish.js";
import analyticsRoutes from "./routes/analytics.js";
import oauthRoutes    from "./routes/oauth.js";

dotenv.config();

// ── Clients ───────────────────────────────────────────────────────────────────
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY          // service key — server only, never client
);

export const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,               // required by BullMQ
});

// Job queues
export const pipelineQueue = new Queue("pipeline", { connection: redis });
export const publishQueue  = new Queue("publish",  { connection: redis });

// ── App ───────────────────────────────────────────────────────────────────────
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// Global rate limit
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",      authRoutes);
app.use("/api/channels",  channelRoutes);
app.use("/api/pipeline",  pipelineRoutes);
app.use("/api/publish",   publishRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/oauth",         oauthRoutes);       // /oauth/youtube /oauth/tiktok etc.

// Health
app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

// Error handler
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ContentOS API on :${PORT}`));
