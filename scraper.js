import { chromium } from "playwright";
import { mapProduct } from "./mapProduct.js";

/**
 * AliExpress AI Product Scraper (Resilient v2)
 */
export async function scrapeAliExpress(query, { pages = 1 } = {}) {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    locale: "en-US"
  });

  const page = await context.newPage();

  const results = [];

  try {
    for (let i = 0; i < pages; i++) {
      const url = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(
        query
      )}&page=${i + 1}`;

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      // allow lazy render
      await page.waitForTimeout(4000);

      const products = await page.evaluate(() => {
        const items = document.querySelectorAll("a.search-card-item");

        const out = [];

        items.forEach((item) => {
          const title =
            item.querySelector(".search-card-item__title")?.innerText?.trim();

          const priceText =
            item.querySelector(".search-card-item__price")?.innerText ||
            item.querySelector(".multi--price-sale")?.innerText;

          const image =
            item.querySelector("img")?.getAttribute("src") ||
            item.querySelector("img")?.getAttribute("data-src");

          const link = item.href;

          if (!title || !priceText || !link) return;

          const price = Number(
            priceText.replace(/[^0-9.]/g, "")
          );

          if (!price || price <= 0) return;

          out.push({
            title,
            price,
            image,
            url: link
          });
        });

        return out;
      });

      results.push(...products);
    }

    // normalize + map into your store format
    const mapped = results
      .map((p) => mapProduct(p))
      .filter(Boolean);

    return {
      query,
      count: mapped.length,
      products: mapped
    };
  } catch (err) {
    console.error("Scrape failed:", err);

    return {
      query,
      count: 0,
      products: []
    };
  } finally {
    await browser.close();
  }
}