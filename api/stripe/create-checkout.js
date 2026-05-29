import Stripe from "stripe";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

app.post("/create-checkout", async (req, res) => {
  try {
    const { items } = req.body; 
    // items = [{ sku, quantity }]

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    /* ─────────────────────────────
       FETCH + VALIDATE PRODUCTS
    ───────────────────────────── */
    const enrichedItems = [];

    for (const item of items) {
      const { data: product } = await supabase
        .from("products")
        .select("id, sku, name, description, price, stock")
        .eq("sku", item.sku)
        .single();

      if (!product) {
        return res.status(404).json({ error: `Product not found: ${item.sku}` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}`,
        });
      }

      enrichedItems.push({
        ...product,
        quantity: item.quantity,
      });
    }

    /* ─────────────────────────────
       RESERVE STOCK (IMPORTANT)
    ───────────────────────────── */
    for (const item of enrichedItems) {
      await supabase
        .from("products")
        .update({
          stock: item.stock - item.quantity,
        })
        .eq("id", item.id);
    }

    /* ─────────────────────────────
       CREATE INTERNAL CHECKOUT ID
    ───────────────────────────── */
    const checkoutId = crypto.randomUUID();

    await supabase.from("checkouts").insert({
      id: checkoutId,
      items: enrichedItems,
      status: "pending",
    });

    /* ─────────────────────────────
       STRIPE SESSION
    ───────────────────────────── */
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: enrichedItems.map((item) => ({
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            description: item.description || "",
          },
          unit_amount: Math.round(Number(item.price) * 100),
        },
        quantity: item.quantity,
      })),

      metadata: {
        checkoutId,
      },

      success_url: `${process.env.FRONTEND_URL}/success?checkout=${checkoutId}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`,
    });

    return res.json({
      url: session.url,
      checkoutId,
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Checkout failed" });
  }
});