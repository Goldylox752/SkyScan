import express from "express";
import cors from "cors";
import Stripe from "stripe";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();

/* =========================
   ENV + CLIENTS
========================= */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BASE_URL = process.env.BASE_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;
const SUPPLIER_WEBHOOK = process.env.SUPPLIER_WEBHOOK;

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

// Stripe requires raw body
const stripeRaw = express.raw({ type: "application/json" });

/* =========================
   HELPERS
========================= */
const safeNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const log = (tag, data) => {
  console.log(`[${tag}]`, JSON.stringify(data));
};

/* =========================
   1. PRODUCTS (STORE FRONT)
========================= */
app.get("/products", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  res.json(data || []);
});

/* =========================
   2. CREATE CHECKOUT (ATOMIC ORDER ENGINE)
========================= */
app.post("/create-checkout", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { sku } = req.body;

  if (!sku) {
    return res.status(400).json({ error: "Missing SKU", requestId });
  }

  try {
    /* FETCH PRODUCT */
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Product not found", requestId });
    }

    const price = safeNumber(product.price);

    if (!price || price <= 0) {
      return res.status(400).json({ error: "Invalid price", requestId });
    }

    if (product.stock <= 0) {
      return res.status(400).json({ error: "Out of stock", requestId });
    }

    /* RESERVE STOCK (OPTIMISTIC LOCK) */
    const { error: stockErr } = await supabase
      .from("products")
      .update({
        stock: product.stock - 1
      })
      .eq("sku", sku)
      .eq("stock", product.stock);

    if (stockErr) {
      return res.status(409).json({
        error: "Stock changed, retry",
        requestId
      });
    }

    /* CREATE ORDER */
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        sku,
        product_id: product.id,
        status: "pending",
        amount: price,
        request_id: requestId
      })
      .select()
      .single();

    if (orderErr) {
      return res.status(500).json({ error: "Order failed", requestId });
    }

    /* STRIPE SESSION */
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              description: product.description || "Meridian Market product"
            },
            unit_amount: Math.round(price * 100)
          },
          quantity: 1
        }
      ],

      metadata: {
        sku,
        order_id: order.id,
        request_id: requestId
      },

      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/cancel`
    });

    /* ATTACH SESSION */
    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    res.json({
      url: session.url,
      requestId
    });

  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Server error", requestId });
  }
});

/* =========================
   3. STRIPE WEBHOOK (SOURCE OF TRUTH)
========================= */
app.post("/stripe-webhook", stripeRaw, async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { order_id, sku } = session.metadata;

      /* IDENTITY CHECK */
      const { data: order } = await supabase
        .from("orders")
        .select("status")
        .eq("id", order_id)
        .single();

      if (order?.status === "paid") {
        return res.json({ received: true });
      }

      /* MARK PAID */
      await supabase
        .from("orders")
        .update({
          status: "paid",
          stripe_session_id: session.id
        })
        .eq("id", order_id);

      /* TRIGGER FULFILLMENT */
      await fetch(`${BASE_URL}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, order_id })
      });
    }

    res.json({ received: true });

  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook failure" });
  }
});

/* =========================
   4. FULFILLMENT ENGINE
========================= */
app.post("/fulfill", async (req, res) => {
  const { sku, order_id } = req.body;

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .single();

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  try {
    await fetch(SUPPLIER_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        order_id,
        product_name: product.name,
        supplier_url: product.supplier_url
      })
    });

    await supabase
      .from("orders")
      .update({ status: "fulfilled" })
      .eq("id", order_id);

    res.json({ ok: true });

  } catch (err) {
    console.error("Fulfillment error:", err);
    res.status(500).json({ error: "Fulfillment failed" });
  }
});

/* =========================
   5. PRODUCT IMPORT PIPELINE (AI ENTRY)
========================= */
app.post("/import-product", async (req, res) => {
  const ali = req.body;

  const cost = safeNumber(ali.price);

  if (!cost) {
    return res.status(400).json({ error: "Invalid price" });
  }

  const product = {
    sku: crypto.randomUUID(),
    name: ali.title,
    description: ali.description || "AI imported product",
    cost_price: cost,
    price: Number((cost * 2.2).toFixed(2)),
    image_url: ali.image,
    supplier_url: ali.url,
    stock: 100,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("products")
    .insert(product)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json(data);
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Meridian Market OS running on port ${PORT}`);
});