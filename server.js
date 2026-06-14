import express          from "express";
import cors             from "cors";
import helmet           from "helmet";
import rateLimit        from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";
import { Queue }        from "bullmq";
import IORedis          from "ioredis";
import dotenv           from "dotenv";

import authRoutes      from "./auth.js";
import channelRoutes   from "./channels.js";
import pipelineRoutes  from "./pipeline.js";
import publishRoutes   from "./publish.js";
import analyticsRoutes from "./analytics.js";
import oauthRoutes     from "./oauth.js";

dotenv.config();

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const pipelineQueue = new Queue("pipeline", { connection: redis });
export const publishQueue  = new Queue("publish",  { connection: redis });

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true }));

app.use("/api/auth",      authRoutes);
app.use("/api/channels",  channelRoutes);
app.use("/api/pipeline",  pipelineRoutes);
app.use("/api/publish",   publishRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/oauth",         oauthRoutes);

app.get("/health", (_, res) => res.json({ ok: true, ts: Date.now() }));

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ContentOS API on :${PORT}`));
