const PAIRS = {
  XBTUSD: "BTC",
  ETHUSD: "ETH"
};

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier + result;
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    averageGain =
      ((averageGain * (period - 1)) + gain) / period;

    averageLoss =
      ((averageLoss * (period - 1)) + loss) / period;
  }

  if (averageLoss === 0) return 100;

  const relativeStrength =
    averageGain / averageLoss;

  return 100 - (100 / (1 + relativeStrength));
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);

  if (ema12 === null || ema26 === null) {
    return null;
  }

  const macdLine = ema12 - ema26;

  // حساب تقريبي للـSignal Line باستعمال آخر قيم MACD
  const macdValues = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);

    if (e12 !== null && e26 !== null) {
      macdValues.push(e12 - e26);
    }
  }

  const signalLine =
    macdValues.length >= 9
      ? ema(macdValues, 9)
      : null;

  const histogram =
    signalLine !== null
      ? macdLine - signalLine
      : null;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram
  };
}

function round(value, decimals = 4) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

async function getKrakenCandles(pair, interval, limit = 200) {
  const response = await fetch(
    `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kraken HTTP ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const result = JSON.parse(body);

  if (result.error && result.error.length > 0) {
    throw new Error(result.error.join(", "));
  }

  const key = Object.keys(result.result || {})
    .find((item) => item !== "last");

  if (!key) {
    throw new Error("No candle data returned");
  }

  const candles = result.result[key]
    .slice(-limit)
    .map((c) => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      vwap: Number(c[5]),
      volume: Number(c[6]),
      trades: Number(c[7])
    }));

  return candles;
}

async function analyzeMarket(pair, interval) {
  const candles = await getKrakenCandles(
    pair,
    interval,
    200
  );

  if (candles.length < 60) {
    throw new Error(
      `Not enough candles: ${candles.length}`
    );
  }

  const closes = candles.map((c) => c.close);

  const price = closes[closes.length - 1];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);

  const rsi14 = rsi(closes, 14);

  const macdData = macd(closes);

  let bullishPoints = 0;
  let bearishPoints = 0;

  // EMA trend
  if (price > ema20) {
    bullishPoints++;
  } else {
    bearishPoints++;
  }

  if (ema20 > ema50) {
    bullishPoints++;
  } else {
    bearishPoints++;
  }

  // RSI
  if (rsi14 >= 50 && rsi14 < 70) {
    bullishPoints++;
  }

  if (rsi14 <= 50 && rsi14 > 30) {
    bearishPoints++;
  }

  // MACD
  if (
    macdData &&
    macdData.histogram !== null
  ) {
    if (macdData.histogram > 0) {
      bullishPoints++;
    } else {
      bearishPoints++;
    }
  }

  let signal = "HOLD";

  if (bullishPoints >= 3) {
    signal = "BUY";
  } else if (bearishPoints >= 3) {
    signal = "SELL";
  }

  const totalPoints = 4;

  const strongest =
    Math.max(
      bullishPoints,
      bearishPoints
    );

  const confidence = Math.round(
    (strongest / totalPoints) * 100
  );

  let trend = "SIDEWAYS";

  if (bullishPoints > bearishPoints) {
    trend = "BULLISH";
  } else if (bearishPoints > bullishPoints) {
    trend = "BEARISH";
  }

  let risk = "MEDIUM";

  if (
    rsi14 !== null &&
    (rsi14 >= 70 || rsi14 <= 30)
  ) {
    risk = "HIGH";
  } else if (confidence >= 75) {
    risk = "LOW";
  }

  return {
    success: true,
    pair,
    asset: PAIRS[pair] || pair,
    interval: `${interval}m`,

    market: {
      price: round(price, 2),
      candles: candles.length,
      source: "Kraken"
    },

    indicators: {
      rsi14: round(rsi14, 2),
      ema20: round(ema20, 2),
      ema50: round(ema50, 2),

      macd: macdData
        ? round(macdData.macd, 4)
        : null,

      macdSignal: macdData
        ? round(macdData.signal, 4)
        : null,

      macdHistogram: macdData
        ? round(macdData.histogram, 4)
        : null
    },

    analysis: {
      trend,
      signal,
      confidence,
      risk
    },

    timestamp: new Date().toISOString()
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // =========================
    // HOME
    // =========================

    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        mode: "real-market-analysis"
      });
    }

    // =========================
    // STATUS
    // =========================

    if (url.pathname === "/api/status") {
      return Response.json({
        status: "online",
        project: "AI Trader Pro",
        version: "V2.2",
        marketData: "CoinMarketCap + Kraken",
        analysis: "RSI + EMA + MACD"
      });
    }

    // =========================
    // CURRENT PRICE
    // =========================

    if (url.pathname === "/api/price") {
      const symbol =
        (
          url.searchParams.get("symbol") ||
          "BTCUSDT"
        ).toUpperCase();

      const ids = {
        BTCUSDT: 1,
        ETHUSDT: 1027
      };

      if (!ids[symbol]) {
        return Response.json(
          {
            error: "Unsupported symbol",
            supported: Object.keys(ids)
          },
          { status: 400 }
        );
      }

      try {
        const response = await fetch(
          `https://pro-api.coinmarketcap.com/public-api/v1/simple/price?ids=${ids[symbol]}&convert=USD`
        );

        const body = await response.text();

        if (!response.ok) {
          return Response.json(
            {
              error: "Market API error",
              upstream_status: response.status,
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        const result = JSON.parse(body);

        const coin = result?.data?.[0];

        if (!coin) {
          return Response.json(
            {
              error: "No market data returned"
            },
            { status: 502 }
          );
        }

        return Response.json({
          success: true,
          symbol,
          price: Number(coin.price),
          currency: "USD",
          source: "CoinMarketCap",
          timestamp:
            result?.status?.timestamp ||
            new Date().toISOString()
        });

      } catch (error) {
        return Response.json(
          {
            error: "Market connection failed",
            details: String(error)
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // CANDLES
    // =========================

    if (url.pathname === "/api/candles") {
      const pair =
        (
          url.searchParams.get("pair") ||
          "XBTUSD"
        ).toUpperCase();

      const interval =
        Number(
          url.searchParams.get("interval")
        ) || 60;

      const allowed = [
        1,
        5,
        15,
        30,
        60,
        240,
        1440
      ];

      if (!allowed.includes(interval)) {
        return Response.json(
          {
            error: "Invalid interval",
            allowed
          },
          { status: 400 }
        );
      }

      try {
        const candles =
          await getKrakenCandles(
            pair,
            interval,
            200
          );

        return Response.json({
          success: true,
          source: "Kraken",
          pair,
          interval_minutes: interval,
          count: candles.length,
          candles
        });

      } catch (error) {
        return Response.json(
          {
            error: "Candle API error",
            details: String(error)
          },
          { status: 502 }
        );
      }
    }

    // =========================
    // AI TRADER ANALYSIS
    // =========================

    if (url.pathname === "/api/analyze") {
      const pair =
        (
          url.searchParams.get("pair") ||
          "XBTUSD"
        ).toUpperCase();

      const interval =
        Number(
          url.searchParams.get("interval")
        ) || 60;

      const allowedPairs = [
        "XBTUSD",
        "ETHUSD"
      ];

      if (!allowedPairs.includes(pair)) {
        return Response.json(
          {
            error: "Unsupported pair",
            supported: allowedPairs
          },
          { status: 400 }
        );
      }

      try {
        const analysis =
          await analyzeMarket(
            pair,
            interval
          );

        return Response.json(
          analysis
        );

      } catch (error) {
        return Response.json(
          {
            error: "Analysis failed",
            details: String(error)
          },
          { status: 502 }
        );
      }
    }

    // =========================
    // 404
    // =========================

    return Response.json(
      {
        error: "Not Found",

        endpoints: [
          "/",
          "/api/status",
          "/api/price?symbol=BTCUSDT",
          "/api/candles?pair=XBTUSD&interval=60",
          "/api/analyze?pair=XBTUSD&interval=60"
        ]
      },
      { status: 404 }
    );
  }
};
