/*
========================================================
 AI TRADER PRO
 Full Organized Worker
 Market: Kraken
 Trading: DISABLED
========================================================
*/

const CONFIG = {
  version: "V4.0",

  accountBalance: 100,

  riskPerTradePercent: 1,

  feePercent: 0.1,
  slippagePercent: 0.05,

  riskReward: 2,

  minimumConfidence: 75,

  maxHoldingCandles: 12,

  cooldownCandles: 2,

  maxCandles: 720,

  minimumCandles: 100
};

const ALLOWED_INTERVALS = [60, 240];


/*
========================================================
 SYMBOLS
========================================================
*/

const SYMBOLS = {
  XBTUSD: {
    base: ["XBT", "BTC"],
    quote: ["USD"]
  },

  BTCUSD: {
    base: ["XBT", "BTC"],
    quote: ["USD"]
  },

  ETHUSD: {
    base: ["ETH"],
    quote: ["USD"]
  }
};


/*
========================================================
 HELPERS
========================================================
*/

function round(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}


function normalize(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}


/*
========================================================
 EMA
========================================================
*/

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);

  let result =
    values
      .slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      ((values[i] - result) * multiplier) + result;
  }

  return result;
}


/*
========================================================
 RSI
========================================================
*/

function rsi(values, period = 14) {
  if (values.length <= period) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change =
      values[i] - values[i - 1];

    if (change > 0) {
      gains += change;
    }

    if (change < 0) {
      losses += Math.abs(change);
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {
    const change =
      values[i] - values[i - 1];

    const gain =
      change > 0 ? change : 0;

    const loss =
      change < 0 ? Math.abs(change) : 0;

    avgGain =
      ((avgGain * (period - 1)) + gain) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + loss) /
      period;
  }

  if (avgLoss === 0) {
    return 100;
  }

  const rs =
    avgGain / avgLoss;

  return 100 - (100 / (1 + rs));
}


/*
========================================================
 MACD
========================================================
*/

function macd(values) {
  if (values.length < 50) {
    return null;
  }

  const macdLines = [];

  for (
    let i = 26;
    i <= values.length;
    i++
  ) {
    const slice =
      values.slice(0, i);

    const e12 =
      ema(slice, 12);

    const e26 =
      ema(slice, 26);

    if (
      e12 !== null &&
      e26 !== null
    ) {
      macdLines.push(
        e12 - e26
      );
    }
  }

  if (macdLines.length < 9) {
    return null;
  }

  const line =
    macdLines[macdLines.length - 1];

  const signal =
    ema(macdLines, 9);

  if (signal === null) {
    return null;
  }

  return {
    line,
    signal,
    histogram:
      line - signal
  };
}


/*
========================================================
 ATR
========================================================
*/

function atr(candles, period = 14) {
  if (candles.length <= period) {
    return null;
  }

  const ranges = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const current =
      candles[i];

    const previous =
      candles[i - 1];

    const trueRange =
      Math.max(
        current.high - current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )
      );

    ranges.push(trueRange);
  }

  if (ranges.length < period) {
    return null;
  }

  let result =
    ranges
      .slice(0, period)
      .reduce((a, b) => a + b, 0) /
    period;

  for (
    let i = period;
    i < ranges.length;
    i++
  ) {
    result =
      (
        (result * (period - 1)) +
        ranges[i]
      ) / period;
  }

  return result;
}


/*
========================================================
 VOLUME FILTER
========================================================
*/

function volumeRatio(candles, period = 20) {
  if (candles.length <= period) {
    return null;
  }

  const recent =
    candles[candles.length - 1].volume;

  const previous =
    candles
      .slice(-period - 1, -1)
      .map(c => c.volume);

  const average =
    previous.reduce(
      (a, b) => a + b,
      0
    ) / previous.length;

  if (!average) {
    return null;
  }

  return recent / average;
}


/*
========================================================
 KRAKEN PAIR RESOLUTION
========================================================
*/

async function resolveKrakenPair(requestedPair) {
  const requested =
    normalize(requestedPair || "XBTUSD");

  const response =
    await fetch(
      "https://api.kraken.com/0/public/AssetPairs",
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Kraken AssetPairs HTTP ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Kraken AssetPairs invalid JSON"
    );
  }

  if (
    data.error &&
    data.error.length
  ) {
    throw new Error(
      data.error.join(", ")
    );
  }

  const result =
    data.result || {};

  const definition =
    SYMBOLS[requested];

  /*
    First: exact Kraken names.
  */

  for (
    const [key, info]
    of Object.entries(result)
  ) {
    const names = [
      key,
      info.altname,
      info.wsname
    ]
      .filter(Boolean)
      .map(normalize);

    if (
      names.includes(requested)
    ) {
      return {
        requested,
        krakenPair: key,
        info
      };
    }
  }

  /*
    Second: semantic matching.
  */

  if (definition) {
    for (
      const [key, info]
      of Object.entries(result)
    ) {
      const base =
        normalize(
          info.base ||
          info.base_altname ||
          ""
        );

      const quote =
        normalize(
          info.quote ||
          info.quote_altname ||
          ""
        );

      const baseOK =
        definition.base
          .map(normalize)
          .includes(base);

      const quoteOK =
        definition.quote
          .map(normalize)
          .includes(quote);

      if (
        baseOK &&
        quoteOK
      ) {
        return {
          requested,
          krakenPair: key,
          info
        };
      }
    }
  }

  throw new Error(
    `Kraken pair not found: ${requested}`
  );
}


/*
========================================================
 MARKET DATA
========================================================
*/

async function getCandles(
  pair,
  interval,
  limit = CONFIG.maxCandles
) {
  const resolved =
    await resolveKrakenPair(pair);

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 200,
        CONFIG.minimumCandles
      ),
      CONFIG.maxCandles
    );

  const url =
    "https://api.kraken.com/0/public/OHLC" +
    `?pair=${encodeURIComponent(
      resolved.krakenPair
    )}` +
    `&interval=${interval}`;

  const response =
    await fetch(
      url,
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Kraken OHLC HTTP ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Kraken OHLC invalid JSON"
    );
  }

  if (
    data.error &&
    data.error.length
  ) {
    throw new Error(
      data.error.join(", ")
    );
  }

  const result =
    data.result || {};

  const key =
    Object.keys(result)
      .find(
        k => k !== "last"
      );

  if (!key) {
    throw new Error(
      "Kraken returned no OHLC data"
    );
  }

  const candles =
    result[key]
      .slice(-safeLimit)
      .map(c => ({
        time: Number(c[0]),
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        vwap: Number(c[5]),
        volume: Number(c[6]),
        trades: Number(c[7])
      }))
      .filter(
        c =>
          Number.isFinite(c.close) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.volume)
      );

  if (
    candles.length <
    CONFIG.minimumCandles
  ) {
    throw new Error(
      `Not enough candles: ${candles.length}`
    );
  }

  return {
    candles,
    requestedPair:
      resolved.requested,
    resolvedPair:
      resolved.krakenPair
  };
}


/*
========================================================
 SIGNAL ANALYSIS
========================================================
*/

function analyze(candles) {
  if (
    candles.length <
    CONFIG.minimumCandles
  ) {
    return null;
  }

  const closes =
    candles.map(
      c => c.close
    );

  const price =
    closes[closes.length - 1];

  const ema20 =
    ema(closes, 20);

  const ema50 =
    ema(closes, 50);

  const rsi14 =
    rsi(closes, 14);

  const macdData =
    macd(closes);

  const atr14 =
    atr(candles, 14);

  const volRatio =
    volumeRatio(candles, 20);

  if (
    ema20 === null ||
    ema50 === null ||
    rsi14 === null ||
    macdData === null ||
    atr14 === null
  ) {
    return null;
  }

  /*
    Trend
  */

  const bullishTrend =
    price > ema20 &&
    ema20 > ema50;

  const bearishTrend =
    price < ema20 &&
    ema20 < ema50;

  /*
    Momentum
  */

  const bullishMomentum =
    macdData.histogram > 0 &&
    rsi14 > 50 &&
    rsi14 < 70;

  const bearishMomentum =
    macdData.histogram < 0 &&
    rsi14 < 50 &&
    rsi14 > 30;

  /*
    RSI extreme protection
  */

  const overbought =
    rsi14 >= 70;

  const oversold =
    rsi14 <= 30;

  /*
    Volume confirmation
  */

  const volumeConfirmed =
    volRatio === null ||
    volRatio >= 0.8;

  /*
    Scoring
  */

  let buyScore = 0;
  let sellScore = 0;

  if (price > ema20) {
    buyScore++;
  }

  if (ema20 > ema50) {
    buyScore++;
  }

  if (
    rsi14 > 50 &&
    rsi14 < 70
  ) {
    buyScore++;
  }

  if (
    macdData.histogram > 0
  ) {
    buyScore++;
  }

  if (price < ema20) {
    sellScore++;
  }

  if (ema20 < ema50) {
    sellScore++;
  }

  if (
    rsi14 < 50 &&
    rsi14 > 30
  ) {
    sellScore++;
  }

  if (
    macdData.histogram < 0
  ) {
    sellScore++;
  }

  /*
    Final signal.
    Avoid buying overbought.
    Avoid selling oversold.
  */

  let signal = "HOLD";

  if (
    bullishTrend &&
    bullishMomentum &&
    volumeConfirmed &&
    !overbought &&
    buyScore >= 3
  ) {
    signal = "BUY";
  }

  if (
    bearishTrend &&
    bearishMomentum &&
    volumeConfirmed &&
    !oversold &&
    sellScore >= 3
  ) {
    signal = "SELL";
  }

  /*
    Confidence is based on
    trend + momentum + volume.
  */

  let confidence = 0;

  if (
    bullishTrend ||
    bearishTrend
  ) {
    confidence += 30;
  }

  if (
    bullishMomentum ||
    bearishMomentum
  ) {
    confidence += 30;
  }

  if (volumeConfirmed) {
    confidence += 15;
  }

  if (
    signal === "BUY" ||
    signal === "SELL"
  ) {
    confidence += 25;
  }

  /*
    Risk
  */

  let risk = "LOW";

  if (
    overbought ||
    oversold
  ) {
    risk = "HIGH";
  } else if (
    confidence < 85
  ) {
    risk = "MEDIUM";
  }

  /*
    Risk management only
    when a valid trade exists.
  */

  let stopLoss = null;
  let takeProfit = null;

  if (
    signal === "BUY" &&
    confidence >=
      CONFIG.minimumConfidence
  ) {
    stopLoss =
      price -
      atr14 * 1.5;

    const distance =
      price - stopLoss;

    takeProfit =
      price +
      distance *
      CONFIG.riskReward;
  }

  if (
    signal === "SELL" &&
    confidence >=
      CONFIG.minimumConfidence
  ) {
    stopLoss =
      price +
      atr14 * 1.5;

    const distance =
      stopLoss - price;

    takeProfit =
      price -
      distance *
      CONFIG.riskReward;
  }

  return {
    price,

    ema20,
    ema50,

    rsi14,

    macd:
      macdData.line,

    macdSignal:
      macdData.signal,

    macdHistogram:
      macdData.histogram,

    atr14,

    volumeRatio:
      volRatio,

    bullishTrend,
    bearishTrend,

    bullishMomentum,
    bearishMomentum,

    signal,
    confidence,

    buyScore,
    sellScore,

    risk,

    stopLoss,
    takeProfit
  };
}


/*
========================================================
 RISK MANAGEMENT
========================================================
*/

function calculateRiskManagement(setup) {
  if (
    !setup ||
    !setup.stopLoss ||
    !setup.takeProfit
  ) {
    return {
      enabled: true,
      action: "NO_TRADE",
      entry: round(setup?.price),
      stopLoss: null,
      takeProfit: null,
      riskDistance: null,
      riskAmount: null,
      positionSize: null,
      positionNotional: null,
      riskPerTradePercent:
        CONFIG.riskPerTradePercent,
      accountBalance:
        CONFIG.accountBalance,
      riskReward:
        `1:${CONFIG.riskReward}`
    };
  }

  const riskAmount =
    CONFIG.accountBalance *
    (CONFIG.riskPerTradePercent / 100);

  const riskDistance =
    Math.abs(
      setup.price -
      setup.stopLoss
    );

  if (
    riskDistance <= 0
  ) {
    return {
      enabled: true,
      action: "NO_TRADE"
    };
  }

  const positionSize =
    riskAmount /
    riskDistance;

  const positionNotional =
    positionSize *
    setup.price;

  return {
    enabled: true,

    action: "PAPER_TRADE_ONLY",

    entry:
      round(setup.price),

    stopLoss:
      round(setup.stopLoss),

    takeProfit:
      round(setup.takeProfit),

    riskDistance:
      round(riskDistance),

    riskAmount:
      round(riskAmount, 4),

    positionSize:
      round(positionSize, 8),

    positionNotional:
      round(positionNotional, 4),

    riskPerTradePercent:
      CONFIG.riskPerTradePercent,

    accountBalance:
      CONFIG.accountBalance,

    riskReward:
      `1:${CONFIG.riskReward}`
  };
}


/*
========================================================
 TRADE EVALUATION
========================================================
*/

function evaluateTrade(
  setup,
  candles,
  entryIndex
) {
  const start =
    entryIndex + 1;

  const end =
    Math.min(
      candles.length - 1,
      entryIndex +
      CONFIG.maxHoldingCandles
    );

  for (
    let i = start;
    i <= end;
    i++
  ) {
    const candle =
      candles[i];

    if (
      setup.signal === "BUY"
    ) {
      const stopHit =
        candle.low <=
        setup.stopLoss;

      const targetHit =
        candle.high >=
        setup.takeProfit;

      /*
        Conservative rule:
        if both happen inside
        same candle -> LOSS.
      */

      if (
        stopHit &&
        targetHit
      ) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_AND_TARGET_SAME_CANDLE",
          grossReturn: -1
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_LOSS",
          grossReturn: -1
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          exitPrice:
            setup.takeProfit,
          exitIndex: i,
          reason:
            "TAKE_PROFIT",
          grossReturn:
            CONFIG.riskReward
        };
      }
    }

    if (
      setup.signal === "SELL"
    ) {
      const stopHit =
        candle.high >=
        setup.stopLoss;

      const targetHit =
        candle.low <=
        setup.takeProfit;

      if (
        stopHit &&
        targetHit
      ) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_AND_TARGET_SAME_CANDLE",
          grossReturn: -1
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_LOSS",
          grossReturn: -1
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          exitPrice:
            setup.takeProfit,
          exitIndex: i,
          reason:
            "TAKE_PROFIT",
          grossReturn:
            CONFIG.riskReward
        };
      }
    }
  }

  const exitIndex =
    end;

  const exitPrice =
    candles[exitIndex].close;

  let grossReturn = 0;

  if (
    setup.signal === "BUY"
  ) {
    grossReturn =
      (
        (exitPrice -
          setup.price) /
        setup.price
      ) * 100;
  }

  if (
    setup.signal === "SELL"
  ) {
    grossReturn =
      (
        (setup.price -
          exitPrice) /
        setup.price
      ) * 100;
  }

  return {
    outcome:
      grossReturn > 0
        ? "WIN"
        : "LOSS",

    exitPrice,

    exitIndex,

    reason:
      "TIME_EXIT",

    grossReturn
  };
}


/*
========================================================
 BACKTEST
========================================================
*/

async function runBacktest(
  pair,
  interval,
  limit
) {
  const market =
    await getCandles(
      pair,
      interval,
      limit
    );

  const candles =
    market.candles;

  let equity =
    CONFIG.accountBalance;

  let peakEquity =
    equity;

  let maxDrawdown = 0;

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  const trades = [];

  let nextAvailable =
    CONFIG.minimumCandles;

  for (
    let i =
      CONFIG.minimumCandles;
    i <
      candles.length - 1;
    i++
  ) {
    if (
      i <
      nextAvailable
    ) {
      continue;
    }

    const history =
      candles.slice(
        0,
        i + 1
      );

    const setup =
      analyze(history);

    if (!setup) {
      continue;
    }

    /*
      Only trade when signal
      passes confidence filter.
    */

    if (
      setup.signal !== "BUY" &&
      setup.signal !== "SELL"
    ) {
      continue;
    }

    if (
      setup.confidence <
      CONFIG.minimumConfidence
    ) {
      continue;
    }

    const risk =
      calculateRiskManagement(
        setup
      );

    if (
      risk.action !==
      "PAPER_TRADE_ONLY"
    ) {
      continue;
    }

    const result =
      evaluateTrade(
        setup,
        candles,
        i
      );

    if (!result) {
      continue;
    }

    const fees =
      CONFIG.feePercent * 2;

    const slippage =
      CONFIG.slippagePercent * 2;

    const netReturn =
      result.grossReturn -
      fees -
      slippage;

    if (
      netReturn > 0
    ) {
      wins++;
      grossProfit +=
        netReturn;
    } else {
      losses++;
      grossLoss +=
        Math.abs(netReturn);
    }

    /*
      Apply return to equity.
    */

    equity =
      equity *
      (
        1 +
        netReturn / 100
      );

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      (
        (peakEquity -
          equity) /
        peakEquity
      ) * 100;

    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );

    trades.push({
      entryTime:
        new Date(
          candles[i].time * 1000
        ).toISOString(),

      exitTime:
        new Date(
          candles[result.exitIndex]
            .time * 1000
        ).toISOString(),

      signal:
        setup.signal,

      confidence:
        setup.confidence,

      entry:
        round(setup.price, 2),

      exit:
        round(result.exitPrice, 2),

      stopLoss:
        round(setup.stopLoss, 2),

      takeProfit:
        round(setup.takeProfit, 2),

      riskAmount:
        risk.riskAmount,

      positionSize:
        risk.positionSize,

      outcome:
        netReturn > 0
          ? "WIN"
          : "LOSS",

      reason:
        result.reason,

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
      Prevent overlapping trades.
    */

    nextAvailable =
      result.exitIndex +
      CONFIG.cooldownCandles +
      1;
  }

  const totalTrades =
    wins + losses;

  const winRate =
    totalTrades > 0
      ? (wins /
          totalTrades) *
        100
      : 0;

  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : null;

  return {
    success: true,

    project:
      "AI Trader Pro",

    version:
      CONFIG.version,

    pair:
      market.requestedPair,

    krakenPair:
      market.resolvedPair,

    interval:
      `${interval}m`,

    source:
      "Kraken",

    configuration: {
      feePercent:
        CONFIG.feePercent,

      slippagePercent:
        CONFIG.slippagePercent,

      accountBalance:
        CONFIG.accountBalance,

      riskPerTradePercent:
        CONFIG.riskPerTradePercent,

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
        totalTrades,

      wins,

      losses,

      winRate:
        round(winRate, 2),

      profitFactor:
        round(
          profitFactor,
          3
        ),

      netReturn:
        round(
          equity -
          CONFIG.accountBalance,
          3
        ),

      startingEquity:
        CONFIG.accountBalance,

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
      "Historical simulation only. No real orders are executed. Fees and slippage are included. Past performance does not guarantee future results.",

    recentTrades:
      trades.slice(-20),

    timestamp:
      new Date().toISOString()
  };
}


/*
========================================================
 API: HOME
========================================================
*/

async function home() {
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


/*
========================================================
 API: STATUS
========================================================
*/

async function status() {
  return json({
    project:
      "AI Trader Pro",

    version:
      CONFIG.version,

    status:
      "online",

    marketData:
      "Kraken",

    realTrading:
      false,

    indicators: [
      "RSI14",
      "EMA20",
      "EMA50",
      "MACD",
      "ATR14"
    ],

    filters: [
      "Trend",
      "Momentum",
      "RSI protection",
      "Volume confirmation",
      "Confidence"
    ],

    strategy:
      "Trend + Momentum + Volume confirmation",

    riskManagement: {
      enabled: true,

      riskPerTradePercent:
        CONFIG.riskPerTradePercent,

      accountBalance:
        CONFIG.accountBalance,

      riskReward:
        `1:${CONFIG.riskReward}`
    },

    backtest:
      "Non-overlapping multi-candle historical simulation",

    timestamp:
      new Date().toISOString()
  });
}


/*
========================================================
 API: PAIR
========================================================
*/

async function pairEndpoint(url) {
  const pair =
    (
      url.searchParams.get("pair") ||
      "XBTUSD"
    ).toUpperCase();

  try {
    const resolved =
      await resolveKrakenPair(
        pair
      );

    return json({
      success: true,

      requestedPair:
        pair,

      krakenPair:
        resolved.krakenPair,

      wsname:
        resolved.info.wsname ||
        null,

      altname:
        resolved.info.altname ||
        null,

      source:
        "Kraken AssetPairs",

      timestamp:
        new Date().toISOString()
    });

  } catch (error) {
    return json(
      {
        success: false,

        error:
          "Kraken pair resolution error",

        details:
          String(error)
      },
      502
    );
  }
}


/*
========================================================
 API: ANALYZE
========================================================
*/

async function analyzeEndpoint(url) {
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
        success: false,

        error:
          "Invalid interval",

        allowed:
          ALLOWED_INTERVALS
      },
      400
    );
  }

  try {
    const market =
      await getCandles(
        pair,
        interval,
        CONFIG.maxCandles
      );

    const result =
      analyze(
        market.candles
      );

    if (!result) {
      throw new Error(
        "Analysis unavailable"
      );
    }

    const riskManagement =
      calculateRiskManagement(
        result
      );

    return json({
      success: true,

      project:
        "AI Trader Pro",

      version:
        CONFIG.version,

      pair:
        market.requestedPair,

      krakenPair:
        market.resolvedPair,

      interval:
        `${interval}m`,

      source:
        "Kraken",

      market: {
        price:
          round(result.price, 2),

        candles:
          market.candles.length
      },

      indicators: {
        rsi14:
          round(result.rsi14, 2),

        ema20:
          round(result.ema20, 2),

        ema50:
          round(result.ema50, 2),

        macd:
          round(result.macd, 4),

        macdSignal:
          round(result.macdSignal, 4),

        macdHistogram:
          round(
            result.macdHistogram,
            4
          ),

        atr14:
          round(result.atr14, 2)
      },

      filters: {
        bullishTrend:
          result.bullishTrend,

        bearishTrend:
          result.bearishTrend,

        bullishMomentum:
          result.bullishMomentum,

        bearishMomentum:
          result.bearishMomentum,

        volumeRatio:
          round(
            result.volumeRatio,
            3
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

        risk:
          result.risk
      },

      riskManagement,

      timestamp:
        new Date().toISOString()
    });

  } catch (error) {
    return json(
      {
        success: false,

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
========================================================
 API: BACKTEST
========================================================
*/

async function backtestEndpoint(url) {
  /*
    IMPORTANT:
    Read each query parameter independently.
    This prevents the previous bug where
    pair could accidentally become:

    XBTUSD&INTERVAL=60&LIMIT=200
  */

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

  const requestedLimit =
    Number(
      url.searchParams.get(
        "limit"
      )
    ) || 720;

  const limit =
    Math.min(
      Math.max(
        requestedLimit,
        CONFIG.minimumCandles
      ),
      CONFIG.maxCandles
    );

  if (
    !ALLOWED_INTERVALS.includes(
      interval
    )
  ) {
    return json(
      {
        success: false,

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
        success: false,

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
========================================================
 MAIN WORKER
========================================================
*/

export default {
  async fetch(request) {
    const url =
      new URL(
        request.url
      );

    /*
      HOME
    */

    if (
      url.pathname === "/"
    ) {
      return home();
    }

    /*
      STATUS
    */

    if (
      url.pathname ===
      "/api/status"
    ) {
      return status();
    }

    /*
      PAIR
    */

    if (
      url.pathname ===
      "/api/pair"
    ) {
      return pairEndpoint(
        url
      );
    }

    /*
      ANALYZE
    */

    if (
      url.pathname ===
      "/api/analyze"
    ) {
      return analyzeEndpoint(
        url
      );
    }

    /*
      BACKTEST
    */

    if (
      url.pathname ===
      "/api/backtest"
    ) {
      return backtestEndpoint(
        url
      );
    }

    /*
      UNKNOWN
    */

    return json(
      {
        success: false,

        error:
          "Not Found",

        availableEndpoints: [
          "/",
          "/api/status",
          "/api/pair?pair=XBTUSD",
          "/api/analyze?pair=XBTUSD&interval=60",
          "/api/analyze?pair=XBTUSD&interval=240",
          "/api/analyze?pair=ETHUSD&interval=60",
          "/api/analyze?pair=ETHUSD&interval=240",
          "/api/backtest?pair=XBTUSD&interval=60&limit=720",
          "/api/backtest?pair=XBTUSD&interval=240&limit=720",
          "/api/backtest?pair=ETHUSD&interval=60&limit=720",
          "/api/backtest?pair=ETHUSD&interval=240&limit=720"
        ]
      },
      404
    );
  }
};
