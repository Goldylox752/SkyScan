import { chromium } from "playwright";

/**
 * Scrape AliExpress search results
 */
export async function scrapeAliExpress(query) {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  const url = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`;

  await page.goto(url, {
    waitUntil: "domcontentloaded"
  });

  await page.waitForTimeout(3000);

  const products = await page.evaluate(() => {
    const items = document.querySelectorAll(".search-item-card-wrapper-gallery");

    const results = [];

    items.forEach((item) => {
      const title =
        item.querySelector("h1, h2, h3")?.innerText?.trim();

      const price =
        item.querySelector(".multi--price-sale")?.innerText ||
        item.querySelector(".price-current")?.innerText;

      const image =
        item.querySelector("img")?.src;

      const link =
        item.querySelector("a")?.href;

      if (title && price && link) {
        results.push({
          title,
          price: parseFloat(price.replace(/[^0-9.]/g, "")),
          image,
          url: link
        });
      }
    });

    return results;
  });

  await browser.close();

  return products;
}