app.post("/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const sku = session.metadata.sku;

    const email = session.customer_details?.email;
    const amount = session.amount_total / 100;

    // 1. Get product
    const { data: product } = await supabase
      .from("products")
      .select("*")
      .eq("sku", sku)
      .single();

    // 2. Reduce stock
    await supabase
      .from("products")
      .update({ stock: product.stock - 1 })
      .eq("sku", sku);

    // 3. Log order
    await supabase.from("orders").insert([
      {
        stripe_session: session.id,
        sku,
        email,
        amount,
        status: "paid"
      }
    ]);

    // 4. EMAIL (Zoho SMTP or API)
    await fetch(process.env.EMAIL_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "byronsanche@zohomailcloud.ca",
        subject: "New Order",
        message: `Order: ${sku} - $${amount}`
      })
    });

    // 5. WhatsApp OWNER
    await sendWhatsApp(
      process.env.OWNER_WA,
      `🚀 New Order\n${sku}\n$${amount}\n${email}`
    );

    // 6. WhatsApp SUPPLIER (Evan)
    await sendWhatsApp(
      "8617370511617",
      `📦 Fulfillment Needed\nProduct: ${sku}\nCustomer: ${email}`
    );

    // 7. WhatsApp CUSTOMER
    if (email) {
      await sendWhatsApp(
        email,
        `✅ Order Confirmed\nYour Skymaster X1 is being processed.`
      );
    }
  }

  res.json({ received: true });
});