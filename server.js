import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

/* ───────── APP ───────── */
const app = express();

/* ───────── MIDDLEWARE ───────── */
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" }
  })
);

/* ───────── SUPABASE ───────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ───────── INTENTS (UNCHANGED) ───────── */
const intents = [/* same as yours */];

/* ───────── INTENT DETECTOR (UNCHANGED) ───────── */
function detectIntent(message = "") {
  const text = message.toLowerCase();

  let best = null;
  let bestScore = 0;

  for (const intent of intents) {
    const matches = intent.keywords.reduce(
      (acc, k) => acc + (text.includes(k) ? 1 : 0),
      0
    );

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

/* ───────── RESPONSE ENGINE ───────── */
function generateReply(intent) {
  if (!intent) {
    return {
      text: "Tell me what you're trying to sell or build — I can show you winning products instantly.",
      type: "fallback",
      confidence: 0.25
    };
  }

  return {
    text: intent.reply,
    type: intent.name,
    confidence: intent.score
  };
}

/* ───────── SCORING (UNCHANGED) ───────── */
function scoreOpportunity(message, intent) {
  let score = 10;

  if (message.length > 50) score += 10;
  if (message.includes("best")) score += 10;

  switch (intent?.name) {
    case "buying":
      score += 30;
      break;
    case "product_research":
      score += 25;
      break;
    case "dropshipping":
      score += 20;
      break;
  }

  return Math.min(score, 100);
}

/* ─────────────────────────────────────────────
   BOT ENGINE (UNCHANGED)
──────────────────────────────────────────── */
app.post("/api/bot", async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }

    const id = sessionId || crypto.randomUUID();

    const intent = detectIntent(message);
    const reply = generateReply(intent);
    const score = scoreOpportunity(message, intent);

    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("session_id", id)
      .limit(1);

    const isNewSession = !existing || existing.length === 0;

    if (isNewSession) {
      await supabase.from("conversations").insert([
        {
          session_id: id,
          message,
          reply: reply.text,
          intent: reply.type,
          opportunity_score: score,
          confidence: reply.confidence,
          created_at: new Date().toISOString()
        }
      ]);
    }

    // 🔥 QUEUE EVENT INSTEAD OF DIRECT INSERT (NEW SYSTEM)
    await supabase.from("event_queue").insert([
      {
        type: "user_intent",
        status: "pending",
        payload: {
          sessionId: id,
          message,
          intent: reply.type,
          score
        }
      }
    ]);

    return res.json({
      ...reply,
      opportunityScore: score,
      sessionId: id
    });

  } catch (err) {
    console.error("Meridian Engine Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ─────────────────────────────────────────────
   🔥 EVENT WORKER (NEW)
──────────────────────────────────────────── */
async function processEventQueue() {
  const { data: events } = await supabase
    .from("event_queue")
    .select("*")
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .limit(10);

  if (!events?.length) return;

  for (const event of events) {
    try {
      await handleEvent(event);

      await supabase
        .from("event_queue")
        .update({
          status: "completed",
          updated_at: new Date().toISOString()
        })
        .eq("id", event.id);

    } catch (err) {
      await supabase
        .from("event_queue")
        .update({
          status:
            (event.attempts || 0) + 1 >= 5 ? "failed" : "pending",

          attempts: (event.attempts || 0) + 1,
          last_error: err.message,
          run_after: new Date(Date.now() + 30000).toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", event.id);

      console.error("❌ Worker event failed:", err.message);
    }
  }
}

/* ───────── EVENT HANDLER ───────── */
async function handleEvent(event) {
  const payload = event.payload;

  switch (event.type) {
    case "user_intent": {
      // Example: analytics tracking / enrichment

      await supabase.from("events").insert([
        {
          type: "processed_intent",
          intent: payload.intent,
          score: payload.score,
          created_at: new Date().toISOString()
        }
      ]);

      return;
    }

    default:
      return;
  }
}

/* ─────────────────────────────────────────────
   🔥 WORKER LOOP (RUNS IN BACKGROUND)
──────────────────────────────────────────── */
setInterval(() => {
  processEventQueue().catch((err) =>
    console.error("Worker crash:", err)
  );
}, 5000);

/* ───────── HEALTH ───────── */
app.get("/", (req, res) => {
  res.json({
    status: "online",
    system: "Meridian Market AI Engine",
    mode: "event-driven + queue worker"
  });
});

/* ───────── START ───────── */
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`🚀 Meridian Engine running on port ${port}`);
});