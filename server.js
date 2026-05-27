import express from "express";
import cors from "cors";
import Stripe from "stripe";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

const jsonRaw = express.raw({ type: "application/json" });

/* =========================
   1. PRODUCTS API
========================= */
app.get("/products", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* =========================
   2. CHECKOUT ENGINE (SAFE + ATOMIC)
========================= */
app.post("/create-checkout", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { sku } = req.body;

  if (!sku) {
    return res.status(400).json({ error: "Missing SKU", requestId });
  }

  try {
    // 1. fetch product
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Product not found", requestId });
    }

    if (product.stock <= 0) {
      return res.status(400).json({ error: "Out of stock", requestId });
    }

    const price = Number(product.price);
    if (!price || price <= 0) {
      return res.status(500).json({ error: "Invalid price", requestId });
    }

    // 2. reserve stock (simple lock)
    const { error: stockError } = await supabase
      .from("products")
      .update({ stock: product.stock - 1 })
      .eq("sku", sku)
      .eq("stock", product.stock);

    if (stockError) {
      return res.status(409).json({
        error: "Stock changed, retry",
        requestId
      });
    }

    // 3. create order
    const { data: order, error: orderError } = await supabase
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

    if (orderError) {
      return res.status(500).json({ error: "Order failed", requestId });
    }

    // 4. Stripe session
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              description: product.description || "RoofFlow product"
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

      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`
    });

    // 5. attach session
    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    res.json({ url: session.url, requestId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   3. STRIPE WEBHOOK (SOURCE OF TRUTH)
========================= */
app.post("/stripe-webhook", jsonRaw, async (req, res) => {
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { sku, order_id } = session.metadata;

    // idempotent safety: prevent double processing
    const { data: order } = await supabase
      .from("orders")
      .select("status")
      .eq("id", order_id)
      .single();

    if (order?.status === "paid") {
      return res.json({ received: true });
    }

    // mark paid
    await supabase
      .from("orders")
      .update({
        status: "paid",
        stripe_session_id: session.id
      })
      .eq("id", order_id);

    // trigger fulfillment pipeline
    await fetch(`${process.env.BASE_URL}/fulfill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, order_id })
    });
  }

  res.json({ received: true });
});

/* =========================
   4. FULFILLMENT ENGINE (DROPSHIP LAYER)
========================= */
app.post("/fulfill", async (req, res) => {
  const { sku, order_id } = req.body;

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .single();

  if (!product) return res.status(404).json({ error: "Product not found" });

  // send to supplier (AliExpress agent / webhook / automation tool)
  await fetch(process.env.SUPPLIER_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sku,
      order_id,
      product_name: product.name,
      supplier_url: product.supplier_url,
      quantity: 1
    })
  });

  await supabase
    .from("orders")
    .update({ status: "fulfilled" })
    .eq("id", order_id);

  res.json({ ok: true });
});

/* =========================
   5. PRODUCT IMPORT PIPELINE
========================= */
app.post("/import-product", async (req, res) => {
  const ali = req.body;

  const cost = Number(ali.price || 0);
  if (!cost) return res.status(400).json({ error: "Invalid product price" });

  const mapped = {
    sku: crypto.randomUUID(),
    name: ali.title,
    description: ali.description || "Imported product",
    cost_price: cost,
    price: Number((cost * 2.2).toFixed(2)),
    image_url: ali.image,
    supplier_url: ali.url,
    stock: 100,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("products")
    .insert(mapped)
    .select()
    .single();

  if (error) return res.status(500).json(error);

  res.json(data);
});

/* =========================
   START SERVER
========================= */
app.listen(3000, () => {
  console.log("🚀 RoofFlow OS running on port 3000");
});