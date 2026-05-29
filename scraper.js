import { scrapeAliExpress } from "./scraper.js";
import { mapProduct } from "./mapper.js";
import { scoreProduct, isWinner } from "./mine-products.js";
import fetch from "node-fetch";
import crypto from "crypto";

/* ─────────────────────────────
   CONFIG
───────────────────────────── */
const BASE_URL = process.env.BASE_URL;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 800;

/* ─────────────────────────────
   HASH (DEDUPLICATION KEY)
───────────────────────────── */
function hashProduct(p) {
  return crypto
    .createHash("md5")
    .update(`${p.title}|${p.price}|${p.image}`)
    .digest("hex");
}

/* ─────────────────────────────
   SAFE IMPORT
───────────────────────────── */
async function pushProduct(product) {
  try {
    await fetch(`${BASE_URL}/import-product`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Idempotency-Key": product.hash
      },
      body: JSON.stringify(product)
    });
  } catch (err) {
    console.error("❌ Import failed:", product.title);
  }
}

/* ─────────────────────────────
   MINING PIPELINE
───────────────────────────── */
export async function runMining(query) {
  console.log(`🔍 Mining started: ${query}`);

  const raw = await scrapeAliExpress(query);

  const processed = raw
    .map(mapProduct)
    .filter(Boolean)
    .map(p => ({
      ...p,
      hash: hashProduct(p)
    }))
    .map(scoreProduct)
    .filter(isWinner);

  console.log(`💰 Winners found: ${processed.length}`);

  /* ─────────────────────────────
     BATCH IMPORT PIPELINE
  ───────────────────────────── */
  for (let i = 0; i < processed.length; i += BATCH_SIZE) {
    const batch = processed.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(pushProduct));

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  return processed;
}