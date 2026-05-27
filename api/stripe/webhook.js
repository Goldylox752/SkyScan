app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const event = stripe.webhooks.constructEvent(
    req.body,
    req.headers["stripe-signature"],
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const sku = session.metadata.sku;

    // 1. reduce inventory
    await supabase.rpc("decrement_stock", { sku_input: sku });

    // 2. create order
    await supabase.from("orders").insert({
      stripe_session_id: session.id,
      sku,
      customer_email: session.customer_details.email,
      status: "paid"
    });

    // 3. trigger automation
    await fetch(`${process.env.BASE_URL}/api/fulfill`, {
      method: "POST",
      body: JSON.stringify({ sku, session })
    });
  }

  res.json({ received: true });
});