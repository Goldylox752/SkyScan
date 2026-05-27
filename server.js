import crypto from "crypto";

app.post("/create-checkout", async (req, res) => {
  const requestId = crypto.randomUUID();

  try {
    const { sku } = req.body;

    if (!sku) {
      return res.status(400).json({
        error: "Missing SKU",
        requestId
      });
    }

    /* =========================
       1. FETCH PRODUCT
    ========================= */
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    if (productError || !product) {
      return res.status(404).json({
        error: "Product not found",
        requestId
      });
    }

    const price = Number(product.price);

    if (!price || price <= 0) {
      return res.status(400).json({
        error: "Invalid product price",
        requestId
      });
    }

    /* =========================
       2. ATOMIC STOCK RESERVATION
       (prevents overselling)
    ========================= */

    const { data: updated, error: stockError } = await supabase
      .from("products")
      .update({
        stock: product.stock - 1,
        reserved_stock: (product.reserved_stock || 0) + 1
      })
      .eq("sku", sku)
      .eq("stock", product.stock)
      .select()
      .single();

    if (stockError || !updated) {
      return res.status(409).json({
        error: "Stock changed, please retry",
        requestId
      });
    }

    /* =========================
       3. CREATE ORDER (idempotent)
    ========================= */

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        sku: product.sku,
        product_id: product.id,
        status: "pending",
        amount: price,
        request_id: requestId
      })
      .select()
      .single();

    if (orderError || !order) {
      // rollback stock if order fails
      await supabase
        .from("products")
        .update({
          stock: product.stock,
          reserved_stock: Math.max((product.reserved_stock || 1) - 1, 0)
        })
        .eq("sku", sku);

      return res.status(500).json({
        error: "Failed to create order",
        requestId
      });
    }

    /* =========================
       4. STRIPE SESSION
    ========================= */

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],

      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              description: product.description || "Premium product"
            },
            unit_amount: Math.round(price * 100)
          },
          quantity: 1
        }
      ],

      metadata: {
        sku: product.sku,
        product_id: product.id,
        order_id: order.id,
        request_id: requestId
      },

      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`
    });

    /* =========================
       5. LINK SESSION → ORDER
    ========================= */

    await supabase
      .from("orders")
      .update({
        stripe_session_id: session.id
      })
      .eq("id", order.id);

    return res.json({
      url: session.url,
      requestId
    });

  } catch (err) {
    console.error("Checkout error:", err);

    return res.status(500).json({
      error: "Internal server error",
      requestId
    });
  }
});