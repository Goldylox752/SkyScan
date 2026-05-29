router.post(
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
      console.error("❌ Signature failed:", err.message);
      return res.status(400).send("Invalid signature");
    }

    try {
      // ONLY QUEUE EVENT — NO BUSINESS LOGIC
      await supabase.from("event_queue").insert({
        type: event.type,
        payload: event
      });

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("❌ Queue insert failed:", err);
      return res.status(500).json({ error: "Queue failure" });
    }
  }
);