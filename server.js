app.post("/create-checkout", async (req, res) => {
  try {
    const { sku } = req.body;

    if (!sku) {
      return res.status(400).json({ error: "Missing SKU" });
    }

    // Fetch product
    const { data: product, error } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    if (error || !product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Stock validation
    if (product.stock === 0) {
      return res.status(400).json({ error: "Out of stock" });
    }

    // Create Stripe session
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
            unit_amount: Math.round(Number(product.price) * 100)
          },
          quantity: 1
        }
      ],

      metadata: {
        sku: product.sku,
        product_id: product.id
      },

      success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/cancel`
    });

    return res.status(200).json({
      url: session.url
    });

  } catch (err) {
    console.error("Checkout Error:", err);

    return res.status(500).json({
      error: "Internal server error"
    });
  }
});