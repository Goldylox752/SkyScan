import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// RATE LIMITING (anti spam)
// =========================
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
});

app.use(limiter);

// =========================
// IN-MEMORY SESSION STORE (swap for Redis in prod)
// =========================
const sessions = new Map();

// =========================
// LEAD SCORING (SERVER TRUTH)
// =========================
const SCORE_MAP = {
  page_view: 1,
  click: 2,
  product_view: 5,
  checkout_click: 10,
  stripe_click: 20,
};

function getSession(session_id) {
  if (!sessions.has(session_id)) {
    sessions.set(session_id, {
      score: 0,
      stage: "COLD",
      events: [],
      createdAt: Date.now(),
    });
  }
  return sessions.get(session_id);
}

function calculateStage(score) {
  if (score >= 25) return "HOT";
  if (score >= 10) return "WARM";
  return "COLD";
}

// =========================
// TRACK EVENT
// =========================
app.post("/api/hot-lead", (req, res) => {
  const { event, session_id, user_id, data } = req.body;

  if (!session_id || !event) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const session = getSession(session_id);

  const scoreAdd = SCORE_MAP[event] || 0;
  session.score += scoreAdd;
  session.stage = calculateStage(session.score);

  session.events.push({
    event,
    data,
    timestamp: Date.now(),
  });

  // HOT LEAD DETECTION
  const isHot = session.stage === "HOT";

  console.log("📊 EVENT:", {
    user_id,
    session_id,
    event,
    score: session.score,
    stage: session.stage,
  });

  return res.json({
    success: true,
    score: session.score,
    stage: session.stage,
    hot: isHot,
  });
});

// =========================
// CHECKOUT CLICK TRACKING
// =========================
app.post("/api/checkout-click", (req, res) => {
  const { session_id } = req.body;

  const session = getSession(session_id);
  session.score += 10;

  res.json({ ok: true });
});

// =========================
// STRIPE CHECKOUT (SECURE VERSION)
// =========================
app.post("/api/create-checkout", async (req, res) => {
  const { session_id } = req.body;

  const session = getSession(session_id);

  // BLOCK fake low-intent users
  if (session.score < 8) {
    return res.status(403).json({
      error: "Not qualified for checkout",
    });
  }

  // HOT users bypass friction
  const checkoutUrl =
    session.score >= 25
      ? "https://buy.stripe.com/9B6eV64qDcT20xpeDC2ZO0i"
      : "https://buy.stripe.com/test-checkout-link";

  res.json({ url: checkoutUrl });
});

// =========================
// SESSION STATUS (for frontend UI)
// =========================
app.get("/api/session/:id", (req, res) => {
  const session = getSession(req.params.id);

  res.json(session);
});

app.listen(3000, () => {
  console.log("🚀 Skymaster OS running on port 3000");
});