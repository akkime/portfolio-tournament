const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

const handler = async function(event, context) {
  // 1. Connect to Supabase using Netlify Environment Variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const fmpApiKey = process.env.FMP_API_KEY; // Your new official data key!
  
  if (!supabaseUrl || !supabaseKey || !fmpApiKey) {
    console.error("Missing Environment Variables! Check Supabase and FMP keys.");
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
  
  // 4. Fetch live prices from FMP API (All at once!)
  // FMP requires the .NS suffix for Indian stocks (e.g., HDFCBANK.NS)
  const tickerQueryString = allTickers.map(t => `${t}.NS`).join(',');
  const newPrices = {};

  try {
    const response = await fetch(`https://financialmodelingprep.com/api/v3/quote-short/${tickerQueryString}?apikey=${fmpApiKey}`);
    
    if (!response.ok) {
      throw new Error(`API returned status: ${response.status}`);
    }

    const priceData = await response.json();
    
    // priceData is an array: [{symbol: "HDFCBANK.NS", price: 1450.5}, ...]
    priceData.forEach(item => {
      const cleanTicker = item.symbol.replace('.NS', ''); // Remove .NS before saving
      newPrices[cleanTicker] = item.price;
    });

  } catch (err) {
    console.error("Failed to fetch from FMP API:", err.message);
    return { statusCode: 500 }; // Abort if API fails
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
    console.log("Warning: API succeeded but returned no prices.");
  }

  return { statusCode: 200 };
};

// Schedule it to run at 4:30 PM IST (11:00 AM UTC) every day after Indian markets close
exports.handler = schedule("0 11 * * *", handler);