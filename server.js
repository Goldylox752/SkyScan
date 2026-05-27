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

app.use(cors());
app.use(express.json());

/* =========================
   1. PRODUCTS API (STORE)
========================= */
app.get("/products", async (req, res) => {
  const { data, error } = await supabase.from("products").select("*");

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* =========================
   2. CHECKOUT ENGINE
========================= */
app.post("/create-checkout", async (req, res) => {
  const requestId = crypto.randomUUID();
  const { sku } = req.body;

  if (!sku) return res.status(400).json({ error: "Missing SKU" });

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .single();

  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product.stock <= 0) return res.status(400).json({ error: "Out of stock" });

  // reserve stock (anti oversell)
  await supabase
    .from("products")
    .update({ stock: product.stock - 1 })
    .eq("sku", sku);

  // create order
  const { data: order } = await supabase
    .from("orders")
    .insert({
      sku,
      status: "pending",
      amount: product.price,
      request_id: requestId
    })
    .select()
    .single();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: {
          name: product.name
        },
        unit_amount: Math.round(product.price * 100)
      },
      quantity: 1
    }],
    metadata: {
      sku,
      order_id: order.id
    },
    success_url: `${process.env.FRONTEND_URL}/success`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`
  });

  await supabase
    .from("orders")
    .update({ stripe_session_id: session.id })
    .eq("id", order.id);

  res.json({ url: session.url });
});

/* =========================
   3. STRIPE WEBHOOK
========================= */
app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const event = stripe.webhooks.constructEvent(
    req.body,
    req.headers["stripe-signature"],
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { sku, order_id } = session.metadata;

    // mark paid
    await supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", order_id);

    // trigger fulfillment
    await fetch(`${process.env.BASE_URL}/fulfill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, order_id })
    });
  }

  res.json({ received: true });
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

  // 👉 THIS is your dropshipping handoff layer
  await fetch(process.env.SUPPLIER_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_name: product.name,
      supplier_url: product.supplier_url,
      order_id
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
  const aliProduct = req.body;

  const mapped = {
    sku: crypto.randomUUID(),
    name: aliProduct.title,
    description: aliProduct.description,
    price: Number(aliProduct.price) * 2.2, // markup engine
    cost_price: aliProduct.price,
    image_url: aliProduct.image,
    supplier_url: aliProduct.url,
    stock: 999
  };

  const { data, error } = await supabase
    .from("products")
    .insert(mapped)
    .select()
    .single();

  if (error) return res.status(500).json(error);

  res.json(data);
});

app.listen(3000, () => console.log("🚀 RoofFlow OS running"));