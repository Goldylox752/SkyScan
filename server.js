import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

/* ─────────────────────────────
   CORE MIDDLEWARE
───────────────────────────── */
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120
  })
);

/* ─────────────────────────────
   DB (Supabase)
───────────────────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ─────────────────────────────
   MULTI-TENANT CORE (SHOPIFY STYLE)
───────────────────────────── */

/**
 * Each request belongs to a "store"
 */
async function getStore(req) {
  const storeId = req.headers["x-store-id"];
  if (!storeId) return null;

  const { data } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .single();

  return data;
}

/* ─────────────────────────────
   PRODUCTS API (Shopify Core)
───────────────────────────── */

// Create product
app.post("/api/products", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Missing store" });

  const { name, price, stock, metadata } = req.body;

  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: store.id,
      name,
      price,
      stock,
      metadata: metadata || {}
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error });

  res.json(data);
});

// List products
app.get("/api/products", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Missing store" });

  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", store.id);

  res.json(data);
});

/* ─────────────────────────────
   CART + CHECKOUT (REAL COMMERCE FLOW)
───────────────────────────── */

// Create checkout session
app.post("/api/checkout", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Missing store" });

  const { items } = req.body;

  const sessionId = crypto.randomUUID();

  const { data } = await supabase
    .from("checkouts")
    .insert({
      id: sessionId,
      store_id: store.id,
      items,
      status: "pending"
    })
    .select()
    .single();

  res.json({
    checkoutId: data.id,
    url: `${process.env.FRONTEND_URL}/checkout/${data.id}`
  });
});

/* ─────────────────────────────
   ORDERS (SHOPIFY CORE OBJECT)
───────────────────────────── */

app.post("/api/orders", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Missing store" });

  const { checkoutId } = req.body;

  const { data: checkout } = await supabase
    .from("checkouts")
    .select("*")
    .eq("id", checkoutId)
    .single();

  if (!checkout) {
    return res.status(404).json({ error: "Checkout not found" });
  }

  const orderId = crypto.randomUUID();

  const { data } = await supabase
    .from("orders")
    .insert({
      id: orderId,
      store_id: store.id,
      items: checkout.items,
      status: "paid"
    })
    .select()
    .single();

  await supabase
    .from("checkouts")
    .update({ status: "completed" })
    .eq("id", checkoutId);

  res.json(data);
});

/* ─────────────────────────────
   AI MERCHANT ENGINE (UPGRADED)
───────────────────────────── */

app.post("/api/bot", async (req, res) => {
  const { message, sessionId } = req.body;

  const id = sessionId || crypto.randomUUID();
  const text = message.toLowerCase();

  let reply = "What would you like to build in your store?";

  if (text.includes("price")) {
    reply = "Meridian Market starts at $9.99/month. You can create products, stores, and automate sales.";
  }

  if (text.includes("sell")) {
    reply = "I can help you list products, set pricing, and optimize conversions.";
  }

  if (text.includes("shopify")) {
    reply = "Meridian Market is a next-gen commerce OS with AI automation and native checkout flows.";
  }

  await supabase.from("conversations").insert({
    session_id: id,
    message,
    reply
  });

  res.json({
    text: reply,
    sessionId: id
  });
});

/* ─────────────────────────────
   BASIC WEBHOOK SYSTEM (EXTENSIBLE)
───────────────────────────── */

app.post("/api/webhooks", async (req, res) => {
  const event = req.body;

  await supabase.from("events").insert({
    type: event.type || "generic",
    payload: event
  });

  res.json({ ok: true });
});

/* ─────────────────────────────
   START SERVER
───────────────────────────── */

app.listen(3000, () => {
  console.log("🚀 Meridian Commerce OS running on :3000");
});