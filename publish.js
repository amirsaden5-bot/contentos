import { Router } from "express";
import { supabase } from "../server.js";

const router = Router();

router.post("/signup", async (req, res) => {
  const { email, password, name } = req.body;
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name } }
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post("/logout", async (req, res) => {
  await supabase.auth.signOut();
  res.json({ ok: true });
});

export default router;
