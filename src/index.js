const PAIRS = {
  XBTUSD: "BTC",
  ETHUSD: "ETH"
};

const ALLOWED_INTERVALS = [1, 5, 15, 30, 60, 240, 1440];

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

    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
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
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);

  if (ema12 === null || ema26 === null) {
    return null;
  }

  const macdValues = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);

    macdValues.push(e12 - e26);
  }

  const macdLine = macdValues[macdValues.length - 1];

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

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const r1 = current.high - current.low;
    const r2 = Math.abs(current.high - previous.close);
    const r3 = Math.abs(current.low - previous.close);

    ranges.push(Math.max(r1, r2, r3));
  }

  if (ranges.length < period) return null;

  let value =
    ranges
      .slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < ranges.length; i++) {
    value =
      ((value * (period - 1)) + ranges[i]) / period;
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

  let bullish = 0;
  let bearish = 0;

  if (price > ema20) {
    bullish++;
  } else {
    bearish++;
  }

  if (ema20 > ema50) {
    bullish++;
  } else {
    bearish++;
  }

  if (rsi14 >= 50 && rsi14 < 70) {
    bullish++;
  }

  if (rsi14 <= 50 && rsi14 > 30) {
    bearish++;
  }

  if (macdData && macdData.histogram !== null) {
    if (macdData.histogram > 0) {
      bullish++;
    } else {
      bearish++;
    }
  }

  let signal = "HOLD";

  if (bullish >= 3) {
    signal = "BUY";
  } else if (bearish >= 3) {
    signal = "SELL";
  }

  let trend = "SIDEWAYS";

  if (bullish > bearish) {
    trend = "BULLISH";
  } else if (bearish > bullish) {
    trend = "BEARISH";
  }

  const confidence =
    Math.round(
      (Math.max(bullish, bearish) / 4) * 100
    );

  let risk = "MEDIUM";

  if (
    rsi14 >= 70 ||
    rsi14 <= 30
  ) {
    risk = "HIGH";
  } else if (confidence >= 75) {
    risk = "LOW";
  }

  let entry = price;
  let stopLoss = null;
  let tp1 = null;
  let tp2 = null;

  if (atr14 !== null) {
    if (signal === "BUY") {
      stopLoss = entry - atr14 * 1.5;

      const riskAmount = entry - stopLoss;

      tp1 = entry + riskAmount * 1.5;
      tp2 = entry + riskAmount * 2.5;
    }

    if (signal === "SELL") {
      stopLoss = entry + atr14 * 1.5;

      const riskAmount = stopLoss - entry;

      tp1 = entry - riskAmount * 1.5;
      tp2 = entry - riskAmount * 2.5;
    }
  }

  return {
    price,
    ema20,
    ema50,
    rsi14,
    macd: macdData?.macd ?? null,
    macdSignal: macdData?.signal ?? null,
    macdHistogram: macdData?.histogram ?? null,
    atr14,
    trend,
    signal,
    confidence,
    risk,
    entry,
    stopLoss,
    tp1,
    tp2
  };
}

async function getKrakenCandles(
  pair,
  interval,
  limit = 200
) {
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

  const key =
    Object.keys(result.result || {})
      .find(k => k !== "last");

  if (!key) {
    throw new Error("No candle data returned");
  }

  return result.result[key]
    .slice(-limit)
    .map(c => ({
      time: Number(c[0]),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      vwap: Number(c[5]),
      volume: Number(c[6]),
      trades: Number(c[7])
    }));
}

async function analyzeMarket(
  pair,
  interval
) {
  const candles =
    await getKrakenCandles(
      pair,
      interval,
      200
    );

  const result =
    calculateSignal(candles);

  if (!result) {
    throw new Error(
      "Not enough candles"
    );
  }

  return {
    success: true,

    pair,

    asset:
      PAIRS[pair] || pair,

    interval:
      `${interval}m`,

    market: {
      price:
        round(result.price),
      candles:
        candles.length,
      source:
        "Kraken"
    },

    indicators: {
      rsi14:
        round(result.rsi14, 2),

      ema20:
        round(result.ema20),

      ema50:
        round(result.ema50),

      macd:
        round(result.macd, 4),

      macdSignal:
        round(result.macdSignal, 4),

      macdHistogram:
        round(result.macdHistogram, 4),

      atr14:
        round(result.atr14)
    },

    analysis: {
      trend:
        result.trend,

      signal:
        result.signal,

      confidence:
        result.confidence,

      risk:
        result.risk
    },

    riskManagement: {
      entry:
        round(result.entry),

      stopLoss:
        round(result.stopLoss),

      takeProfit1:
        round(result.tp1),

      takeProfit2:
        round(result.tp2),

      riskReward: {
        tp1: 1.5,
        tp2: 2.5
      }
    },

    timestamp:
      new Date().toISOString()
  };
}

async function backtest(
  pair,
  interval
) {
  const candles =
    await getKrakenCandles(
      pair,
      interval,
      200
    );

  const trades = [];

  let wins = 0;
  let losses = 0;
  let totalReturn = 0;

  let equity = 100;

  let peakEquity = 100;
  let maxDrawdown = 0;

  const startIndex = 60;

  for (
    let i = startIndex;
    i < candles.length - 1;
    i++
  ) {
    const history =
      candles.slice(0, i + 1);

    const signal =
      calculateSignal(history);

    if (!signal) continue;

    if (
      signal.signal !== "BUY" &&
      signal.signal !== "SELL"
    ) {
      continue;
    }

    if (
      signal.stopLoss === null ||
      signal.tp1 === null
    ) {
      continue;
    }

    const next =
      candles[i + 1];

    let outcome =
      "LOSS";

    let returnPct =
      -1;

    if (signal.signal === "BUY") {
      const hitStop =
        next.low <= signal.stopLoss;

      const hitTP =
        next.high >= signal.tp1;

      if (hitStop && hitTP) {
        outcome = "LOSS";
        returnPct = -1;
      } else if (hitTP) {
        outcome = "WIN";
        returnPct = 1.5;
      } else if (hitStop) {
        outcome = "LOSS";
        returnPct = -1;
      } else {
        continue;
      }
    }

    if (signal.signal === "SELL") {
      const hitStop =
        next.high >= signal.stopLoss;

      const hitTP =
        next.low <= signal.tp1;

      if (hitStop && hitTP) {
        outcome = "LOSS";
        returnPct = -1;
      } else if (hitTP) {
        outcome = "WIN";
        returnPct = 1.5;
      } else if (hitStop) {
        outcome = "LOSS";
        returnPct = -1;
      } else {
        continue;
      }
    }

    if (outcome === "WIN") {
      wins++;
    } else {
      losses++;
    }

    totalReturn += returnPct;

    equity =
      equity * (1 + returnPct / 100);

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      ((peakEquity - equity) /
        peakEquity) *
      100;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );

    trades.push({
      time:
        new Date(
          next.time * 1000
        ).toISOString(),

      signal:
        signal.signal,

      entry:
        round(signal.entry),

      stopLoss:
        round(signal.stopLoss),

      takeProfit:
        round(signal.tp1),

      outcome,

      returnPct
    });
  }

  const totalTrades =
    wins + losses;

  const winRate =
    totalTrades > 0
      ? (wins / totalTrades) * 100
      : 0;

  return {
    success: true,

    pair,

    interval:
      `${interval}m`,

    source:
      "Kraken",

    backtest: {
      candlesTested:
        candles.length,

      trades:
        totalTrades,

      wins,

      losses,

      winRate:
        round(winRate, 2),

      simulatedReturn:
        round(totalReturn, 2),

      startingEquity:
        100,

      endingEquity:
        round(equity, 2),

      maxDrawdown:
        round(maxDrawdown, 2)
    },

    note:
      "Historical simulation only. Not a guarantee of future results.",

    recentTrades:
      trades.slice(-20)
  };
}

export default {
  async fetch(request) {
    const url =
      new URL(request.url);

    // HOME
    if (url.pathname === "/") {
      return Response.json({
        name:
          "AI Trader Pro",

        version:
          "V2.3",

        status:
          "online",

        mode:
          "real-market-analysis"
      });
    }

    // STATUS
    if (url.pathname === "/api/status") {
      return Response.json({
        status:
          "online",

        project:
          "AI Trader Pro",

        version:
          "V2.3",

        marketData:
          "Kraken",

        indicators:
          "RSI + EMA + MACD + ATR",

        riskManagement:
          "Active",

        backtesting:
          "Active"
      });
    }

    // CANDLES
    if (
      url.pathname ===
      "/api/candles"
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
        return Response.json(
          {
            error:
              "Invalid interval",

            allowed:
              ALLOWED_INTERVALS
          },

          {
            status: 400
          }
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
          success:
            true,

          source:
            "Kraken",

          pair,

          interval_minutes:
            interval,

          count:
            candles.length,

          candles
        });

      } catch (error) {
        return Response.json(
          {
            error:
              "Candle API error",

            details:
              String(error)
          },

          {
            status: 502
          }
        );
      }
    }

    // ANALYZE
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

      try {
        const result =
          await analyzeMarket(
            pair,
            interval
          );

        return Response.json(
          result
        );

      } catch (error) {
        return Response.json(
          {
            error:
              "Analysis failed",

            details:
              String(error)
          },

          {
            status: 502
          }
        );
      }
    }

    // BACKTEST
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

      if (
        !ALLOWED_INTERVALS.includes(
          interval
        )
      ) {
        return Response.json(
          {
            error:
              "Invalid interval",

            allowed:
              ALLOWED_INTERVALS
          },

          {
            status: 400
          }
        );
      }

      try {
        const result =
          await backtest(
            pair,
            interval
          );

        return Response.json(
          result
        );

      } catch (error) {
        return Response.json(
          {
            error:
              "Backtest failed",

            details:
              String(error)
          },

          {
            status: 502
          }
        );
      }
    }

    // 404
    return Response.json(
      {
        error:
          "Not Found",

        endpoints: [
          "/",
          "/api/status",
          "/api/candles?pair=XBTUSD&interval=60",
          "/api/analyze?pair=XBTUSD&interval=60",
          "/api/backtest?pair=XBTUSD&interval=60"
        ]
      },

      {
        status: 404
      }
    );
  }
};
