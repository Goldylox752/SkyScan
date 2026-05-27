app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send("Invalid signature");
    }

    try {
      // =========================
      // PAYMENT SUCCESS EVENT
      // =========================
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const { sku, order_id } = session.metadata;

        if (!sku) {
          console.error("Missing SKU in metadata");
          return res.json({ received: true });
        }

        // =========================
        // 1. IDEMPOTENCY CHECK
        // (prevents duplicate processing)
        // =========================
        const { data: existingOrder } = await supabase
          .from("orders")
          .select("id, status")
          .eq("stripe_session_id", session.id)
          .single();

        if (existingOrder?.status === "paid") {
          console.log("Order already processed:", session.id);
          return res.json({ received: true });
        }

        // =========================
        // 2. GET PRODUCT
        // =========================
        const { data: product, error: productError } = await supabase
          .from("products")
          .select("stock")
          .eq("sku", sku)
          .single();

        if (productError || !product) {
          console.error("Product not found for webhook");
          return res.json({ received: true });
        }

        // =========================
        // 3. DECREMENT STOCK SAFELY
        // =========================
        await supabase.rpc("decrement_stock", {
          sku_input: sku
        });

        // =========================
        // 4. UPSERT ORDER (NO DUPLICATES)
        // =========================
        await supabase
          .from("orders")
          .upsert(
            {
              stripe_session_id: session.id,
              sku,
              status: "paid",
              customer_email: session.customer_details?.email || null,
              amount_total: session.amount_total,
              updated_at: new Date().toISOString()
            },
            { onConflict: "stripe_session_id" }
          );

        // =========================
        // 5. TRIGGER FULFILLMENT PIPELINE
        // =========================
        await fetch(`${process.env.BASE_URL}/api/fulfill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sku,
            stripe_session_id: session.id
          })
        });

        console.log("Webhook processed successfully:", session.id);
      }

      // =========================
      // OPTIONAL: FAILED PAYMENT
      // =========================
      if (event.type === "checkout.session.expired") {
        const session = event.data.object;

        console.log("Checkout expired:", session.id);
      }

      return res.json({ received: true });

    } catch (err) {
      console.error("Webhook handler error:", err);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);