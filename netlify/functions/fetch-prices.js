const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

const handler = async function(event, context) {
  // 1. Connect to Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env variables!");
    return { statusCode: 500 };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 2. Fetch the current tournament state
  const { data: dbData, error } = await supabase
    .from('tournaments')
    .select('data')
    .eq('user_id', 'admin')
    .single();

  if (error || !dbData || !dbData.data.inited) {
    console.log("No active tournament found. Skipping.");
    return { statusCode: 200 };
  }

  const state = dbData.data;

  // 3. Compile all unique tickers
  const defaultStocks = [
    "HDFCBANK", "ICICIBANK", "BAJAJFINSV", "TITAN", "INFY", "BHARTIARTL",
    "ASIANPAINT", "MARUTI", "KOTAKBANK", "APOLLOHOSP", "LT", "PIDILITIND",
    "DIVISLAB", "COFORGE", "HDFCLIFE", "TRENT", "ETERNAL", "ABB", "CHOLAFIN",
    "NESTLEIND", "BAJAJ-AUTO", "MOTHERSON", "TATAPOWER", "NTPC", "POWERGRID",
    "TATACONSUM", "ITC", "FEDERALBNK", "HDFCAMC", "HEROMOTOCO", "COROMANDEL",
    "HINDALCO", "TVSMOTOR", "INDIGO", "NIFTYBEES"
  ];
  
  const allTickers = [...new Set([...defaultStocks, ...state.sA.map(s => s.t)])];
  const newPrices = {};

  // 4. Ultra-fast Dual Fetcher Helper
  const fetchPrice = async (ticker) => {
    try {
      // METHOD A: Try Yahoo's raw lightweight API first (Extremely fast, JSON)
      const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.NS?interval=1d&range=1d`;
      const yRes = await fetch(yUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
      });
      
      if (yRes.ok) {
        const yData = await yRes.json();
        const price = yData?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (price && !isNaN(price)) return price;
      }

      // METHOD B: Fallback to Google Finance HTML scraping if Yahoo fails
      const gUrl = `https://www.google.com/finance/quote/${ticker}:NSE`;
      const gRes = await fetch(gUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
      });
      
      if (gRes.ok) {
        const html = await gRes.text();
        let match = html.match(/data-last-price="([0-9.]+)"/) || html.match(/class="YMlKec fxKbKc"[^>]*>[^0-9]*([0-9,.]+)/);
        if (match && match[1]) {
          return parseFloat(match[1].replace(/,/g, ''));
        }
      }
    } catch (e) {
      console.error(`Error fetching ${ticker}:`, e.message);
    }
    return null;
  };

  // 5. Parallel Batching! (Fetch 10 stocks at a time to stay under the 30s timeout)
  const BATCH_SIZE = 10;
  for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
    const batch = allTickers.slice(i, i + BATCH_SIZE);
    
    // Fire off all 10 requests at the exact same time
    const promises = batch.map(async (ticker) => {
      const price = await fetchPrice(ticker);
      if (price) {
        newPrices[ticker] = price;
      } else {
        console.log(`Could not find price for ${ticker}`);
      }
    });

    await Promise.all(promises); // Wait for the batch of 10 to finish
    await new Promise(r => setTimeout(r, 200)); // Tiny 200ms pause between batches
  }

  // 6. Save the snapshot back to the database
  if (Object.keys(newPrices).length > 0) {
    state.snaps.push({
      date: new Date().toISOString(),
      prices: newPrices
    });

    await supabase
      .from('tournaments')
      .update({ data: state })
      .eq('user_id', 'admin');

    console.log(`Successfully recorded daily price snapshot for ${Object.keys(newPrices).length} stocks!`);
  } else {
    console.log("Warning: Script ran but retrieved zero prices.");
  }

  return { statusCode: 200 };
};

// Schedule it to run at 4:30 PM IST (11:00 AM UTC) every day after Indian markets close
exports.handler = schedule("0 11 * * *", handler);