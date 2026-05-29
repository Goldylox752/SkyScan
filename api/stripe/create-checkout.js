import Stripe from "stripe";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-05-28.basil",
});

app.post("/create-checkout", async (req, res) => {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: "Cart is empty",
      });
    }

    const enrichedItems = [];

    for (const item of items) {
      if (
        !item?.sku ||
        !Number.isInteger(item.quantity) ||
        item.quantity <= 0
      ) {
        return res.status(400).json({
          error: "Invalid cart item",
        });
      }

      const { data: product, error } = await supabase
        .from("products")
        .select(`
          id,
          sku,
          name,
          description,
          price,
          stock,
          active
        `)
        .eq("sku", item.sku)
        .single();

      if (error || !product) {
        return res.status(404).json({
          error: `Product not found: ${item.sku}`,
        });
      }

      if (!product.active) {
        return res.status(400).json({
          error: `${product.name} is unavailable`,
        });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${product.name}`,
        });
      }

      enrichedItems.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: Number(product.price),
        quantity: item.quantity,
      });
    }

    const checkoutId = crypto.randomUUID();

    const subtotal = enrichedItems.reduce((sum, item) => {
      return sum + item.price * item.quantity;
    }, 0);

    const { error: checkoutError } = await supabase
      .from("checkouts")
      .insert({
        id: checkoutId,
        items: enrichedItems,
        subtotal,
        status: "pending",
      });

    if (checkoutError) {
      console.error(checkoutError);

      return res.status(500).json({
        error: "Failed to create checkout",
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",

      payment_method_types: ["card"],

      line_items: enrichedItems.map((item) => ({
        quantity: item.quantity,

        price_data: {
          currency: "usd",

          unit_amount: Math.round(item.price * 100),

          product_data: {
            name: item.name,
            description: item.description || "",
          },
        },
      })),

      metadata: {
        checkoutId,
      },

      success_url:
        `${process.env.FRONTEND_URL}` +
        `/success?checkout=${checkoutId}`,

      cancel_url:
        `${process.env.FRONTEND_URL}` +
        `/cancel?checkout=${checkoutId}`,
    });

    await supabase
      .from("checkouts")
      .update({
        stripe_session_id: session.id,
      })
      .eq("id", checkoutId);

    return res.json({
      success: true,
      url: session.url,
      checkoutId,
    });

  } catch (err) {
    console.error("Checkout error:", err);

    return res.status(500).json({
      error: "Checkout failed",
    });
  }
});