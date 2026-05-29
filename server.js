import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ─────────────────────────────
   MIDDLEWARE
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
   SUPABASE (DATABASE LAYER)
───────────────────────────── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ─────────────────────────────
   AUTH + STORE RESOLUTION (SHOPIFY CORE CONCEPT)
───────────────────────────── */

async function getStore(req) {
  const storeId = req.headers["x-store-id"];
  const apiKey = req.headers["x-api-key"];

  if (!storeId || !apiKey) return null;

  const { data } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .eq("api_key", apiKey)
    .single();

  return data;
}

/* ─────────────────────────────
   PRODUCTS (REAL INVENTORY MODEL)
───────────────────────────── */

// Create product
app.post("/api/products", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Unauthorized store" });

  const { name, price, stock, metadata } = req.body;

  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: store.id,
      name,
      price,
      stock: stock ?? 0,
      reserved_stock: 0,
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
  if (!store) return res.status(401).json({ error: "Unauthorized store" });

  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", store.id);

  res.json(data);
});

/* ─────────────────────────────
   CHECKOUT SESSION (SHOPIFY-LIKE FLOW)
───────────────────────────── */

app.post("/api/checkout", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Unauthorized store" });

  const { items } = req.body;

  const sessionId = crypto.randomUUID();

  // reserve stock (important for real commerce systems)
  for (const item of items) {
    await supabase.rpc("reserve_stock", {
      product_id: item.productId,
      quantity: item.quantity
    });
  }

  const session = await supabase
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
    checkoutId: session.data.id,
    url: `${process.env.FRONTEND_URL}/checkout/${sessionId}`
  });
});

/* ─────────────────────────────
   STRIPE PAYMENT SESSION (REAL MONEY FLOW)
───────────────────────────── */

app.post("/api/payments/create-session", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Unauthorized store" });

  const { items } = req.body;

  const line_items = items.map(i => ({
    price_data: {
      currency: "usd",
      product_data: {
        name: i.name
      },
      unit_amount: Math.round(i.price * 100)
    },
    quantity: i.quantity
  }));

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items,
    success_url: `${process.env.FRONTEND_URL}/success`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`
  });

  res.json({ url: session.url });
});

/* ─────────────────────────────
   ORDERS (REAL COMMERCE OBJECT)
───────────────────────────── */

app.post("/api/orders", async (req, res) => {
  const store = await getStore(req);
  if (!store) return res.status(401).json({ error: "Unauthorized store" });

  const { checkoutId } = req.body;

  const { data: checkout } = await supabase
    .from("checkouts")
    .select("*")
    .eq("id", checkoutId)
    .single();

  if (!checkout) return res.status(404).json({ error: "Checkout not found" });

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
   AI MERCHANT ENGINE
───────────────────────────── */

app.post("/api/bot", async (req, res) => {
  const { message, sessionId } = req.body;

  const id = sessionId || crypto.randomUUID();
  const text = message.toLowerCase();

  let reply = "What would you like to build?";

  if (text.includes("price")) {
    reply = "Meridian Market starts at $9.99/month with AI commerce tools.";
  }

  if (text.includes("sell")) {
    reply = "I can help you create products, set pricing, and increase conversions.";
  }

  if (text.includes("shopify")) {
    reply = "This is a next-gen commerce OS with AI automation + native checkout.";
  }

  await supabase.from("conversations").insert({
    session_id: id,
    message,
    reply
  });

  res.json({ text: reply, sessionId: id });
});

/* ─────────────────────────────
   WEBHOOK EVENT PIPELINE
───────────────────────────── */

app.post("/api/webhooks", async (req, res) => {
  const event = req.body;

  await supabase.from("events").insert({
    id: crypto.randomUUID(),
    type: event.type || "generic",
    payload: event,
    created_at: new Date().toISOString()
  });

  res.json({ ok: true });
});

/* ─────────────────────────────
   START SERVER
───────────────────────────── */

app.listen(3000, () => {
  console.log("🚀 Meridian Commerce OS (Phase 2) running on port 3000");
});