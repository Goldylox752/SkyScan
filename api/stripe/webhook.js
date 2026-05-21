import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ========== LOAD ENV VARS ==========
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
const EVAN_NUMBER = Deno.env.get('EVAN_WHATSAPP_NUMBER');

// Validate required env vars
const missingEnv = [];
if (!STRIPE_SECRET_KEY) missingEnv.push('STRIPE_SECRET_KEY');
if (!STRIPE_WEBHOOK_SECRET) missingEnv.push('STRIPE_WEBHOOK_SECRET');
if (!SUPABASE_URL) missingEnv.push('SUPABASE_URL');
if (!SUPABASE_SERVICE_ROLE_KEY) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
if (!WHATSAPP_TOKEN) missingEnv.push('WHATSAPP_ACCESS_TOKEN');
if (!WHATSAPP_PHONE_ID) missingEnv.push('WHATSAPP_PHONE_NUMBER_ID');
if (!EVAN_NUMBER) missingEnv.push('EVAN_WHATSAPP_NUMBER');

if (missingEnv.length) {
  console.error('❌ Missing environment variables:', missingEnv.join(', '));
  throw new Error(`Missing env: ${missingEnv.join(', ')}`);
}

// ========== INIT CLIENTS ==========
const stripe = Stripe(STRIPE_SECRET_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ========== WHATSAPP HELPER ==========
async function sendWhatsApp(to, body) {
  const url = `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`;
  console.log(`📤 Sending WhatsApp to ${to}...`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to,
      type: 'text',
      text: { body }
    })
  });
  if (!res.ok) {
    const errorText = await res.text();
    console.error('❌ WhatsApp send failed:', res.status, errorText);
    throw new Error(`WhatsApp error: ${res.status} ${errorText}`);
  }
  console.log('✅ WhatsApp sent successfully');
  return res;
}

// ========== TEST MODE (manual trigger) ==========
serve(async (req) => {
  const url = new URL(req.url);

  // Test mode: send a test WhatsApp message to Evan
  if (url.searchParams.get('test') === 'true') {
    console.log('🧪 Test mode triggered');
    try {
      await sendWhatsApp(EVAN_NUMBER, '🔧 Test message from your Stripe webhook. If you see this, WhatsApp is working! ✅');
      return new Response(JSON.stringify({ success: true, message: 'Test WhatsApp sent to Evan' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('Test failed:', err);
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Only POST for Stripe webhook
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Get raw body and signature
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.error('Missing stripe-signature header');
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    console.log('✅ Webhook signature verified. Event type:', event.type);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  // Handle checkout.session.completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`💰 Payment completed for session ${session.id}`);

    // Format shipping address
    const addr = session.shipping_details?.address;
    const addressStr = addr
      ? `${addr.line1}, ${addr.city}, ${addr.state} ${addr.postal_code}, ${addr.country}`
      : 'No address provided';

    // 1. Insert order into Supabase
    const { data: orderData, error: dbError } = await supabase
      .from('orders')
      .insert({
        stripe_session_id: session.id,
        customer_name: session.shipping_details?.name || session.customer_details?.name,
        customer_email: session.customer_details?.email,
        customer_address: addressStr,
        amount_total: session.amount_total,
        status: 'paid'
      })
      .select();

    if (dbError) {
      console.error('❌ DB insert error:', dbError);
    } else {
      console.log('✅ Order saved to Supabase:', orderData);
    }

    // 2. Send WhatsApp to Evan
    const amountDollars = (session.amount_total / 100).toFixed(2);
    const message = `🛸 *NEW DRONE ORDER* 🛸\n\n` +
      `*Customer:* ${session.shipping_details?.name || 'N/A'}\n` +
      `*Email:* ${session.customer_details?.email || 'N/A'}\n` +
      `*Address:* ${addressStr}\n` +
      `*Amount:* $${amountDollars}\n\n` +
      `📦 Please fulfill and ship.`;

    try {
      await sendWhatsApp(EVAN_NUMBER, message);
    } catch (err) {
      console.error('❌ Failed to send WhatsApp, but order was saved:', err.message);
      // Don't return error to Stripe (prevent retry) – order already saved.
    }
  } else {
    console.log(`ℹ️ Unhandled event type: ${event.type}`);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});