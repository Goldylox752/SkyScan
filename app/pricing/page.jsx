import { useState, useEffect } from 'react';

// ========== CONFIGURATION - REPLACE WITH YOUR ACTUAL VALUES ==========
const SUPABASE_URL = 'https://your-project.supabase.co';     // <-- Replace
const SUPABASE_ANON_KEY = 'your-anon-key';                  // <-- Replace
const CREATE_CHECKOUT_URL = `${SUPABASE_URL}/functions/v1/create-checkout`;

// Product configurations
const PRODUCTS = {
  starter: {
    name: 'Skymaster X1 Pro Drone (Starter)',
    sku: 'SKY-X1-STARTER',
    price: 89900, // $899.00
    description: 'Single drone unit + basic accessories',
    features: ['✔ Skymaster X1 v2 drone', '✔ 4K inspection camera', '✔ Basic flight system', '✔ 1-year warranty']
  },
  growth: {
    name: 'Skymaster X1 Pro Drone (Growth)',
    sku: 'SKY-X1-GROWTH',
    price: 149900, // $1,499.00
    description: 'Most popular for contractors',
    features: ['✔ Everything in Starter', '✔ Extra battery pack', '✔ Extended range control system', '✔ Priority support']
  },
  domination: {
    name: 'Skymaster X1 Pro Drone (Domination)',
    sku: 'SKY-X1-DOMINATION',
    price: 249900, // $2,499.00
    description: 'Full contractor system',
    features: ['✔ Everything in Growth', '✔ 2nd backup drone unit', '✔ Inspection workflow bundle', '✔ Priority onboarding support']
  }
};

export default function Pricing() {
  const [loading, setLoading] = useState(null);
  const [stock, setStock] = useState({});
  const [error, setError] = useState(null);

  // Fetch stock for all products
  useEffect(() => {
    async function fetchStocks() {
      const skus = Object.values(PRODUCTS).map(p => p.sku).join(',');
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/products?sku=in.(${skus})&select=sku,stock`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          const stockMap = {};
          data.forEach(item => { stockMap[item.sku] = item.stock; });
          setStock(stockMap);
        }
      } catch (err) {
        console.error('Stock fetch error:', err);
      }
    }
    fetchStocks();
  }, []);

  const handleBuy = async (productKey) => {
    const product = PRODUCTS[productKey];
    if (!product) return;
    setLoading(productKey);
    setError(null);
    try {
      const response = await fetch(CREATE_CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success_url: `${window.location.origin}/success`,
          cancel_url: `${window.location.origin}/cancel`,
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: {
                name: product.name,
                description: product.description,
              },
              unit_amount: product.price,
            },
            quantity: 1,
          }],
          metadata: {
            source: 'pricing_page',
            sku: product.sku,
            tier: productKey,
          }
        })
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to start checkout. Please try again or contact support.');
    } finally {
      setLoading(null);
    }
  };

  // Obfuscated WhatsApp number (same as main page)
  const getWhatsAppLink = () => {
    const encoded = "37697620871"; // reverse of "17802679673"
    const phoneNumber = encoded.split('').reverse().join('');
    return `https://wa.me/${phoneNumber}?text=Hello%2C%20I%20have%20a%20question%20about%20the%20pricing%20plans.`;
  };

  const styles = {
    page: {
      minHeight: "100vh",
      background: "#0a0c15",
      color: "#f0f3fa",
      fontFamily: "Inter, sans-serif",
      padding: "20px",
    },
    header: {
      textAlign: "center",
      padding: "60px 20px 30px",
    },
    title: {
      fontSize: "3rem",
      fontWeight: 800,
      background: "linear-gradient(135deg, #FFFFFF, #b9c8ff)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      marginBottom: "16px",
    },
    sub: {
      maxWidth: "700px",
      margin: "10px auto",
      opacity: 0.8,
      fontSize: "1.1rem",
    },
    grid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: "28px",
      maxWidth: "1200px",
      margin: "0 auto",
      padding: "40px 20px",
    },
    card: {
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "32px",
      padding: "32px 24px",
      textAlign: "center",
      transition: "transform 0.2s ease",
      backdropFilter: "blur(4px)",
    },
    cardFeatured: {
      background: "rgba(37,99,235,0.08)",
      border: "2px solid #3b82f6",
      borderRadius: "32px",
      padding: "32px 24px",
      textAlign: "center",
      transform: "scale(1.02)",
      boxShadow: "0 10px 25px -5px rgba(59,130,246,0.3)",
    },
    plan: {
      fontSize: "1.8rem",
      fontWeight: 800,
      marginBottom: "8px",
    },
    price: {
      fontSize: "2.5rem",
      fontWeight: 800,
      margin: "16px 0",
      color: "#4ade80",
    },
    desc: {
      fontSize: "0.9rem",
      opacity: 0.75,
      marginBottom: "24px",
    },
    list: {
      listStyle: "none",
      padding: 0,
      fontSize: "0.9rem",
      opacity: 0.85,
      lineHeight: 1.8,
      textAlign: "left",
      margin: "24px 0",
    },
    btn: {
      display: "inline-block",
      width: "100%",
      padding: "14px 24px",
      background: "#2563eb",
      color: "#fff",
      borderRadius: "60px",
      textDecoration: "none",
      fontWeight: 700,
      border: "none",
      cursor: "pointer",
      fontSize: "1rem",
      transition: "all 0.2s ease",
    },
    btnFeatured: {
      display: "inline-block",
      width: "100%",
      padding: "14px 24px",
      background: "linear-gradient(135deg, #22c55e, #16a34a)",
      color: "#000",
      borderRadius: "60px",
      textDecoration: "none",
      fontWeight: 800,
      border: "none",
      cursor: "pointer",
      fontSize: "1rem",
      transition: "all 0.2s ease",
    },
    btnDisabled: {
      opacity: 0.6,
      cursor: "not-allowed",
    },
    footer: {
      textAlign: "center",
      marginTop: "40px",
      padding: "40px 20px",
      borderTop: "1px solid #1e293b",
    },
    secondaryBtn: {
      display: "inline-block",
      marginTop: "20px",
      padding: "12px 28px",
      border: "1.5px solid #60a5fa",
      borderRadius: "60px",
      color: "#e0e7ff",
      textDecoration: "none",
      fontWeight: 600,
      transition: "all 0.2s ease",
      cursor: "pointer",
    },
    error: {
      backgroundColor: "rgba(239,68,68,0.15)",
      color: "#f87171",
      padding: "12px 20px",
      borderRadius: "12px",
      textAlign: "center",
      maxWidth: "600px",
      margin: "20px auto",
    },
    whatsappLink: {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "24px",
      color: "#86efac",
      textDecoration: "none",
      fontSize: "0.9rem",
      padding: "8px 16px",
      borderRadius: "40px",
      background: "rgba(34,197,94,0.1)",
      transition: "all 0.2s ease",
    }
  };

  const renderCard = (productKey, isFeatured = false) => {
    const product = PRODUCTS[productKey];
    const currentStock = stock[product.sku];
    const outOfStock = currentStock !== undefined && currentStock <= 0;
    const isLoading = loading === productKey;

    const cardStyle = isFeatured ? styles.cardFeatured : styles.card;
    const buttonStyle = isFeatured ? styles.btnFeatured : styles.btn;
    const finalButtonStyle = outOfStock ? { ...buttonStyle, ...styles.btnDisabled } : buttonStyle;

    return (
      <div style={cardStyle} key={productKey}>
        <h2 style={styles.plan}>{productKey === 'starter' ? 'Starter' : productKey === 'growth' ? 'Growth' : 'Domination'}</h2>
        <p style={styles.price}>${(product.price / 100).toFixed(2)}</p>
        <p style={styles.desc}>{product.description}</p>
        <ul style={styles.list}>
          {product.features.map((feature, idx) => (
            <li key={idx}>{feature}</li>
          ))}
        </ul>
        {outOfStock && <p style={{ color: "#f87171", marginBottom: "12px" }}>Out of stock</p>}
        <button
          style={finalButtonStyle}
          onClick={() => handleBuy(productKey)}
          disabled={outOfStock || isLoading}
        >
          {isLoading ? 'Processing...' : outOfStock ? 'Sold Out' : `Buy ${productKey === 'starter' ? 'Starter' : productKey === 'growth' ? 'Growth' : 'Domination'}`}
        </button>
      </div>
    );
  };

  return (
    <main style={styles.page}>
      <section style={styles.header}>
        <h1 style={styles.title}>Skymaster X1 v2 Pricing</h1>
        <p style={styles.sub}>
          Choose your access level. Built for roofing contractors who want inspection speed + higher close rates.
        </p>
      </section>

      {error && <div style={styles.error}>{error}</div>}

      <section style={styles.grid}>
        {renderCard('starter', false)}
        {renderCard('growth', true)}
        {renderCard('domination', false)}
      </section>

      <section style={styles.footer}>
        <h2>Need help choosing?</h2>
        <p style={{ opacity: 0.7, marginTop: "8px" }}>
          Most contractors start with Growth for maximum ROI.
        </p>
        <a href="/apply" style={styles.secondaryBtn}>
          Apply Instead
        </a>
        <br />
        <a href={getWhatsAppLink()} style={styles.whatsappLink} target="_blank" rel="noopener noreferrer">
          <i className="fab fa-whatsapp"></i> Chat with support on WhatsApp
        </a>
      </section>
    </main>
  );
}