import { scrapeAliExpress } from "./scraper.js";
import { mapProduct } from "./mapper.js";
import { scoreProduct, isWinner } from "./mine-products.js";
import fetch from "node-fetch";

export async function runMining(query) {
  const raw = await scrapeAliExpress(query);

  const enriched = raw
    .map(mapProduct)
    .filter(Boolean)
    .map(scoreProduct)
    .filter(isWinner);

  // push winners into your store
  for (const product of enriched) {
    await fetch(`${process.env.BASE_URL}/import-product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(product)
    });
  }

  return enriched;
}