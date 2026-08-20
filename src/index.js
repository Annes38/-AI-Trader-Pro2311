const CONFIG = {
  version: "V3.0",

  feePercent: 0.1,
  slippagePercent: 0.05,

  riskPerTradePercent: 1,
  accountBalance: 100,

  minConfidence: 75,

  riskReward: 2,

  maxHoldingCandles: 12,
  maxCandles: 200,

  atrStopMultiplier: 1.5,

  volumePeriod: 20
};

const ALLOWED_INTERVALS = [60, 240];

const PAIR_ALIASES = {
  BTC: ["BTC", "XBT"],
  XBT: ["BTC", "XBT"],
  ETH: ["ETH"]
};


/*
====================================================
UTILITY
====================================================
*/

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function normalizeSymbol(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}


/*
====================================================
EMA
====================================================
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
      (values[i] - result) * multiplier + result;
  }

  return result;
}


/*
====================================================
RSI
====================================================
*/

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) {
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

  return 100 - 100 / (1 + rs);
}


/*
====================================================
MACD
====================================================
*/

function macd(values) {
  if (values.length < 35) {
    return null;
  }

  const fast = [];
  const slow = [];

  for (let i = 0; i < values.length; i++) {
    const slice =
      values.slice(0, i + 1);

    const e12 =
      ema(slice, 12);

    const e26 =
      ema(slice, 26);

    if (
      e12 !== null &&
      e26 !== null
    ) {
      fast.push(e12 - e26);
      slow.push(i);
    }
  }

  if (fast.length < 9) {
    return null;
  }

  const line =
    fast[fast.length - 1];

  const signal =
    ema(fast, 9);

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
====================================================
ATR
====================================================
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

    ranges.push(
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
      )
    );
  }

  let value =
    ranges
      .slice(0, period)
      .reduce(
        (a, b) => a + b,
        0
      ) / period;

  for (
    let i = period;
    i < ranges.length;
    i++
  ) {
    value =
      (
        (value * (period - 1)) +
        ranges[i]
      ) / period;
  }

  return value;
}


/*
====================================================
SIMPLE MOVING AVERAGE
====================================================
*/

function sma(values, period) {
  if (
    !Array.isArray(values) ||
    values.length < period
  ) {
    return null;
  }

  const slice =
    values.slice(-period);

  return (
    slice.reduce(
      (a, b) => a + b,
      0
    ) / period
  );
}


/*
====================================================
VOLUME ANALYSIS
====================================================
*/

function volumeAnalysis(candles) {
  if (
    candles.length <
    CONFIG.volumePeriod
  ) {
    return null;
  }

  const volumes =
    candles.map(
      c => c.volume
    );

  const currentVolume =
    volumes[volumes.length - 1];

  const averageVolume =
    sma(
      volumes,
      CONFIG.volumePeriod
    );

  if (
    averageVolume === null ||
    averageVolume === 0
  ) {
    return null;
  }

  const ratio =
    currentVolume /
    averageVolume;

  return {
    currentVolume,
    averageVolume,
    ratio,

    strong:
      ratio >= 1.2,

    weak:
      ratio < 0.8
  };
}


/*
====================================================
KRAKEN PAIR RESOLUTION
====================================================
*/

function pairMatches(info, requested) {
  const req =
    normalizeSymbol(requested);

  const base =
    normalizeSymbol(
      info.base ||
      info.base_altname ||
      info.base_asset ||
      ""
    );

  const quote =
    normalizeSymbol(
      info.quote ||
      info.quote_altname ||
      info.quote_asset ||
      ""
    );

  const altname =
    normalizeSymbol(
      info.altname || ""
    );

  const wsname =
    normalizeSymbol(
      info.wsname || ""
    );

  const pairName =
    normalizeSymbol(
      info.pair || ""
    );

  const possible = [
    altname,
    wsname,
    pairName,
    base + quote
  ];

  if (
    possible.includes(req)
  ) {
    return true;
  }

  if (
    (
      req === "BTCUSD" ||
      req === "XBTUSD"
    ) &&
    quote === "USD" &&
    (
      base === "BTC" ||
      base === "XBT"
    )
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


async function resolveKrakenPair(
  requestedPair
) {
  const requested =
    String(
      requestedPair || "XBTUSD"
    ).toUpperCase();

  const response =
    await fetch(
      "https://api.kraken.com/0/public/AssetPairs",
      {
        headers: {
          Accept:
            "application/json"
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
    data =
      JSON.parse(text);
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

  const result =
    data.result || {};

  const candidates = [];

  if (
    requested === "BTCUSD" ||
    requested === "XBTUSD" ||
    requested === "BTC/USD" ||
    requested === "XBT/USD"
  ) {
    candidates.push(
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
    candidates.push(
      "ETH/USD",
      "ETHUSD"
    );
  }

  for (
    const candidate of candidates
  ) {
    for (
      const [key, info]
      of Object.entries(result)
    ) {
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
        normalizeSymbol(
          info.altname
        ) ===
        normalizeSymbol(candidate)
      ) {
        return {
          requested,
          krakenPair: key,
          info
        };
      }

      if (
        normalizeSymbol(
          info.wsname
        ) ===
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

  for (
    const [key, info]
    of Object.entries(result)
  ) {
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

  for (
    const [key, info]
    of Object.entries(result)
  ) {
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
    `Available USD pairs sample: ` +
    `${usdPairs.slice(0, 20).join(", ")}`
  );
}


/*
====================================================
MARKET DATA
====================================================
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
    await fetch(
      url,
      {
        headers: {
          Accept:
            "application/json"
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
    data =
      JSON.parse(text);
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
    Object.keys(result)
      .find(
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
      .filter(
        c =>
          Number.isFinite(c.close) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.volume)
      );

  if (
    candles.length < 60
  ) {
    throw new Error(
      `Not enough candles: ${candles.length}`
    );
  }

  return {
    candles,
    resolvedPair:
      resolved.krakenPair,
    requestedPair
