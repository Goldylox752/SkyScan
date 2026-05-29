import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

app.post("/create-checkout", async (req, res) => {
  try {
    const { sku } = req.body;

    /* ─────────────────────────────
       VALIDATION
    ───────────────────────────── */
    if (!sku) {
      return res.status(400).json({ error: "SKU is required" });
    }

    /* ─────────────────────────────
       FETCH PRODUCT
    ───────────────────────────── */
    const { data: product, error } = await supabase
      .from("products")
      .select("sku, name, description, price, stock")
      .eq("sku", sku)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const price = Number(product.price);

    if (!price || price <= 0) {
      return res.status(400).json({ error: "Invalid product price" });
    }

    if (product.stock === 0) {
      return res.status(400).json({ error: "Out of stock" });
    }

    /* ─────────────────────────────
       STRIPE CHECKOUT SESSION
    ───────────────────────────── */
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              description: product.description ?? "",
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: 1,
        },
      ],

      metadata: {
        sku: product.sku,
      },

      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    if (!session?.url) {
      return res.status(500).json({ error: "Failed to create checkout session" });
    }

    return res.json({
      url: session.url,
      sessionId: session.id,
    });

  } catch (err) {
    console.error("❌ Checkout error:", err);

    return res.status(500).json({
      error: "Checkout failed",
      message: err.message || "Unknown error",
    });
  }
});