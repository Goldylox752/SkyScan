import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// IMPORTANT: webhook needs raw body
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json());

/* =========================
   CREATE CHECKOUT SESSION
========================= */
app.post("/create-checkout", async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Skymaster X1 Drone",
              description: "4K Roof Inspection Drone"
            },
            unit_amount: 89900
          },
          quantity: 1
        }
      ],
      success_url: `${process.env.CLIENT_URL}/?success=true`,
      cancel_url: `${process.env.CLIENT_URL}/?cancel=true`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Checkout failed" });
  }
});

/* =========================
   STRIPE WEBHOOK (CRITICAL)
========================= */
app.post("/webhook", async (req, res) => {
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

    // 🔥 HERE YOU CONFIRM PAYMENT

    // Example: reduce stock
    await supabase.rpc("decrease_stock", {
      sku_input: "SKY-X1",
      amount: 1
    });

    // store order
    await supabase.from("orders").insert([
      {
        email: session.customer_details?.email,
        amount: session.amount_total,
        status: "paid"
      }
    ]);
  }

  res.json({ received: true });
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.json({ status: "RoofFlow checkout system live" });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));