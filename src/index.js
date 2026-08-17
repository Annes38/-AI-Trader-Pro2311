const CONFIG = {
  version: "V2.5",
  feePercent: 0.1,
  slippagePercent: 0.05,
  riskPerTradePercent: 1,
  minConfidence: 75
};

const ALLOWED_INTERVALS = [60, 240];

function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
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

  const rs = averageGain / averageLoss;

  return 100 - 100 / (1 + rs);
}

function macd(values) {
  const macdValues = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const ema12 = ema(slice, 12);
    const ema26 = ema(slice, 26);

    if (ema12 !== null && ema26 !== null) {
      macdValues.push(ema12 - ema26);
    }
  }

  if (macdValues.length < 9) return null;

  const line = macdValues[macdValues.length - 1];
  const signal = ema(macdValues, 9);

  if (signal === null) return null;

  return {
    line,
    signal,
    histogram: line - signal
  };
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    trueRanges.push(trueRange);
  }

  let value =
    trueRanges
      .slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < trueRanges.length; i++) {
    value =
      ((value * (period - 1)) + trueRanges[i]) / period;
  }

  return value;
}

function calculateSignal(candles) {
  if (candles.length < 60) {
    return null;
  }

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const atr14 = atr(candles, 14);

  if (
    ema20 === null ||
    ema50 === null ||
    rsi14 === null ||
    macdData === null ||
    atr14 === null
  ) {
    return null;
  }

  let buyScore = 0;
  let sellScore = 0;

  // الاتجاه
  if (price > ema20) buyScore++;
  if (price < ema20) sellScore++;

  if (ema20 > ema50) buyScore++;
  if (ema20 < ema50) sellScore++;

  // RSI
  // لا نشتري إذا RSI >= 70
  if (rsi14 >= 50 && rsi14 < 70) {
    buyScore++;
  }

  // لا نبيع إذا RSI <= 30
  if (rsi14 <= 50 && rsi14 > 30) {
    sellScore++;
  }

  // MACD
  if (macdData.histogram > 0) {
    buyScore++;
  }

  if (macdData.histogram < 0) {
    sellScore++;
  }

  let action = "HOLD";

  /*
    لازم 4 شروط متوافقة
    حتى ندخل صفقة.
  */

  if (buyScore >= 4 && rsi14 < 70) {
    action = "BUY";
  }

  if (sellScore >= 4 && rsi14 > 30) {
    action = "SELL";
  }

  const score = Math.max(buyScore, sellScore);
  const confidence = Math.round((score / 4) * 100);

  let stopLoss = null;
  let takeProfit1 = null;
  let takeProfit2 = null;

  /*
    ATR × 1.5 = Stop Loss
    TP1 = 2R
    TP2 = 2.5R
  */

  if (action === "BUY") {
    stopLoss = price - atr14 * 1.5;

    const risk = price - stopLoss;

    takeProfit1 = price + risk * 2;
    takeProfit2 = price + risk * 2.5;
  }

  if (action === "SELL") {
    stopLoss = price + atr14 * 1.5;

    const risk = stopLoss - price;

    takeProfit1 = price - risk * 2;
    takeProfit2 = price - risk * 2.5;
  }

  return {
    price,
    ema20,
    ema50,
    rsi14,
    macd: macdData.line,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    atr14,

    action,
    confidence,

    buyScore,
    sellScore,

    stopLoss,
    takeProfit1,
    takeProfit2
  };
}

async function getKrakenCandles(pair, interval, limit = 200) {
  const url =
    `https://api.kraken.com/0/public/OHLC` +
    `?pair=${encodeURIComponent(pair)}` +
    `&interval=${interval}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Kraken HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }

  const data = JSON.parse(text);

  if (data.error && data.error.length > 0) {
    throw new Error(data.error.join(", "));
  }

  const result = data.result || {};

  const pairKey = Object.keys(result).find(
    key => key !== "last"
  );

  if (!pairKey) {
    throw new Error("Kraken returned no candle data");
  }

  return result[pairKey]
    .slice(-limit)
    .map(candle => ({
      time: Number(candle[0]),
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      vwap: Number(candle[5]),
      volume: Number(candle[6]),
      trades: Number(candle[7])
    }));
}

async function analyzeMarket(pair, interval) {
  const candles =
    await getKrakenCandles(pair, interval, 200);

  const result = calculateSignal(candles);

  if (!result) {
    throw new Error("Not enough market data");
  }

  let risk = "LOW";

  if (result.rsi14 >= 70 || result.rsi14 <= 30) {
    risk = "HIGH";
  } else if (result.confidence < 85) {
    risk = "MEDIUM";
  }

  return {
    success: true,

    project: "AI Trader Pro",
    version: CONFIG.version,

    pair,
    interval: `${interval}m`,
    source: "Kraken",

    market: {
      price: round(result.price),
      candles: candles.length
    },

    indicators: {
      rsi14: round(result.rsi14),
      ema20: round(result.ema20),
      ema50: round(result.ema50),
      macd: round(result.macd, 4),
      macdSignal: round(result.macdSignal, 4),
      macdHistogram: round(result.macdHistogram, 4),
      atr14: round(result.atr14)
    },

    analysis: {
      signal: result.action,
      confidence: result.confidence,
      buyScore: result.buyScore,
      sellScore: result.sellScore,
      risk
    },

    riskManagement: {
      entry: round(result.price),
      stopLoss: round(result.stopLoss),
      takeProfit1: round(result.takeProfit1),
      takeProfit2: round(result.takeProfit2),
      riskReward: "1:2 / 1:2.5",
      riskPerTradePercent:
        CONFIG.riskPerTradePercent
    },

    timestamp: new Date().toISOString()
  };
}

async function runBacktest(
  pair,
  interval,
  limit = 200
) {
  const candles =
    await getKrakenCandles(pair, interval, limit);

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  let equity = 100;
  let peakEquity = 100;
  let maxDrawdown = 0;

  const trades = [];

  for (let i = 60; i < candles.length - 1; i++) {
    const history = candles.slice(0, i + 1);

    const setup = calculateSignal(history);

    if (!setup) continue;

    if (
      setup.action !== "BUY" &&
      setup.action !== "SELL"
    ) {
      continue;
    }

    /*
      لا ندخل إلا إذا كانت الثقة
      75% أو أكثر.
    */

    if (setup.confidence < CONFIG.minConfidence) {
      continue;
    }

    const nextCandle = candles[i + 1];

    let outcome = null;
    let grossReturn = 0;

    if (setup.action === "BUY") {
      const hitStop =
        nextCandle.low <= setup.stopLoss;

      const hitTarget =
        nextCandle.high >= setup.takeProfit1;

      /*
        إذا ضرب Stop وTP في نفس الشمعة،
        نحسبها خسارة بشكل محافظ.
      */

      if (hitStop) {
        outcome = "LOSS";
        grossReturn = -1;
      } else if (hitTarget) {
        outcome = "WIN";
        grossReturn = 2;
      }
    }

    if (setup.action === "SELL") {
      const hitStop =
        nextCandle.high >= setup.stopLoss;

      const hitTarget =
        nextCandle.low <= setup.takeProfit1;

      if (hitStop) {
        outcome = "LOSS";
        grossReturn = -1;
      } else if (hitTarget) {
        outcome = "WIN";
        grossReturn = 2;
      }
    }

    if (outcome === null) {
      continue;
    }

    const tradingCosts =
      CONFIG.feePercent * 2 +
      CONFIG.slippagePercent * 2;

    const netReturn =
      grossReturn - tradingCosts;

    if (outcome === "WIN") {
      wins++;
      grossProfit += netReturn;
    } else {
      losses++;
      grossLoss += Math.abs(netReturn);
    }

    equity =
      equity * (1 + netReturn / 100);

    peakEquity =
      Math.max(peakEquity, equity);

    const drawdown =
      ((peakEquity - equity) /
        peakEquity) * 100;

    maxDrawdown =
      Math.max(maxDrawdown, drawdown);

    trades.push({
      time: new Date(
        nextCandle.time * 1000
      ).toISOString(),

      signal: setup.action,

      entry: round(setup.price),

      stopLoss: round(
        setup.stopLoss
      ),

      takeProfit: round(
        setup.takeProfit1
      ),

      outcome,

      grossReturn: round(
        grossReturn,
        3
      ),

      netReturn: round(
        netReturn,
        3
      )
    });
  }

  const totalTrades =
    wins + losses;

  const winRate =
    totalTrades > 0
      ? (wins / totalTrades) * 100
      : 0;

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : null;

  return {
    success: true,

    project: "AI Trader Pro",
    version: CONFIG.version,

    pair,
    interval: `${interval}m`,
    source: "Kraken",

    configuration: {
      feePercent: CONFIG.feePercent,
      slippagePercent:
        CONFIG.slippagePercent,
      riskPerTradePercent:
        CONFIG.riskPerTradePercent,
      minimumConfidence:
        CONFIG.minConfidence,
      riskReward: "1:2"
    },

    backtest: {
      candlesTested: candles.length,
      trades: totalTrades,
      wins,
      losses,
      winRate: round(winRate),
      profitFactor:
        round(profitFactor, 3),
      netReturn: round(
        equity - 100,
        3
      ),
      startingEquity: 100,
      endingEquity: round(
        equity,
        3
      ),
      maxDrawdown:
        round(maxDrawdown, 3)
    },

    note:
      "Historical simulation only. Fees and slippage included. This does not guarantee future performance.",

    recentTrades:
      trades.slice(-20),

    timestamp:
      new Date().toISOString()
  };
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}

export default {
  async fetch(request) {
    const url =
      new URL(request.url);

    /*
      HOME
    */

    if (url.pathname === "/") {
      return json({
        name: "AI Trader Pro",
        version: CONFIG.version,
        status: "online",
        mode: "analysis-only",
        marketData: "Kraken",
        realTrading: false,
        message:
          "AI Trader Pro API is running"
      });
    }

    /*
      STATUS
    */

    if (
      url.pathname ===
      "/api/status"
    ) {
      return json({
        project: "AI Trader Pro",
        version: CONFIG.version,
        status: "online",

        marketData: "Kraken",

        indicators: [
          "RSI14",
          "EMA20",
          "EMA50",
          "MACD",
          "ATR14"
        ],

        strategy:
          "4-condition confirmation",

        riskReward:
          "1:2 / 1:2.5",

        backtesting: true,

        realTrading: false,

        timestamp:
          new Date().toISOString()
      });
    }

    /*
      MARKET ANALYSIS
    */

    if (
      url.pathname ===
      "/api/analyze"
    ) {
      const pair =
        (
          url.searchParams.get("pair") ||
          "XBTUSD"
        ).toUpperCase();

      const interval =
        Number(
          url.searchParams.get(
            "interval"
          )
        ) || 60;

      if (
        !ALLOWED_INTERVALS.includes(
          interval
        )
      ) {
        return json(
          {
            error:
              "Invalid interval",

            allowed:
              ALLOWED_INTERVALS
          },
          400
        );
      }

      try {
        return json(
          await analyzeMarket(
            pair,
            interval
          )
        );
      } catch (error) {
        return json(
          {
            error:
              "Market analysis error",

            details:
              String(error)
          },
          502
        );
      }
    }

    /*
      BACKTEST
    */

    if (
      url.pathname ===
      "/api/backtest"
    ) {
      const pair =
        (
          url.searchParams.get("pair") ||
          "XBTUSD"
        ).toUpperCase();

      const interval =
        Number(
          url.searchParams.get(
            "interval"
          )
        ) || 60;

      const limit =
        Math.min(
          Math.max(
            Number(
              url.searchParams.get(
                "limit"
              )
            ) || 200,
            100
          ),
          200
        );

      if (
        !ALLOWED_INTERVALS.includes(
          interval
        )
      ) {
        return json(
          {
            error:
              "Invalid interval",

            allowed:
              ALLOWED_INTERVALS
          },
          400
        );
      }

      try {
        return json(
          await runBacktest(
            pair,
            interval,
            limit
          )
        );
      } catch (error) {
        return json(
          {
            error:
              "Backtest error",

            details:
              String(error)
          },
          502
        );
      }
    }

    /*
      UNKNOWN ROUTE
    */

    return json(
      {
        error: "Not Found",

        availableEndpoints: [
          "/",
          "/api/status",
          "/api/analyze?pair=XBTUSD&interval=60",
          "/api/analyze?pair=XBTUSD&interval=240",
          "/api/backtest?pair=XBTUSD&interval=60&limit=200",
          "/api/backtest?pair=XBTUSD&interval=240&limit=200"
        ]
      },
      404
    );
  }
};
