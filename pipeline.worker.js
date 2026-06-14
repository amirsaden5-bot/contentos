// ════════════════════════════════════════════════════════
// routes/publish.js
// Publishes a ready video to one or more platforms
// ════════════════════════════════════════════════════════
import { Router } from "express";
import { supabase, publishQueue } from "../server.js";
import { requireAuth } from "../lib/middleware.js";

const router = Router();
router.use(requireAuth);

// POST /api/publish
// Body: { videoId, platforms: ["youtube","tiktok","instagram","facebook"] }
router.post("/", async (req, res) => {
  const { videoId, platforms } = req.body;
  if (!videoId || !platforms?.length)
    return res.status(400).json({ error: "videoId and platforms required" });

  // Verify video is ready and belongs to user
  const { data: video } = await supabase
    .from("videos")
    .select("*, channels!inner(user_id)")
    .eq("id", videoId)
    .eq("channels.user_id", req.user.id)
    .single();

  if (!video)           return res.status(404).json({ error: "Video not found" });
  if (video.status !== "ready")
    return res.status(400).json({ error: `Video status is "${video.status}", must be "ready"` });

  const jobs = [];
  for (const platform of platforms) {
    const job = await publishQueue.add(
      "publish-video",
      { videoId, channelId: video.channel_id, platform },
      { attempts: 3, backoff: { type: "exponential", delay: 8000 } }
    );
    jobs.push({ platform, jobId: job.id });
  }

  res.json({ queued: jobs });
});

// GET /api/publish/:videoId — check publish status per platform
router.get("/:videoId", async (req, res) => {
  const { data } = await supabase
    .from("publishes")
    .select("*")
    .eq("video_id", req.params.videoId);
  res.json(data || []);
});

export default router;
