import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/* ─────────────────────────────
   SERVER INIT
───────────────────────────── */
const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60
  })
);

/* ─────────────────────────────
   DB
───────────────────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ─────────────────────────────
   INTENTS (your AI logic)
───────────────────────────── */
const intents = [
  {
    name: "buying",
    keywords: ["buy", "price", "order"],
    reply: "Best products available now.",
    score: 0.95
  }
];

/* ─────────────────────────────
   INTENT ENGINE
───────────────────────────── */
function detectIntent(message = "") {
  const text = message.toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const intent of intents) {
    const matches = intent.keywords.filter(k => text.includes(k)).length;

    if (matches > 0) {
      const score = matches * intent.score;

      if (score > bestScore) {
        bestScore = score;
        best = intent;
      }
    }
  }

  return best;
}

/* ─────────────────────────────
   BOT ENDPOINT (API)
───────────────────────────── */
app.post("/api/bot", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    const id = sessionId || crypto.randomUUID();

    const intent = detectIntent(message);

    const reply = intent
      ? intent.reply
      : "Tell me what you're building.";

    /* store conversation */
    await supabase.from("conversations").insert({
      session_id: id,
      message,
      reply,
      intent: intent?.name || "fallback"
    });

    /* enqueue event */
    await supabase.from("event_queue").insert({
      type: "user_intent",
      status: "pending",
      attempts: 0,
      run_after: new Date().toISOString(),
      payload: { sessionId: id, message }
    });

    return res.json({
      text: reply,
      sessionId: id
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

/* ─────────────────────────────
   WORKER (INSIDE SAME FILE)
───────────────────────────── */

let running = false;

/* claim jobs */
async function claimJobs() {
  const { data } = await supabase
    .from("event_queue")
    .update({ status: "processing" })
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .select("*")
    .limit(10);

  return data || [];
}

/* process job */
async function handleJob(job) {
  switch (job.type) {
    case "user_intent":
      await supabase.from("events").insert({
        type: "processed",
        payload: job.payload
      });
      return;
  }
}

/* worker loop */
async function processQueue() {
  const jobs = await claimJobs();

  for (const job of jobs) {
    try {
      await handleJob(job);

      await supabase
        .from("event_queue")
        .update({ status: "completed" })
        .eq("id", job.id);

    } catch (err) {
      await supabase
        .from("event_queue")
        .update({
          status: job.attempts > 5 ? "failed" : "pending",
          attempts: (job.attempts || 0) + 1,
          run_after: new Date(Date.now() + 30000)
        })
        .eq("id", job.id);
    }
  }
}

/* interval worker */
setInterval(async () => {
  if (running) return;
  running = true;

  try {
    await processQueue();
  } finally {
    running = false;
  }
}, 5000);

/* ─────────────────────────────
   START SERVER
───────────────────────────── */
app.listen(3000, () => {
  console.log("Server running on port 3000");
});