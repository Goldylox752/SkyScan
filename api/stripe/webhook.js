app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),

  async (req, res) => {

    let event;

    // =========================
    // VERIFY STRIPE SIGNATURE
    // =========================
    try {

      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers["stripe-signature"],
        process.env.STRIPE_WEBHOOK_SECRET
      );

    } catch (err) {

      console.error(
        "Webhook signature verification failed:",
        err.message
      );

      return res.status(400).send("Invalid signature");
    }

    try {

      // =====================================================
      // CHECKOUT COMPLETED
      // =====================================================
      if (event.type === "checkout.session.completed") {

        const session = event.data.object;

        const {
          sku,
          order_id
        } = session.metadata || {};

        // =========================
        // VALIDATE REQUIRED DATA
        // =========================
        if (!sku) {

          console.error(
            "Missing SKU in session metadata"
          );

          return res.json({
            received: true
          });
        }

        // =========================
        // IDEMPOTENCY CHECK
        // =========================
        const {
          data: existingOrder,
          error: existingOrderError
        } = await supabase
          .from("orders")
          .select("id, status")
          .eq("stripe_session_id", session.id)
          .maybeSingle();

        if (existingOrderError) {

          console.error(
            "Existing order lookup failed:",
            existingOrderError
          );

          return res.status(500).json({
            error: "Order lookup failed"
          });
        }

        // Already processed
        if (existingOrder?.status === "paid") {

          console.log(
            "Webhook already processed:",
            session.id
          );

          return res.json({
            received: true
          });
        }

        // =========================
        // GET PRODUCT
        // =========================
        const {
          data: product,
          error: productError
        } = await supabase
          .from("products")
          .select(`
            id,
            sku,
            name,
            stock,
            price
          `)
          .eq("sku", sku)
          .single();

        if (productError || !product) {

          console.error(
            "Product not found:",
            sku
          );

          return res.json({
            received: true
          });
        }

        // =========================
        // PREVENT NEGATIVE STOCK
        // =========================
        if (product.stock <= 0) {

          console.error(
            "Out of stock:",
            sku
          );

          return res.json({
            received: true
          });
        }

        // =========================
        // DECREMENT STOCK
        // =========================
        const {
          error: decrementError
        } = await supabase.rpc(
          "decrement_stock",
          {
            sku_input: sku
          }
        );

        if (decrementError) {

          console.error(
            "Stock decrement failed:",
            decrementError
          );

          return res.status(500).json({
            error: "Inventory update failed"
          });
        }

        // =========================
        // UPSERT ORDER
        // =========================
        const {
          error: orderError
        } = await supabase
          .from("orders")
          .upsert(
            {
              stripe_session_id: session.id,

              order_id:
                order_id || null,

              sku,

              product_name:
                product.name,

              amount_total:
                session.amount_total,

              currency:
                session.currency,

              status:"paid",

              customer_email:
                session.customer_details?.email || null,

              customer_name:
                session.customer_details?.name || null,

              payment_status:
                session.payment_status,

              created_at:
                new Date().toISOString(),

              updated_at:
                new Date().toISOString()
            },

            {
              onConflict:
                "stripe_session_id"
            }
          );

        if (orderError) {

          console.error(
            "Order upsert failed:",
            orderError
          );

          return res.status(500).json({
            error:"Order save failed"
          });
        }

        // =========================
        // FULFILLMENT PIPELINE
        // =========================
        try {

          const fulfillRes = await fetch(
            `${process.env.BASE_URL}/api/fulfill`,
            {
              method:"POST",

              headers:{
                "Content-Type":"application/json"
              },

              body:JSON.stringify({
                sku,
                stripe_session_id: session.id,
                customer_email:
                  session.customer_details?.email || null
              })
            }
          );

          if (!fulfillRes.ok) {

            console.error(
              "Fulfillment request failed"
            );
          }

        } catch (fulfillErr) {

          console.error(
            "Fulfillment pipeline error:",
            fulfillErr
          );
        }

        // =========================
        // LOG SUCCESS
        // =========================
        console.log(
          "Webhook processed successfully:",
          session.id
        );
      }

      // =====================================================
      // CHECKOUT EXPIRED
      // =====================================================
      if (event.type === "checkout.session.expired") {

        const session = event.data.object;

        console.log(
          "Checkout expired:",
          session.id
        );
      }

      // =====================================================
      // PAYMENT FAILED
      // =====================================================
      if (
        event.type ===
        "payment_intent.payment_failed"
      ) {

        const paymentIntent =
          event.data.object;

        console.error(
          "Payment failed:",
          paymentIntent.id
        );
      }

      return res.json({
        received:true
      });

    } catch (err) {

      console.error(
        "Webhook handler crashed:",
        err
      );

      return res.status(500).json({
        error:"Webhook processing failed"
      });
    }
  }
);