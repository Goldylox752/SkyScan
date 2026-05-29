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
      return res.status(400).send("Invalid signature");
    }

    /* ─────────────────────────────
       PAYMENT SUCCESS
    ───────────────────────────── */
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const checkoutId = session.metadata.checkoutId;

      const { data: checkout } = await supabase
        .from("checkouts")
        .select("*")
        .eq("id", checkoutId)
        .single();

      if (!checkout) return res.json({ received: true });

      /* ─────────────────────────────
         CREATE ORDER (SHOPIFY CORE OBJECT)
      ───────────────────────────── */
      const orderId = crypto.randomUUID();

      await supabase.from("orders").insert({
        id: orderId,
        checkout_id: checkoutId,
        items: checkout.items,
        status: "paid",
        stripe_session: session.id,
        total: session.amount_total / 100,
      });

      /* ─────────────────────────────
         UPDATE CHECKOUT
      ───────────────────────────── */
      await supabase
        .from("checkouts")
        .update({ status: "completed" })
        .eq("id", checkoutId);

      /* ─────────────────────────────
         EVENT SYSTEM (YOUR ENGINE)
      ───────────────────────────── */
      await supabase.from("events").insert({
        type: "order_paid",
        payload: {
          orderId,
          checkoutId,
        },
      });
    }

    return res.json({ received: true });
  }
);