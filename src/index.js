const PAIRS = {
  XBTUSD: "BTC",
  ETHUSD: "ETH"
};

const INTERVALS = [60, 240];

const CONFIG = {
  feePercent: 0.1,
  slippagePercent: 0.05,
  riskPerTradePercent: 1,
  minConfidence: 75
};

function round(v, d = 2) {
  return v == null || !Number.isFinite(v)
    ? null
    : Number(v.toFixed(d));
}

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);
  let e =
    values.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  for (let i = period; i < values.length; i++) {
    e = (values[i] - e) * k + e;
  }

  return e;
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

    avgGain = ((avgGain * (period - 1)) + g) / period;
    avgLoss = ((avgLoss * (period - 1)) + l) / period;
  }

  if (avgLoss === 0) return 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function macd(values) {
  const lineValues = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);
    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);

    if (e12 != null && e26 != null) {
      lineValues.push(e12 - e26);
    }
  }

  if (lineValues.length < 9) return null;

  const line = lineValues[lineValues.length - 1];
  const signal = ema(lineValues, 9);

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
    const c = candles[i];
    const p = candles[i - 1];

    ranges.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  let value =
    ranges.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  for (let i = period; i < ranges.length; i++) {
    value =
      ((value * (period - 1)) + ranges[i]) /
      period;
  }

  return value;
}

function signal(candles) {
  if (candles.length < 60) return null;

  const close = candles.map(c => c.close);
  const price = close[close.length - 1];

  const e20 = ema(close, 20);
  const e50 = ema(close, 50);
  const r = rsi(close, 14);
  const m = macd(close);
  const a = atr(candles, 14);

  if (
    e20 == null ||
    e50 == null ||
    r == null ||
    !m ||
    a == null
  ) {
    return null;
  }

  let buyScore = 0;
  let sellScore = 0;

  // Trend
  if (price > e20) buyScore++;
  if (price < e20) sellScore++;

  if (e20 > e50
