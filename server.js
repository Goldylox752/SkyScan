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

    // 1. Get product
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    if (error || !product) {
      return res.status(404).json({
        error: "Product not found",
        requestId
      });
    }

    if (product.stock <= 0) {
      return res.status(400).json({
        error: "Out of stock",
        requestId
      });
    }

    const price = Number(product.price);
    if (!price) {
      return res.status(500).json({
        error: "Invalid price",
        requestId
      });
    }

    // 2. Create pending order FIRST (this is what you were missing)
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          sku: product.sku,
          product_id: product.id,
          status: "pending",
          amount: price,
          request_id: requestId
        }
      ])
      .select()
      .single();

    if (orderError) {
      return res.status(500).json({
        error: "Failed to create order",
        requestId
      });
    }

    // 3. Create Stripe session
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

    // 4. Update order with session id
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
      error: "Server error",
      requestId
    });
  }
});