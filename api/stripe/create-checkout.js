async function startCheckout() {
  try {
    const res = await fetch("https://sanchesolutions.onrender.com/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    const data = await res.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Checkout failed - missing URL");
    }
  } catch (err) {
    console.error(err);
    alert("Checkout error - server not responding");
  }
}