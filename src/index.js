const CONFIG = {
  version: "V2.7",

  feePercent: 0.1,
  slippagePercent: 0.05,

  riskPerTradePercent: 1,

  minConfidence: 75,

  riskReward: 2,

  maxHoldingCandles: 12
};

const ALLOWED_INTERVALS = [60, 240];

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(decimals));
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

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
    const change =
      values[i] - values[i - 1];

    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
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

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function macd(values) {
  const lines = [];

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
      lines.push(e12 - e26);
    }
  }

  if (lines.length < 9) {
    return null;
  }

  const line =
    lines[lines.length - 1];

  const signal =
    ema(lines, 9);

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

    const range =
      Math.max(
        current.high -
          current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )
      );

    ranges.push(range);
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
      ((value * (period - 1)) +
        ranges[i]) /
      period;
  }

  return value;
}

function analyze(candles) {
  if (candles.length < 60) {
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

  // Trend
  if (price > ema20) {
    buyScore++;
  }

  if (price < ema20) {
    sellScore++;
  }

  // EMA trend
  if (ema20 > ema50) {
    buyScore++;
  }

  if (ema20 < ema50) {
    sellScore++;
  }

  // RSI
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

  // MACD
  if (
    macdData.histogram > 0
  ) {
    buyScore++;
  }

  if (
    macdData.histogram < 0
  ) {
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
      price -
      atr14 * 1.5;

    const risk =
      price - stopLoss;

    takeProfit =
      price +
      risk *
        CONFIG.riskReward;
  }

  if (signal === "SELL") {
    stopLoss =
      price +
      atr14 * 1.5;

    const risk =
      stopLoss - price;

    takeProfit =
      price -
      risk *
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

    signal,

    confidence,

    buyScore,
    sellScore,

    stopLoss,
    takeProfit
  };
}

async function getCandles(
  pair,
  interval,
  limit = 200
) {
  const url =
    "https://api.kraken.com/0/public/OHLC" +
    `?pair=${encodeURIComponent(pair)}` +
    `&interval=${interval}`;

  const response =
    await fetch(url, {
      headers: {
        Accept:
          "application/json"
      }
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Kraken HTTP ${response.status}`
    );
  }

  const data =
    JSON.parse(text);

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

  return result[key]
    .slice(-limit)
    .map(c => ({
      time:
        Number(c[0]),

      open:
        Number(c[1]),

      high:
        Number(c[2]),

      low:
        Number(c[3]),

      close:
        Number(c[4]),

      vwap:
        Number(c[5]),

      volume:
        Number(c[6]),

      trades:
        Number(c[7])
    }));
}

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
        إذا لمس السعر SL وTP
        في نفس الشمعة،
        نأخذ السيناريو المحافظ:
        LOSS.
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

  /*
    لا SL ولا TP خلال فترة الاحتفاظ.
    نغلق على Close آخر شمعة.
  */

  const exitIndex =
    lastIndex;

  const exitPrice =
    candles[exitIndex].close;

  let grossReturn = 0;

  if (
    setup.signal === "BUY"
  ) {
    grossReturn =
      ((exitPrice -
        setup.price) /
        setup.price) *
      100;
  }

  if (
    setup.signal === "SELL"
  ) {
    grossReturn =
      ((setup.price -
        exitPrice) /
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

async function runBacktest(
  pair,
  interval,
  limit
) {
  const candles =
    await getCandles(
      pair,
      interval,
      limit
    );

  let equity = 100;
  let peakEquity = 100;
  let maxDrawdown = 0;

  let wins = 0;
  let losses = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  const trades = [];

  let nextAvailable =
    60;

  for (
    let i = 60;
    i < candles.length - 1;
    i++
  ) {
    if (
      i < nextAvailable
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
      evaluateTrade(
        setup,
        candles,
        i
      );

    if (!result) {
      continue;
    }

    let grossReturn;

    if (
      result.reason ===
      "STOP_LOSS"
    ) {
      grossReturn = -1;
    } else if (
      result.reason ===
      "TAKE_PROFIT"
    ) {
      grossReturn =
        CONFIG.riskReward;
    } else if (
      result.reason ===
      "STOP_AND_TARGET_SAME_CANDLE"
    ) {
      grossReturn = -1;
    } else {
      grossReturn =
        result.grossReturn;
    }

    const fees =
      CONFIG.feePercent * 2;

    const slippage =
      CONFIG.slippagePercent * 2;

    const netReturn =
      grossReturn -
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

    equity =
      equity *
      (1 + netReturn / 100);

    peakEquity =
      Math.max(
        peakEquity,
        equity
      );

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
          candles[i].time *
            1000
        ).toISOString(),

      exitTime:
        new Date(
          candles[
            result.exitIndex
          ].time *
            1000
        ).toISOString(),

      signal:
        setup.signal,

      entry:
        round(
          setup.price
        ),

      exit:
        round(
          result.exitPrice
        ),

      stopLoss:
        round(
          setup.stopLoss
        ),

      takeProfit:
        round(
          setup.takeProfit
        ),

      outcome:
        netReturn > 0
          ? "WIN"
          : "LOSS",

      reason:
        result.reason,

      grossReturn:
        round(
          grossReturn,
          3
        ),

      netReturn:
        round(
          netReturn,
          3
        )
    });

    /*
      الصفقة لازم تكمل
      قبل فتح صفقة جديدة.
    */

    nextAvailable =
      result.exitIndex + 1;
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
        round(
          winRate
        ),

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

function json(
  data,
  status = 200
) {
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
          "3-condition confirmation",

        backtest:
          "multi-candle",

        riskReward:
          "1:2",

        realTrading:
          false,

        timestamp:
          new Date().toISOString()
      });
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
            "Not enough market data"
          );
        }

        let risk =
          "LOW";

        if (
          result.rsi14 >= 70 ||
          result.rsi14 <= 30
        ) {
          risk =
            "HIGH";
        } else if (
          result.confidence < 85
        ) {
          risk =
            "MEDIUM";
        }

        return json({
          success:
            true,

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

            takeProfit:
              round(
                result.takeProfit
              ),

            riskReward:
              "1:2"
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
