const CONFIG = {
  version: "V2.6",
  feePercent: 0.1,
  slippagePercent: 0.05,
  riskPerTradePercent: 1,
  minConfidence: 70
};

const ALLOWED_INTERVALS = [60, 240];

function round(value, decimals = 2) {
  return Number.isFinite(value)
    ? Number(value.toFixed(decimals))
    : null;
}

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * k + result;
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) gain += change;
    if (change < 0) loss += Math.abs(change);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const g = change > 0 ? change : 0;
    const l = change < 0 ? Math.abs(change) : 0;

    avgGain =
      ((avgGain * (period - 1)) + g) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + l) / period;
  }

  if (avgLoss === 0) return 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(values) {
  const lines = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);

    if (e12 !== null && e26 !== null) {
      lines.push(e12 - e26);
    }
  }

  if (lines.length < 9) return null;

  const line = lines[lines.length - 1];
  const signal = ema(lines, 9);

  if (signal === null) return null;

  return {
    line,
    signal,
    histogram: line - signal
  };
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  let result =
    ranges.slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < ranges.length; i++) {
    result =
      ((result * (period - 1)) + ranges[i]) /
      period;
  }

  return result;
}

function analyze(candles) {
  if (candles.length < 60) return null;

  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];

  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const a = atr(candles, 14);

  if (
    e20 === null ||
    e50 === null ||
    r === null ||
    m === null ||
    a === null
  ) {
    return null;
  }

  let buyScore = 0;
  let sellScore = 0;

  if (price > e20) buyScore++;
  if (price < e20) sellScore++;

  if (e20 > e50) buyScore++;
  if (e20 < e50) sellScore++;

  if (r > 50 && r < 70) buyScore++;
  if (r < 50 && r > 30) sellScore++;

  if (m.histogram > 0) buyScore++;
  if (m.histogram < 0) sellScore++;

  let signal = "HOLD";

  if (buyScore >= 3 && buyScore > sellScore) {
    signal = "BUY";
  }

  if (sellScore >= 3 && sellScore > buyScore) {
    signal = "SELL";
  }

  const score = Math.max(
    buyScore,
    sellScore
  );

  const confidence =
    Math.round((score / 4) * 100);

  let stopLoss = null;
  let takeProfit1 = null;
  let takeProfit2 = null;

  if (signal === "BUY") {
    stopLoss = price - a * 1.5;

    const risk = price - stopLoss;

    takeProfit1 = price + risk * 2;
    takeProfit2 = price + risk * 2.5;
  }

  if (signal === "SELL") {
    stopLoss = price + a * 1.5;

    const risk = stopLoss - price;

    takeProfit1 = price - risk * 2;
    takeProfit2 = price - risk * 2.5;
  }

  return {
    price,
    ema20: e20,
    ema50: e50,
    rsi14: r,
    macd: m.line,
    macdSignal: m.signal,
    macdHistogram: m.histogram,
    atr14: a,
    signal,
    confidence,
    buyScore,
    sellScore,
    stopLoss,
    takeProfit1,
    takeProfit2
  };
}

async function getCandles(
  pair,
  interval,
  limit = 200
) {
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
      `Kraken HTTP ${response.status}`
    );
  }

  const data = JSON.parse(text);

  if (data.error && data.error.length) {
    throw new Error(
      data.error.join(", ")
    );
  }

  const result = data.result || {};

  const key = Object.keys(result).find(
    k => k !== "last"
  );

  if (!key) {
    throw new Error(
      "No Kraken candle data"
    );
  }

  return result[key]
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

function calculateTradeResult(
  setup,
  candles,
  entryIndex
) {
  const entry = setup.price;

  for (
    let i = entryIndex + 1;
    i < candles.length;
    i++
  ) {
    const candle = candles[i];

    if (setup.signal === "BUY") {
      const stopHit =
        candle.low <= setup.stopLoss;

      const targetHit =
        candle.high >= setup.takeProfit1;

      if (stopHit && targetHit) {
        return {
          outcome: "LOSS",
          grossReturn: -1,
          exitIndex: i
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          grossReturn: -1,
          exitIndex: i
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          grossReturn: 2,
          exitIndex: i
        };
      }
    }

    if (setup.signal === "SELL") {
      const stopHit =
        candle.high >= setup.stopLoss;

      const targetHit =
        candle.low <= setup.takeProfit1;

      if (stopHit && targetHit) {
        return {
          outcome: "LOSS",
          grossReturn: -1,
          exitIndex: i
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          grossReturn: -1,
          exitIndex: i
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          grossReturn: 2,
          exitIndex: i
        };
      }
    }
  }

  return null;
}

async function backtest(
  pair,
  interval,
  limit = 200
) {
  const candles =
    await getCandles(
      pair,
      interval,
      limit
    );

  let equity = 100;
  let peak = 100;
  let maxDrawdown = 0;

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  const trades = [];

  let nextAvailableIndex = 60;

  for (
    let i = 60;
    i < candles.length - 1;
    i++
  ) {
    if (i < nextAvailableIndex) {
      continue;
    }

    const history =
      candles.slice(0, i + 1);

    const setup =
      analyze(history);

    if (!setup) continue;

    if (
      setup.signal !== "BUY" &&
      setup.signal !== "SELL"
    ) {
      continue;
    }

    if (
      setup.confidence <
      CONFIG.minConfidence
    ) {
      continue;
    }

    const result =
      calculateTradeResult(
        setup,
        candles,
        i
      );

    if (!result) continue;

    const costs =
      (CONFIG.feePercent * 2) +
      (CONFIG.slippagePercent * 2);

    const netReturn =
      result.grossReturn - costs;

    if (result.outcome === "WIN") {
      wins++;
      grossProfit += netReturn;
    } else {
      losses++;
      grossLoss += Math.abs(netReturn);
    }

    equity =
      equity *
      (1 + netReturn / 100);

    peak =
      Math.max(peak, equity);

    const drawdown =
      ((peak - equity) /
        peak) * 100;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );

    trades.push({
      time:
        new Date(
          candles[
            result.exitIndex
          ].time * 1000
        ).toISOString(),

      signal: setup.signal,

      entry: round(
        entryPrice(setup)
      ),

      stopLoss: round(
        setup.stopLoss
      ),

      takeProfit: round(
        setup.takeProfit1
      ),

      outcome:
        result.outcome,

      grossReturn:
        round(
          result.grossReturn,
          3
        ),

      netReturn:
        round(
          netReturn,
          3
        )
    });

    /*
      لا نفتح صفقة جديدة
      حتى تنتهي الصفقة الحالية.
    */
    nextAvailableIndex =
      result.exitIndex + 1;
  }

  const totalTrades =
    wins + losses;

  const winRate =
    totalTrades
      ? (wins / totalTrades) * 100
      : 0;

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : null;

  return {
    success: true,

    project:
      "AI Trader Pro",

    version:
      CONFIG.version,

    pair,

    interval:
      `${interval}m`,

    source:
      "Kraken",

    configuration: {
      feePercent:
        CONFIG.feePercent,

      slippagePercent:
        CONFIG.slippagePercent,

      riskPerTradePercent:
        CONFIG.riskPerTradePercent,

      minimumConfidence:
        CONFIG.minConfidence,

      riskReward:
        "1:2"
    },

    backtest: {
      candlesTested:
        candles.length,

      trades:
        totalTrades,

      wins,

      losses,

      winRate:
        round(winRate),

      profitFactor:
        round(
          profitFactor,
          3
        ),

      netReturn:
        round(
          equity - 100,
          3
        ),

      startingEquity:
        100,

      endingEquity:
        round(
          equity,
          3
        ),

      maxDrawdown:
        round(
          maxDrawdown,
          3
        )
    },

    note:
      "Historical simulation only. Fees and slippage included. No guarantee of future performance.",

    recentTrades:
      trades.slice(-20),

    timestamp:
      new Date().toISOString()
  };
}

function entryPrice(setup) {
  return setup.price;
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

    if (
      url.pathname === "/"
    ) {
      return json({
        name:
          "AI Trader Pro",

        version:
          CONFIG.version,

        status:
          "online",

        marketData:
          "Kraken",

        realTrading:
          false,

        message:
          "AI Trader Pro API is running"
      });
    }

    if (
      url.pathname ===
      "/api/status"
    ) {
      return json({
        project:
          "AI Trader Pro",

        version:
          CONFIG.version,

        status:
          "online",

        marketData:
          "Kraken",

        indicators: [
          "RSI14",
          "EMA20",
          "EMA50",
          "MACD",
          "ATR14"
        ],

        strategy:
          "3-condition confirmation",

        riskReward:
          "1:2",

        backtesting:
          true,

        realTrading:
          false,

        timestamp:
          new Date().toISOString()
      });
    }

    if (
      url.pathname ===
      "/api/analyze"
    ) {
      const pair =
        (
          url.searchParams.get(
            "pair"
          ) ||
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
        const candles =
          await getCandles(
            pair,
            interval,
            200
          );

        const result =
          analyze(candles);

        if (!result) {
          throw new Error(
            "Not enough data"
          );
        }

        let risk = "LOW";

        if (
          result.rsi14 >= 70 ||
          result.rsi14 <= 30
        ) {
          risk = "HIGH";
        } else if (
          result.confidence < 80
        ) {
          risk = "MEDIUM";
        }

        return json({
          success: true,

          project:
            "AI Trader Pro",

          version:
            CONFIG.version,

          pair,

          interval:
            `${interval}m`,

          source:
            "Kraken",

          market: {
            price:
              round(
                result.price
              ),

            candles:
              candles.length
          },

          indicators: {
            rsi14:
              round(
                result.rsi14
              ),

            ema20:
              round(
                result.ema20
              ),

            ema50:
              round(
                result.ema50
              ),

            macd:
              round(
                result.macd,
                4
              ),

            macdSignal:
              round(
                result.macdSignal,
                4
              ),

            macdHistogram:
              round(
                result.macdHistogram,
                4
              ),

            atr14:
              round(
                result.atr14
              )
          },

          analysis: {
            signal:
              result.signal,

            confidence:
              result.confidence,

            buyScore:
              result.buyScore,

            sellScore:
              result.sellScore,

            risk
          },

          riskManagement: {
            entry:
              round(
                result.price
              ),

            stopLoss:
              round(
                result.stopLoss
              ),

            takeProfit1:
              round(
                result.takeProfit1
              ),

            takeProfit2:
              round(
                result.takeProfit2
              ),

            riskReward:
              "1:2 / 1:2.5"
          },

          timestamp:
            new Date().toISOString()
        });

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

    if (
      url.pathname ===
      "/api/backtest"
    ) {
      const pair =
        (
          url.searchParams.get(
            "pair"
          ) ||
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
          await backtest(
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

    return json(
      {
        error:
          "Not Found",

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
