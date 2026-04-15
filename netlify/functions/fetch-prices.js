const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');
const yahooFinance = require('yahoo-finance2').default;

const handler = async function(event, context) {
  // Connect to Supabase using Netlify Environment Variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase env variables!");
    return { statusCode: 500 };
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch the current tournament state
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

  // Compile all unique tickers
  const defaultStocks = [
    "HDFCBANK", "ICICIBANK", "BAJAJFINSV", "TITAN", "INFY", "BHARTIARTL",
    "ASIANPAINT", "MARUTI", "KOTAKBANK", "APOLLOHOSP", "LT", "PIDILITIND",
    "DIVISLAB", "COFORGE", "HDFCLIFE", "TRENT", "ETERNAL", "ABB", "CHOLAFIN",
    "NESTLEIND", "BAJAJ-AUTO", "MOTHERSON", "TATAPOWER", "NTPC", "POWERGRID",
    "TATACONSUM", "ITC", "FEDERALBNK", "HDFCAMC", "HEROMOTOCO", "COROMANDEL",
    "HINDALCO", "TVSMOTOR", "INDIGO", "NIFTYBEES"
  ];
  
  const allTickers = [...new Set([...defaultStocks, ...state.sA.map(s => s.t)])];
  
  // Fetch live prices from Yahoo Finance
  const newPrices = {};
  for (const ticker of allTickers) {
    try {
      // Append .NS for NSE India stocks
      const quote = await yahooFinance.quote(`${ticker}.NS`);
      if (quote && quote.regularMarketPrice) {
        newPrices[ticker] = quote.regularMarketPrice;
      }
      // Small delay to respect Yahoo API limits
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`Failed to fetch ${ticker}:`, err.message);
    }
  }

  // Save the snapshot back to the database
  if (Object.keys(newPrices).length > 0) {
    state.snaps.push({
      date: new Date().toISOString(),
      prices: newPrices
    });

    await supabase
      .from('tournaments')
      .update({ data: state })
      .eq('user_id', 'admin');

    console.log("Successfully recorded daily price snapshot!");
  }

  return { statusCode: 200 };
};

// Schedule it to run at 4:30 PM IST (11:00 AM UTC) every day after Indian markets close
exports.handler = schedule("0 11 * * *", handler);