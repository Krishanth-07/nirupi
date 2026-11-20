import { Router } from "express";
import { createLiveToken, WARMUP_INSTRUCTION } from "../ai/live.js";

export const liveTokenRouter = Router();

/** Warm-up voice check (no repo needed). */
liveTokenRouter.post("/live-token", async (_req, res) => {
  try {
    res.json(await createLiveToken(WARMUP_INSTRUCTION));
  } catch (err) {
    console.error("[live-token]", err);
    res.status(500).json({ error: "We couldn't open a voice session right now. Please try again in a moment." });
  }
});
