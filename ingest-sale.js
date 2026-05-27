app.post("/ingest-sale", async (req, res) => {
  const { sku, revenue } = req.body;

  // store training data
  await supabase.from("sales_training").insert({
    sku,
    revenue,
    timestamp: new Date().toISOString()
  });

  // update product score
  const { data: product } = await supabase
    .from("products")
    .select("*")
    .eq("sku", sku)
    .single();

  const newScore =
    (product.score || 0) + revenue * 0.1;

  await supabase
    .from("products")
    .update({ score: newScore })
    .eq("sku", sku);

  res.json({ ok: true });
});