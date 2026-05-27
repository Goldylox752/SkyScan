app.post("/create-checkout", async (req, res) => {
  const { sku } = req.body;

  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .single();

  if (!product) return res.status(404).json({ error: "Product not found" });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
            description: product.description
          },
          unit_amount: product.price * 100
        },
        quantity: 1
      }
    ],
    success_url: `${process.env.FRONTEND_URL}/success`,
    cancel_url: `${process.env.FRONTEND_URL}/cancel`
  });

  res.json({ url: session.url });
});