// ════════════════════════════════════════════════════════
// routes/pipeline.js
// Triggers and monitors video production jobs
// ════════════════════════════════════════════════════════
import { Router } from "express";
import { supabase, pipelineQueue } from "../server.js";
import { requireAuth } from "../lib/middleware.js";

const router = Router();
router.use(requireAuth);

// POST /api/pipeline/start
// Body: { channelId, approvedIdeaIds }
router.post("/start", async (req, res) => {
  const { channelId, approvedIdeaIds } = req.body;
  if (!channelId || !approvedIdeaIds?.length)
    return res.status(400).json({ error: "channelId and approvedIdeaIds required" });

  // Verify channel belongs to user
  const { data: channel, error } = await supabase
    .from("channels")
    .select("id, niche, name")
    .eq("id", channelId)
    .eq("user_id", req.user.id)
    .single();
  if (error || !channel) return res.status(404).json({ error: "Channel not found" });

  // Create a pipeline_run record
  const { data: run } = await supabase
    .from("pipeline_runs")
    .insert({ channel_id: channelId, status: "queued", stage: "ideas" })
    .select()
    .single();

  // Enqueue the job
  await pipelineQueue.add(
    "produce-video",
    { runId: run.id, channelId, approvedIdeaIds, niche: channel.niche, channelName: channel.name },
    { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
  );

  res.json({ runId: run.id, status: "queued" });
});

// GET /api/pipeline/:runId — poll status
router.get("/:runId", async (req, res) => {
  const { data: run } = await supabase
    .from("pipeline_runs")
    .select("*, videos(*)")
    .eq("id", req.params.runId)
    .single();
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});

// GET /api/pipeline/channel/:channelId — all runs for a channel
router.get("/channel/:channelId", async (req, res) => {
  const { data: runs } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("channel_id", req.params.channelId)
    .order("created_at", { ascending: false })
    .limit(20);
  res.json(runs || []);
});

export default router;
