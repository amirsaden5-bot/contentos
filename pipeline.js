import { Router } from "express";
import { supabase } from "../server.js";
import { requireAuth } from "../lib/middleware.js";

const router = Router();
router.use(requireAuth);

router.get("/channel/:channelId", async (req, res) => {
  const { data } = await supabase
    .from("analytics")
    .select("*")
    .eq("user_id", req.user.id)
    .order("date", { ascending: false })
    .limit(30);
  res.json(data || []);
});

router.get("/summary", async (req, res) => {
  const { data } = await supabase
    .from("user_stats")
    .select("*")
    .eq("id", req.user.id)
    .single();
  res.json(data || {});
});

export default router;
