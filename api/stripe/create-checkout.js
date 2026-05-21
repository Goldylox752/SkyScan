// supabase/functions/create-checkout/index.js
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.0.0';

const stripe = Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

serve(async (req) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Parse request body
  let success_url, cancel_url;
  try {
    const body = await req.json();
    success_url = body.success_url || `${req.headers.get('origin')}/success`;
    cancel_url = body.cancel_url || `${req.headers.get('origin')}/cancel`;
  } catch (e) {
    success_url = `${req.headers.get('origin')}/success`;
    cancel_url = `${req.headers.get('origin')}/cancel`;
  }

  try {
    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'], // adjust as needed
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Skymaster X1 Pro Drone',
              description: '4K roof inspection drone with 35min flight time, GPS, and obstacle sensing.',
              images: ['https://yourdomain.com/drone-image.jpg'], // optional
            },
            unit_amount: 89900, // $899.00
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: success_url,
      cancel_url: cancel_url,
      metadata: {
        source: 'skymaster_landing_page',
        sku: 'SKY-X1',
      },
    });

    return new Response(
      JSON.stringify({ url: session.url, sessionId: session.id }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Stripe session creation error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to create checkout session' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});