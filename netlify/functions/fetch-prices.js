const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

const handler = async function(event, context) {
  // 1. Connect to Supabase using Netlify Environment Variables
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
  
  // 4. Fetch live prices via Google Finance (No API Key required!)
  const newPrices = {};

  for (const ticker of allTickers) {
    try {
      // Google Finance URL for NSE stocks
      const url = `https://www.google.com/finance/quote/${ticker}:NSE`;
      
      // Spoof a normal web browser to easily bypass bot protection
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const html = await response.text();
      
      // Smart Regex to extract the exact price from Google Finance's HTML source code
      let match = html.match(/data-last-price="([0-9.]+)"/);
      
      // Fallback if Google changes their background data tag
      if (!match) {
        match = html.match(/class="YMlKec fxKbKc"[^>]*>[^0-9]*([0-9,.]+)/);
      }

      if (match && match[1]) {
        // Remove any commas (like 1,450.20 -> 1450.20) and save as clean math number
        newPrices[ticker] = parseFloat(match[1].replace(/,/g, ''));
      } else {
        console.log(`Could not find price in HTML for ${ticker}`);
      }

      // Polite 250ms delay between requests so Google doesn't block the server
      await new Promise(r => setTimeout(r, 250));

    } catch (err) {
      console.error(`Failed to fetch ${ticker} from Google Finance:`, err.message);
    }
  }

  // 5. Save the snapshot back to the database
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