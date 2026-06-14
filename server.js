import { Router } from "express";
import { supabase } from "../server.js";
import { requireAuth } from "../lib/middleware.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("channels")
    .select("*, connections(*)")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.post("/", async (req, res) => {
  const { name, handle, tagline, niche, logo } = req.body;
  if (!name || !niche) return res.status(400).json({ error: "name and niche required" });
  const { data, error } = await supabase
    .from("channels")
    .insert({ user_id: req.user.id, name, handle, tagline, niche, logo })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("channels")
    .select("*, connections(*), videos(*)")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .single();
  if (error || !data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

router.delete("/:id", async (req, res) => {
  await supabase.from("channels").delete().eq("id", req.params.id).eq("user_id", req.user.id);
  res.json({ ok: true });
});

export default router;
