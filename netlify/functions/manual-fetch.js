exports.handler = async function(event, context) {
  // Security check: Only accept POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const tickers = body.tickers || [];
    const prices = {};
    const logs = [];
    const failed = [];

    // Helper to capture terminal logs for the frontend
    const log = (msg) => logs.push(msg);

    // 1. FAST YAHOO BULK FETCH
    const batchSize = 20;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const symbols = batch.map(t => `${t}.NS`).join(',');
      log(`[YAHOO] Requesting batch: ${batch.join(', ')}`);

      try {
        const yUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
        
        // Fetch securely from the Netlify server IP (No CORS restrictions here!)
        const yRes = await fetch(yUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
        });

        if (yRes.ok) {
          const yData = await yRes.json();
          const results = yData?.quoteResponse?.result || [];
          const found = new Set();

          results.forEach(q => {
            const ticker = q.symbol.replace('.NS', '');
            if (q.regularMarketPrice) {
              prices[ticker] = q.regularMarketPrice;
              found.add(ticker);
              log(`[SUCCESS] ${ticker}: ₹${q.regularMarketPrice.toFixed(2)}`);
            }
          });

          // Track any symbols Yahoo missed in this batch
          batch.forEach(t => { if (!found.has(t)) failed.push(t); });
        } else {
          log(`[ERROR] Yahoo rejected batch. Status: ${yRes.status}`);
          failed.push(...batch);
        }
      } catch (e) {
        log(`[ERROR] Yahoo network timeout.`);
        failed.push(...batch);
      }
    }

    // 2. GOOGLE FINANCE FALLBACK (For anything Yahoo missed)
    if (failed.length > 0) {
      log(`[SYSTEM] Initiating Google Finance fallback for ${failed.length} missing stocks...`);

      // We can run these securely in parallel from the Netlify server
      const promises = failed.map(async (t) => {
        try {
          const gUrl = `https://www.google.com/finance/quote/${t}:NSE`;
          const gRes = await fetch(gUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
          });

          if (gRes.ok) {
            const html = await gRes.text();
            let match = html.match(/data-last-price="([0-9.]+)"/) || html.match(/class="YMlKec fxKbKc"[^>]*>[^0-9]*([0-9,.]+)/);
            if (match && match[1]) {
              const p = parseFloat(match[1].replace(/,/g, ''));
              prices[t] = p;
              log(`[SUCCESS] (Fallback) ${t}: ₹${p.toFixed(2)}`);
              return;
            }
          }
          log(`[FAIL] Dead link for ${t}`);
        } catch (e) {
          log(`[FAIL] Network error scraping ${t}`);
        }
      });

      await Promise.all(promises);
    }

    log(`[SYSTEM] Secure fetch complete. Returning data to client.`);

    // Return the prices AND the terminal logs back to the web browser
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prices, logs })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message, logs: ["[CRITICAL ERROR] " + e.message] })
    };
  }
};