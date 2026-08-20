const CONFIG = {
  version: "V2.9",

  feePercent: 0.1,
  slippagePercent: 0.05,

  riskPerTradePercent: 1,

  accountBalance: 100,

  minRiskDistancePercent: 0.3,

  maxRiskDistancePercent: 5,

  minConfidence: 75,

  riskReward: 2,

  maxHoldingCandles: 12,

  maxCandles: 200
};

const ALLOWED_INTERVALS = [60, 240];

/*
  أسماء العملات التي يقبلها الموقع.
  Worker سيبحث عن الرمز الحقيقي في Kraken
  باستعمال AssetPairs.
*/
const PAIR_ALIASES = {
  BTC: ["BTC", "XBT"],
  XBT: ["BTC", "XBT"],
  ETH: ["ETH"]
};

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values
      .slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

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

    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain =
      ((avgGain * (period - 1)) + gain) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
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


/*
  ----------------------------------------------------
  RISK MANAGEMENT
  ----------------------------------------------------
*/

function calculateRiskManagement(
  price,
  stopLoss,
  takeProfit,
  signal,
  accountBalance = CONFIG.accountBalance
) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit) ||
    !Number.isFinite(accountBalance) ||
    accountBalance <= 0
  ) {
    return null;
  }

  const riskDistance =
    Math.abs(price - stopLoss);

  if (riskDistance <= 0) {
    return null;
  }

  const riskDistancePercent =
    (riskDistance / price) * 100;

  const riskAmount =
    accountBalance *
    (CONFIG.riskPerTradePercent / 100);

  const positionSize =
    riskAmount / riskDistance;

  const positionValue =
    positionSize * price;

  const estimatedFees =
    positionValue *
    (CONFIG.feePercent / 100) *
    2;

  const estimatedSlippage =
    positionValue *
    (CONFIG.slippagePercent / 100) *
    2;

  const totalTradingCost =
    estimatedFees +
    estimatedSlippage;

  const potentialLoss =
    riskAmount +
    totalTradingCost;

  const potentialProfit =
    riskAmount *
    CONFIG.riskReward -
    totalTradingCost;

  let validRiskDistance = true;

  if (
    riskDistancePercent <
    CONFIG.minRiskDistancePercent
  ) {
    validRiskDistance = false;
  }

  if (
    riskDistancePercent >
    CONFIG.maxRiskDistancePercent
  ) {
    validRiskDistance = false;
  }

  return {
    accountBalance:
      round(accountBalance),

    riskPerTradePercent:
      CONFIG.riskPerTradePercent,

    riskAmount:
      round(riskAmount, 4),

    entry:
      round(price),

    stopLoss:
      round(stopLoss),

    takeProfit:
      round(takeProfit),

    riskDistance:
      round(riskDistance, 6),

    riskDistancePercent:
      round(riskDistancePercent, 3),

    positionSize:
      round(positionSize, 8),

    positionValue:
      round(positionValue, 4),

    estimatedFees:
      round(estimatedFees, 4),

    estimatedSlippage:
      round(estimatedSlippage, 4),

    totalTradingCost:
      round(totalTradingCost, 4),

    potentialLoss:
      round(potentialLoss, 4),

    potentialProfit:
      round(potentialProfit, 4),

    riskReward:
      `1:${CONFIG.riskReward}`,

    validRiskDistance,

    signal
  };
}


/*
  ----------------------------------------------------
  KRAKEN PAIR RESOLUTION
  ----------------------------------------------------
*/

function normalizeSymbol(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function pairMatches(info, requested) {
  const req = normalizeSymbol(requested);

  const base = normalizeSymbol(
    info.base ||
    info.base_altname ||
    info.base_asset ||
    ""
  );

  const quote = normalizeSymbol(
    info.quote ||
    info.quote_altname ||
    info.quote_asset ||
    ""
  );

  const altname = normalizeSymbol(
    info.altname || ""
  );

  const wsname = normalizeSymbol(
    info.wsname || ""
  );

  const pairName = normalizeSymbol(
    info.pair || ""
  );

  const possible = [
    altname,
    wsname,
    pairName,
    base + quote
  ];

  if (possible.includes(req)) {
    return true;
  }

  if (
    (req === "BTCUSD" || req === "XBTUSD") &&
    quote === "USD" &&
    (base === "BTC" || base === "XBT")
  ) {
    return true;
  }

  if (
    req === "ETHUSD" &&
    quote === "USD" &&
    base === "ETH"
  ) {
    return true;
  }

  return false;
}

async function resolveKrakenPair(requestedPair) {
  const requested =
    String(requestedPair || "XBTUSD")
      .toUpperCase();

  const directCandidates = [];

  if (
    requested === "BTCUSD" ||
    requested === "XBTUSD" ||
    requested === "BTC/USD" ||
    requested === "XBT/USD"
  ) {
    directCandidates.push(
      "BTC/USD",
      "XBT/USD",
      "XBTUSD",
      "BTCUSD"
    );
  }

  if (
    requested === "ETHUSD" ||
    requested === "ETH/USD"
  ) {
    directCandidates.push(
      "ETH/USD",
      "ETHUSD"
    );
  }

  const response = await fetch(
    "https://api.kraken.com/0/public/AssetPairs",
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  const text = await response.text();

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
      "Kraken AssetPairs returned invalid JSON"
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

  const result = data.result || {};

  for (const candidate of directCandidates) {
    for (const [key, info] of Object.entries(result)) {
      if (
        normalizeSymbol(key) ===
        normalizeSymbol(candidate)
      ) {
        return {
          requested,
          krakenPair: key,
          info
        };
      }

      if (
        normalizeSymbol(info.altname) ===
        normalizeSymbol(candidate)
      ) {
        return {
          requested,
          krakenPair: key,
          info
        };
      }

      if (
        normalizeSymbol(info.wsname) ===
        normalizeSymbol(candidate)
      ) {
        return {
          requested,
          krakenPair: key,
          info
        };
      }
    }
  }

  for (const [key, info] of Object.entries(result)) {
    if (
      pairMatches(
        {
          ...info,
          pair: key
        },
        requested
      )
    ) {
      return {
        requested,
        krakenPair: key,
        info
      };
    }
  }

  const usdPairs = [];

  for (const [key, info] of Object.entries(result)) {
    const quote =
      normalizeSymbol(
        info.quote ||
        info.quote_altname ||
        ""
      );

    if (quote === "USD") {
      usdPairs.push(
        info.wsname ||
        info.altname ||
        key
      );
    }
  }

  throw new Error(
    `Kraken pair not found: ${requested}. ` +
    `Available USD pairs sample: ${usdPairs.slice(0, 20).join(", ")}`
  );
}


/*
  ----------------------------------------------------
  MARKET DATA
  ----------------------------------------------------
*/

async function getCandles(
  pair,
  interval,
  limit = CONFIG.maxCandles
) {
  const resolved =
    await resolveKrakenPair(pair);

  const url =
    "https://api.kraken.com/0/public/OHLC" +
    `?pair=${encodeURIComponent(
      resolved.krakenPair
    )}` +
    `&interval=${interval}`;

  const response =
    await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

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
      "Kraken OHLC returned invalid JSON"
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
    Object.keys(result).find(
      k => k !== "last"
    );

  if (!key) {
    throw new Error(
      "Kraken returned no candles"
    );
  }

  const candles =
    result[key]
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
      }))
      .filter(c =>
        Number.isFinite(c.close) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low)
      );

  if (candles.length < 60) {
    throw new Error(
      `Not enough candles: ${candles.length}`
    );
  }

  return {
    candles,
    resolvedPair: resolved.krakenPair,
    requestedPair: resolved.requested
  };
}


/*
  ----------------------------------------------------
  ANALYSIS
  ----------------------------------------------------
*/

function analyze(candles) {
  if (candles.length < 60) {
    return null;
  }

  const closes =
    candles.map(c => c.close);

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

  if (price > ema20) {
    buyScore++;
  }

  if (price < ema20) {
    sellScore++;
  }

  if (ema20 > ema50) {
    buyScore++;
  }

  if (ema20 < ema50) {
    sellScore++;
  }

  if (
    rsi14 >= 50 &&
    rsi14 < 70
  ) {
    buyScore++;
  }

  if (
    rsi14 <= 50 &&
    rsi14 > 30
  ) {
    sellScore++;
  }

  if (macdData.histogram > 0) {
    buyScore++;
  }

  if (macdData.histogram < 0) {
    sellScore++;
  }

  let signal = "HOLD";

  if (
    buyScore >= 3 &&
    buyScore > sellScore &&
    rsi14 < 70
  ) {
    signal = "BUY";
  }

  if (
    sellScore >= 3 &&
    sellScore > buyScore &&
    rsi14 > 30
  ) {
    signal = "SELL";
  }

  const score =
    Math.max(
      buyScore,
      sellScore
    );

  const confidence =
    Math.round(
      (score / 4) * 100
    );

  let stopLoss = null;
  let takeProfit = null;

  if (signal === "BUY") {
    stopLoss =
      price - atr14 * 1.5;

    const risk =
      price - stopLoss;

    takeProfit =
      price +
      risk * CONFIG.riskReward;
  }

  if (signal === "SELL") {
    stopLoss =
      price + atr14 * 1.5;

    const risk =
      stopLoss - price;

    takeProfit =
      price -
      risk * CONFIG.riskReward;
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

    signal,

    confidence,

    buyScore,
    sellScore,

    stopLoss,
    takeProfit
  };
}


/*
  ----------------------------------------------------
  TRADE EVALUATION
  ----------------------------------------------------
*/

function evaluateTrade(
  setup,
  candles,
  entryIndex
) {
  const firstIndex =
    entryIndex + 1;

  const lastIndex =
    Math.min(
      candles.length - 1,
      entryIndex +
        CONFIG.maxHoldingCandles
    );

  for (
    let i = firstIndex;
    i <= lastIndex;
    i++
  ) {
    const candle =
      candles[i];

    if (setup.signal === "BUY") {
      const stopHit =
        candle.low <=
        setup.stopLoss;

      const targetHit =
        candle.high >=
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
            "STOP_AND_TARGET_SAME_CANDLE"
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_LOSS"
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          exitPrice:
            setup.takeProfit,
          exitIndex: i,
          reason:
            "TAKE_PROFIT"
        };
      }
    }

    if (setup.signal === "SELL") {
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
            "STOP_AND_TARGET_SAME_CANDLE"
        };
      }

      if (stopHit) {
        return {
          outcome: "LOSS",
          exitPrice:
            setup.stopLoss,
          exitIndex: i,
          reason:
            "STOP_LOSS"
        };
      }

      if (targetHit) {
        return {
          outcome: "WIN",
          exitPrice:
            setup.takeProfit,
          exitIndex: i,
          reason:
            "TAKE_PROFIT"
        };
      }
    }
  }

  const exitIndex =
    lastIndex;

  const exitPrice =
    candles[exitIndex].close;

  let grossReturn = 0;

  if (setup.signal === "BUY") {
    grossReturn =
      ((exitPrice - setup.price) /
        setup.price) *
      100;
  }

  if (setup.signal === "SELL") {
    grossReturn =
      ((setup.price - exitPrice) /
        setup.price) *
      100;
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
  ----------------------------------------------------
  BACKTEST
  ----------------------------------------------------
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

  let maxDrawdown =
    0;

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  const trades = [];

  let nextAvailable = 60;

  for (
    let i = 60;
    i < candles.length - 1;
    i++
  ) {
    if (i < nextAvailable) {
      continue;
    }

    const history =
      candles.slice(0, i + 1);

    const setup =
      analyze(history);

    if (!setup) {
      continue;
    }

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

    const risk =
      calculateRiskManagement(
        setup.price,
        setup.stopLoss,
        setup.takeProfit,
        setup.signal,
        equity
      );

    if (!risk) {
      continue;
    }

    if (!risk.validRiskDistance) {
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

    let rMultiple = 0;

    if (
      result.reason ===
      "STOP_LOSS"
    ) {
      rMultiple = -1;
    } else if (
      result.reason ===
      "TAKE_PROFIT"
    ) {
      rMultiple =
        CONFIG.riskReward;
    } else if (
      result.reason ===
      "STOP_AND_TARGET_SAME_CANDLE"
    ) {
      rMultiple = -1;
    } else {
      const priceMove =
        setup.signal === "BUY"
          ? result.exitPrice - setup.price
          : setup.price - result.exitPrice;

      const riskDistance =
        Math.abs(
          setup.price -
          setup.stopLoss
        );

      rMultiple =
        riskDistance > 0
          ? priceMove / riskDistance
          : 0;
    }

    const positionValue =
      risk.positionValue;

    const fees =
      positionValue *
      (CONFIG.feePercent / 100) *
      2;

    const slippage =
      positionValue *
      (CONFIG.slippagePercent / 100) *
      2;

    const tradingCosts =
      fees + slippage;

    const grossPnL =
      risk.riskAmount *
      rMultiple;

    const netPnL =
      grossPnL -
      tradingCosts;

    const netReturn =
      equity > 0
        ? (netPnL / equity) * 100
        : 0;

    if (netPnL > 0) {
      wins++;
      grossProfit +=
        netPnL;
    } else {
      losses++;
      grossLoss +=
        Math.abs(netPnL);
    }

    equity =
      Math.max(
        0,
        equity + netPnL
      );

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

    const drawdown =
      peakEquity > 0
        ? ((peakEquity - equity) /
            peakEquity) *
          100
        : 0;

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
          candles[result.exitIndex].time *
          1000
        ).toISOString(),

      signal:
        setup.signal,

      entry:
        round(setup.price),

      exit:
        round(result.exitPrice),

      stopLoss:
        round(setup.stopLoss),

      takeProfit:
        round(setup.takeProfit),

      accountBalanceBefore:
        round(
          equity - netPnL,
          4
        ),

      positionSize:
        round(
          risk.positionSize,
          8
        ),

      positionValue:
        round(
          risk.positionValue,
          4
        ),

      riskAmount:
        round(
          risk.riskAmount,
          4
        ),

      rMultiple:
        round(
          rMultiple,
          3
        ),

      outcome:
        netPnL > 0
          ? "WIN"
          : "LOSS",

      reason:
        result.reason,

      grossPnL:
        round(
          grossPnL,
          4
        ),

      tradingCosts:
        round(
          tradingCosts,
          4
        ),

      netPnL:
        round(
          netPnL,
          4
        ),

      netReturn:
        round(
          netReturn,
          3
        )
    });

    nextAvailable =
      result.exitIndex + 1;
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
      accountBalance:
        CONFIG.accountBalance,

      feePercent:
        CONFIG.feePercent,

      slippagePercent:
        CONFIG.slippagePercent,

      riskPerTradePercent:
        CONFIG.riskPerTradePercent,

      minimumConfidence:
        CONFIG.minConfidence,

      minRiskDistancePercent:
        CONFIG.minRiskDistancePercent,

      maxRiskDistancePercent:
        CONFIG.maxRiskDistancePercent,

      riskReward:
        `1:${CONFIG.riskReward}`,

      maxHoldingCandles:
        CONFIG.maxHoldingCandles
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
        round(profitFactor, 3),

      netReturn:
        round(
          ((equity -
            CONFIG.accountBalance) /
            CONFIG.accountBalance) *
          100,
          3
        ),

      startingEquity:
        round(
          CONFIG.accountBalance,
          4
        ),

      endingEquity:
        round(
          equity,
          4
        ),

      maxDrawdown:
        round(
          maxDrawdown,
          3
        )
    },

    note:
      "Historical simulation only. Risk-based position sizing, fees and slippage included. No guarantee of future performance.",

    recentTrades:
      trades.slice(-20),

    timestamp:
      new Date().toISOString()
  };
}


/*
  ----------------------------------------------------
  JSON RESPONSE
  ----------------------------------------------------
*/

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        "Access-Control-Allow-Origin":
          "*"
      }
    }
  );
}


/*
  ----------------------------------------------------
  WORKER
  ----------------------------------------------------
*/

export default {
  async fetch(request) {
    const url =
      new URL(request.url);

    /*
      HOME
    */

    if (url.pathname === "/") {
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


    /*
      STATUS
    */

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
          "4-condition confirmation",

        backtest:
          "risk-based multi-candle",

        riskManagement: {
          enabled:
            true,

          riskPerTradePercent:
            CONFIG.riskPerTradePercent,

          accountBalance:
            CONFIG.accountBalance,

          riskReward:
            `1:${CONFIG.riskReward}`
        },

        realTrading:
          false,

        timestamp:
          new Date().toISOString()
      });
    }


    /*
      PAIR CHECK
    */

    if (
      url.pathname ===
      "/api/pair"
    ) {
      const pair =
        (
          url.searchParams.get(
            "pair"
          ) ||
          "XBTUSD"
        ).toUpperCase();

      try {
        const resolved =
          await resolveKrakenPair(
            pair
          );

        return json({
          success:
            true,

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
            success:
              false,

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
      ANALYSIS
    */

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

      const accountBalance =
        Math.max(
          Number(
            url.searchParams.get(
              "balance"
            )
          ) ||
          CONFIG.accountBalance,
          1
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
        const market =
          await getCandles(
            pair,
            interval,
            200
          );

        const result =
          analyze(
            market.candles
          );

        if (!result) {
          throw new Error(
            "Not enough market data"
          );
        }

        let risk = "LOW";

        if (
          result.rsi14 >= 70 ||
          result.rsi14 <= 30
        ) {
          risk = "HIGH";
        } else if (
          result.confidence < 85
        ) {
          risk = "MEDIUM";
        }

        const riskManagement =
          calculateRiskManagement(
            result.price,
            result.stopLoss,
            result.takeProfit,
            result.signal,
            accountBalance
          );

        return json({
          success:
            true,

          project:
            "AI Trader Pro",

          version:
            CONFIG.version,

          pair,

          krakenPair:
            market.resolvedPair,

          interval:
            `${interval}m`,

          source:
            "Kraken",

          market: {
            price:
              round(result.price),

            candles:
              market.candles.length
          },

          indicators: {
            rsi14:
              round(result.rsi14),

            ema20:
              round(result.ema20),

            ema50:
              round(result.ema50),

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
              round(result.atr14)
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

          riskManagement:
            riskManagement,

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


    /*
      BACKTEST
    */

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
        error:
          "Not Found",

        availableEndpoints: [
          "/",
          "/api/status",
          "/api/pair?pair=XBTUSD",
          "/api/pair?pair=ETHUSD",
          "/api/analyze?pair=XBTUSD&interval=60",
          "/api/analyze?pair=XBTUSD&interval=240",
          "/api/analyze?pair=ETHUSD&interval=60",
          "/api/analyze?pair=ETHUSD&interval=240",
          "/api/analyze?pair=XBTUSD&interval=60&balance=100",
          "/api/analyze?pair=ETHUSD&interval=60&balance=100",
          "/api/backtest?pair=XBTUSD&interval=60&limit=200",
          "/api/backtest?pair=XBTUSD&interval=240&limit=200",
          "/api/backtest?pair=ETHUSD&interval=60&limit=200",
          "/api/backtest?pair=ETHUSD&interval=240&limit=200"
        ]
      },
      404
    );
  }
};
