// ════════════════════════════════════════════════════════
// lib/middleware.js  —  Auth middleware
// ════════════════════════════════════════════════════════
import { supabase } from "../server.js";

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });

  req.user = user;
  next();
}
