// ============================================================
// AI TRADER PRO - V4.0 FINAL
// Market: Kraken
// Trading: DISABLED / Analysis + Backtest only
// ============================================================

const VERSION = "V4.0";
const PROJECT = "AI Trader Pro";

const CONFIG = {
  accountBalance: 100,
  riskPercent: 1,
  riskReward: 2,
  feePercent: 0.1,
  slippagePercent: 0.05,
  minimumConfidence: 75,
  maxHoldingCandles: 12,
  cooldownCandles: 2,
  defaultLimit: 720,
  maxLimit: 720
};

// ------------------------------------------------------------
// Kraken pair mapping
// ------------------------------------------------------------
function normalizePair(pair) {
  const p = String(pair || "XBTUSD").toUpperCase();

  const pairs = {
    XBTUSD: "XXBTZUSD",
    BTCUSD: "XXBTZUSD",
    ETHUSD: "XETHZUSD",
    ETHUSDT: "XETHZUSD"
  };

  return pairs[p] || p;
}

// ------------------------------------------------------------
// JSON response
// ------------------------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// ------------------------------------------------------------
// Kraken API
// ------------------------------------------------------------
async function krakenOHLC(pair, interval = 60, limit = 720) {
  const krakenPair = normalizePair(pair);

  const safeInterval = Number(interval) || 60;
  const safeLimit = Math.min(
    Math.max(Number(limit) || 720, 50),
    CONFIG.maxLimit
  );

  const url =
    `https://api.kraken.com/0/public/OHLC` +
    `?pair=${encodeURIComponent(krakenPair)}` +
    `&interval=${safeInterval}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Kraken HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.error && data.error.length) {
    throw new Error(data.error.join(", "));
  }

  if (!data.result) {
    throw new Error("Kraken returned no result");
  }

  const resultKeys = Object.keys(data.result).filter(
    key => key !== "last"
  );

  if (!resultKeys.length) {
    throw new Error(`لم يتم العثور على زوج Kraken: ${krakenPair}`);
  }

  const rows = data.result[resultKeys[0]];

  if (!Array.isArray(rows) || rows.length < 50) {
    throw new Error("بيانات الشموع غير كافية");
  }

  const candles = rows.slice(-safeLimit).map(row => ({
    time: Number(row[0]) * 1000,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    vwap: Number(row[5]),
    volume: Number(row[6]),
    count: Number(row[7])
  }));

  return {
    pair,
    krakenPair,
    interval: safeInterval,
    candles
  };
}

// ------------------------------------------------------------
// EMA
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// RSI
// ------------------------------------------------------------
function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain =
      ((avgGain * (period - 1)) + gain) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

// ------------------------------------------------------------
// MACD
// ------------------------------------------------------------
function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);

  if (fast === null || slow === null) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macdSeries = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const fastValue = ema(slice, 12);
    const slowValue = ema(slice, 26);

    if (fastValue !== null && slowValue !== null) {
      macdSeries.push(fastValue - slowValue);
    }
  }

  const macdValue = macdSeries.at(-1);

  const signal =
    macdSeries.length >= 9
      ? ema(macdSeries, 9)
      : null;

  return {
    macd: macdValue,
    signal,
    histogram:
      signal !== null
        ? macdValue - signal
        : null
  };
}

// ------------------------------------------------------------
// ATR
// ------------------------------------------------------------
function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const value = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    tr.push(value);
  }

  if (tr.length < period) return null;

  let result =
    tr.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < tr.length; i++) {
    result =
      ((result * (period - 1)) + tr[i]) / period;
  }

  return result;
}

// ------------------------------------------------------------
// Volume ratio
// ------------------------------------------------------------
function volumeRatio(candles, period = 20) {
  if (candles.length < period + 1) return null;

  const recent = candles.slice(-period);

  const average =
    recent.reduce((sum, c) => sum + c.volume, 0) /
    recent.length;

  const current = candles.at(-1).volume;

  if (average === 0) return 0;

  return current / average;
}

// ------------------------------------------------------------
// Indicators
// ------------------------------------------------------------
function calculateIndicators(candles) {
  const closes = candles.map(c => c.close);

  const current = closes.at(-1);

  const rsi14 = rsi(closes, 14);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);

  const macdData = macd(closes);

  const atr14 = atr(candles, 14);

  const volume = volumeRatio(candles, 20);

  return {
    rsi14,
    ema20,
    ema50,
    macd: macdData.macd,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    atr14,
    volumeRatio: volume,
    price: current
  };
}

// ------------------------------------------------------------
// Strategy
// ------------------------------------------------------------
function analyzeMarket(candles) {
  const ind = calculateIndicators(candles);

  let buyScore = 0;
  let sellScore = 0;

  const bullishTrend =
    ind.price > ind.ema20 &&
    ind.ema20 > ind.ema50;

  const bearishTrend =
    ind.price < ind.ema20 &&
    ind.ema20 < ind.ema50;

  const bullishMomentum =
    ind.macdHistogram !== null &&
    ind.macdHistogram > 0;

  const bearishMomentum =
    ind.macdHistogram !== null &&
    ind.macdHistogram < 0;

  // RSI
  if (ind.rsi14 !== null) {
    if (ind.rsi14 >= 50 && ind.rsi14 < 70) {
      buyScore++;
    }

    if (ind.rsi14 <= 50 && ind.rsi14 > 30) {
      sellScore++;
    }
  }

  // Trend
  if (bullishTrend) buyScore++;
  if (bearishTrend) sellScore++;

  // MACD
  if (bullishMomentum) buyScore++;
  if (bearishMomentum) sellScore++;

  // Price position
  if (ind.price > ind.ema20) buyScore++;
  if (ind.price < ind.ema20) sellScore++;

  let signal = "HOLD";

  if (buyScore >= 4 && buyScore > sellScore) {
    signal = "BUY";
  } else if (
    sellScore >= 4 &&
    sellScore > buyScore
  ) {
    signal = "SELL";
  }

  const strongest = Math.max(
    buyScore,
    sellScore
  );

  let confidence = Math.round(
    (strongest / 4) * 100
  );

  confidence = Math.min(
    Math.max(confidence, 0),
    100
  );

  let risk = "MEDIUM";

  if (
    ind.rsi14 >= 75 ||
    ind.rsi14 <= 25
  ) {
    risk = "HIGH";
  }

  if (
    ind.atr14 !== null &&
    ind.price !== 0 &&
    ind.atr14 / ind.price > 0.02
  ) {
    risk = "HIGH";
  }

  if (
    ind.rsi14 > 45 &&
    ind.rsi14 < 65 &&
    ind.atr14 / ind.price < 0.015
  ) {
    risk = "LOW";
  }

  return {
    indicators: ind,

    filters: {
      bullishTrend,
      bearishTrend,
      bullishMomentum,
      bearishMomentum,
      volumeRatio: ind.volumeRatio
    },

    analysis: {
      signal,
      confidence,
      buyScore,
      sellScore,
      risk
    }
  };
}

// ------------------------------------------------------------
// Risk management
// ------------------------------------------------------------
function calculateRisk(price, atrValue, signal) {
  if (
    signal !== "BUY" &&
    signal !== "SELL"
  ) {
    return {
      enabled: true,
      action: "NO_TRADE",
      entry: price,
      stopLoss: null,
      takeProfit: null,
      riskDistance: null,
      riskAmount: null,
      positionSize: null,
      positionNotional: null,
      riskPerTradePercent:
        CONFIG.riskPercent,
      accountBalance:
        CONFIG.accountBalance,
      riskReward:
        `1:${CONFIG.riskReward}`
    };
  }

  if (!atrValue || atrValue <= 0) {
    return {
      enabled: true,
      action: "NO_TRADE",
      reason: "ATR unavailable"
    };
  }

  const riskAmount =
    CONFIG.accountBalance *
    (CONFIG.riskPercent / 100);

  // 1.5 ATR stop
  const riskDistance = atrValue * 1.5;

  let stopLoss;
  let takeProfit;

  if (signal === "BUY") {
    stopLoss = price - riskDistance;

    takeProfit =
      price +
      riskDistance *
        CONFIG.riskReward;
  } else {
    stopLoss = price + riskDistance;

    takeProfit =
      price -
      riskDistance *
        CONFIG.riskReward;
  }

  const positionSize =
    riskAmount / riskDistance;

  const positionNotional =
    positionSize * price;

  return {
    enabled: true,
    action: "TRADE_SETUP",
    entry: Number(price.toFixed(2)),
    stopLoss: Number(stopLoss.toFixed(2)),
    takeProfit: Number(takeProfit.toFixed(2)),
    riskDistance:
      Number(riskDistance.toFixed(2)),
    riskAmount:
      Number(riskAmount.toFixed(2)),
    positionSize:
      Number(positionSize.toFixed(8)),
    positionNotional:
      Number(positionNotional.toFixed(2)),
    riskPerTradePercent:
      CONFIG.riskPercent,
    accountBalance:
      CONFIG.accountBalance,
    riskReward:
      `1:${CONFIG.riskReward}`
  };
}

// ------------------------------------------------------------
// Full analysis
// ------------------------------------------------------------
async function fullAnalysis(
  pair,
  interval,
  limit = 720
) {
  const market =
    await krakenOHLC(
      pair,
      interval,
      limit
    );

  const result =
    analyzeMarket(
      market.candles
    );

  const risk =
    result.analysis.confidence >=
      CONFIG.minimumConfidence
      ? calculateRisk(
          result.indicators.price,
          result.indicators.atr14,
          result.analysis.signal
        )
      : {
          enabled: true,
          action: "NO_TRADE",
          reason:
            "Confidence below minimum",
          entry:
            result.indicators.price,
          stopLoss: null,
          takeProfit: null,
          riskDistance: null,
          riskAmount: null,
          positionSize: null,
          positionNotional: null,
          riskPerTradePercent:
            CONFIG.riskPercent,
          accountBalance:
            CONFIG.accountBalance,
          riskReward:
            `1:${CONFIG.riskReward}`
        };

  return {
    success: true,
    project: PROJECT,
    version: VERSION,
    pair,
    krakenPair:
      market.krakenPair,
    interval:
      Number(interval),
    source: "Kraken",

    market: {
      price:
        result.indicators.price,
      candles:
        market.candles.length
    },

    indicators: result.indicators,

    filters: result.filters,

    analysis: result.analysis,

    riskManagement: risk,

    timestamp:
      new Date().toISOString()
  };
}

// ------------------------------------------------------------
// Backtest
// ------------------------------------------------------------
async function backtest(
  pair,
  interval,
  limit = 720
) {
  const market =
    await krakenOHLC(
      pair,
      interval,
      limit
    );

  const candles =
    market.candles;

  const trades = [];

  let equity =
    CONFIG.accountBalance;

  const startingEquity =
    equity;

  let peakEquity =
    equity;

  let maxDrawdown = 0;

  let lastTradeIndex =
    -999;

  for (
    let i = 100;
    i < candles.length - 1;
    i++
  ) {
    if (
      i - lastTradeIndex <
      CONFIG.cooldownCandles
    ) {
      continue;
    }

    const history =
      candles.slice(0, i + 1);

    const analysis =
      analyzeMarket(history);

    const signal =
      analysis.analysis.signal;

    const confidence =
      analysis.analysis.confidence;

    if (
      signal !== "BUY" &&
      signal !== "SELL"
    ) {
      continue;
    }

    if (
      confidence <
      CONFIG.minimumConfidence
    ) {
      continue;
    }

    const entry =
      candles[i].close;

    const atrValue =
      analysis.indicators.atr14;

    if (!atrValue) continue;

    const riskDistance =
      atrValue * 1.5;

    const riskAmount =
      equity *
      (CONFIG.riskPercent / 100);

    const positionSize =
      riskAmount / riskDistance;

    let stopLoss;
    let takeProfit;

    if (signal === "BUY") {
      stopLoss =
        entry - riskDistance;

      takeProfit =
        entry +
        riskDistance *
          CONFIG.riskReward;
    } else {
      stopLoss =
        entry + riskDistance;

      takeProfit =
        entry -
        riskDistance *
          CONFIG.riskReward;
    }

    let exit =
      entry;

    let outcome =
      "LOSS";

    let reason =
      "TIME_EXIT";

    let exitIndex =
      Math.min(
        i +
          CONFIG.maxHoldingCandles,
        candles.length - 1
      );

    for (
      let j = i + 1;
      j <= exitIndex;
      j++
    ) {
      const candle =
        candles[j];

      if (signal === "BUY") {
        if (
          candle.low <=
          stopLoss
        ) {
          exit =
            stopLoss;
          outcome =
            "LOSS";
          reason =
            "STOP_LOSS";
          exitIndex = j;
          break;
        }

        if (
          candle.high >=
          takeProfit
        ) {
          exit =
            takeProfit;
          outcome =
            "WIN";
          reason =
            "TAKE_PROFIT";
          exitIndex = j;
          break;
        }
      } else {
        if (
          candle.high >=
          stopLoss
        ) {
          exit =
            stopLoss;
          outcome =
            "LOSS";
          reason =
            "STOP_LOSS";
          exitIndex = j;
          break;
        }

        if (
          candle.low <=
          takeProfit
        ) {
          exit =
            takeProfit;
          outcome =
            "WIN";
          reason =
            "TAKE_PROFIT";
          exitIndex = j;
          break;
        }
      }
    }

    if (
      reason === "TIME_EXIT"
    ) {
      exit =
        candles[exitIndex].close;
    }

    let priceReturn;

    if (signal === "BUY") {
      priceReturn =
        (exit - entry) /
        riskDistance;
    } else {
      priceReturn =
        (entry - exit) /
        riskDistance;
    }

    const grossReturn =
      priceReturn;

    const fees =
      CONFIG.feePercent /
      100;

    const slippage =
      CONFIG.slippagePercent /
      100;

    const netReturn =
      grossReturn -
      fees -
      slippage;

    const pnl =
      riskAmount *
      netReturn;

    equity += pnl;

    if (equity > peakEquity) {
      peakEquity =
        equity;
    }

    const drawdown =
      ((peakEquity -
        equity) /
        peakEquity) *
      100;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );

    trades.push({
      entryTime:
        new Date(
          candles[i].time
        ).toISOString(),

      exitTime:
        new Date(
          candles[exitIndex].time
        ).toISOString(),

      signal,
      confidence,

      entry:
        Number(entry.toFixed(2)),

      exit:
        Number(exit.toFixed(2)),

      stopLoss:
        Number(
          stopLoss.toFixed(2)
        ),

      takeProfit:
        Number(
          takeProfit.toFixed(2)
        ),

      riskAmount:
        Number(
          riskAmount.toFixed(4)
        ),

      positionSize:
        Number(
          positionSize.toFixed(8)
        ),

      outcome,
      reason,

      grossReturn:
        Number(
          grossReturn.toFixed(4)
        ),

      netReturn:
        Number(
          netReturn.toFixed(4)
        ),

      pnl:
        Number(
          pnl.toFixed(4)
        )
    });

    lastTradeIndex =
      exitIndex;

    i =
      exitIndex;
  }

  const wins =
    trades.filter(
      t => t.outcome === "WIN"
    ).length;

  const losses =
    trades.filter(
      t => t.outcome === "LOSS"
    ).length;

  const winRate =
    trades.length
      ? (wins /
          trades.length) *
        100
      : 0;

  const grossProfit =
    trades
      .filter(t => t.pnl > 0)
      .reduce(
        (sum, t) =>
          sum + t.pnl,
        0
      );

  const grossLoss =
    Math.abs(
      trades
        .filter(t => t.pnl < 0)
        .reduce(
          (sum, t) =>
            sum + t.pnl,
          0
        )
    );

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : null;

  const netReturn =
    ((equity -
      startingEquity) /
      startingEquity) *
    100;

  return {
    success: true,
    project: PROJECT,
    version: VERSION,

    pair,
    krakenPair:
      market.krakenPair,
    interval:
      Number(interval),

    source: "Kraken",

    configuration: {
      feePercent:
        CONFIG.feePercent,

      slippagePercent:
        CONFIG.slippagePercent,

      accountBalance:
        CONFIG.accountBalance,

      riskPercent:
        CONFIG.riskPercent,

      minimumConfidence:
        CONFIG.minimumConfidence,

      riskReward:
        `1:${CONFIG.riskReward}`,

      maxHoldingCandles:
        CONFIG.maxHoldingCandles,

      cooldownCandles:
        CONFIG.cooldownCandles
    },

    backtest: {
      candlesTested:
        candles.length,

      trades:
        trades.length,

      wins,
      losses,

      winRate:
        Number(
          winRate.toFixed(2)
        ),

      profitFactor:
        profitFactor === null
          ? null
          : Number(
              profitFactor.toFixed(3)
            ),

      netReturn:
        Number(
          netReturn.toFixed(3)
        ),

      startingEquity:
        Number(
          startingEquity.toFixed(3)
        ),

      endingEquity:
        Number(
          equity.toFixed(3)
        ),

      maxDrawdown:
        Number(
          maxDrawdown.toFixed(3)
        )
    },

    note:
      "Historical simulation only. No real orders are executed. Fees and slippage are included. Past performance does not guarantee future results.",

    recentTrades:
      trades.slice(-25),

    timestamp:
      new Date().toISOString()
  };
}

// ------------------------------------------------------------
// Main Worker
// ------------------------------------------------------------
export default {
  async fetch(request) {
    try {
      const url =
        new URL(request.url);

      const path =
        url.pathname;

      // IMPORTANT:
      // Always read query parameters separately.
      // This prevents errors such as:
      // XBTUSDINTERVAL60
      const pair =
        url.searchParams.get(
          "pair"
        ) || "XBTUSD";

      const interval =
        Number(
          url.searchParams.get(
            "interval"
          ) || 60
        );

      const limit =
        Number(
          url.searchParams.get(
            "limit"
          ) ||
            CONFIG.defaultLimit
        );

      // ------------------------------------------------------
      // /
      // ------------------------------------------------------
      if (
        path === "/" ||
        path === ""
      ) {
        return json({
          name: PROJECT,
          version: VERSION,
          status: "online",
          marketData: "Kraken",
          realTrading: false,

          message:
            "AI Trader Pro API is running",

          endpoints: [
            "/",
            "/api/status",
            "/api/pair?pair=XBTUSD",
            "/api/analyze?pair=XBTUSD&interval=60",
            "/api/analyze?pair=XBTUSD&interval=240",
            "/api/analyze?pair=ETHUSD&interval=60",
            "/api/analyze?pair=ETHUSD&interval=240",
            "/api/backtest?pair=XBTUSD&interval=60&limit=720",
            "/api/backtest?pair=XBTUSD&interval=240&limit=720"
          ]
        });
      }

      // ------------------------------------------------------
      // STATUS
      // ------------------------------------------------------
      if (
        path ===
        "/api/status"
      ) {
        return json({
          project: PROJECT,
          version: VERSION,
          status: "online",
          marketData: "Kraken",
          realTrading: false,
          riskManagement: true,
          backtest: true,
          timestamp:
            new Date().toISOString()
        });
      }

      // ------------------------------------------------------
      // PAIR
      // ------------------------------------------------------
      if (
        path ===
        "/api/pair"
      ) {
        const market =
          await krakenOHLC(
            pair,
            interval,
            200
          );

        const candles =
          market.candles;

        const last =
          candles.at(-1);

        return json({
          success: true,
          project: PROJECT,
          version: VERSION,
          pair,
          krakenPair:
            market.krakenPair,

          interval,

          price:
            last.close,

          candles:
            candles.length,

          timestamp:
            new Date().toISOString()
        });
      }

      // ------------------------------------------------------
      // ANALYZE
      // ------------------------------------------------------
      if (
        path ===
        "/api/analyze"
      ) {
        return json(
          await fullAnalysis(
            pair,
            interval,
            limit
          )
        );
      }

      // ------------------------------------------------------
      // BACKTEST
      // ------------------------------------------------------
      if (
        path ===
        "/api/backtest"
      ) {
        return json(
          await backtest(
            pair,
            interval,
            limit
          )
        );
      }

      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------
      return json(
        {
          success: false,
          error:
            "Endpoint not found",
          path,
          availableEndpoints: [
            "/",
            "/api/status",
            "/api/pair?pair=XBTUSD",
            "/api/analyze?pair=XBTUSD&interval=60",
            "/api/backtest?pair=XBTUSD&interval=60&limit=720"
          ]
        },
        404
      );

    } catch (error) {
      return json(
        {
          success: false,
          project: PROJECT,
          version: VERSION,
          error:
            "خطأ في AI Trader Pro",
          details:
            error?.message ||
            String(error),

          timestamp:
            new Date().toISOString()
        },
        500
      );
    }
  }
};
