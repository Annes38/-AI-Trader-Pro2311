export default {
  async fetch(request) {
    const url = new URL(request.url);

    // =========================
    // BASIC INFO
    // =========================
    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        mode: "real-market-data"
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
        market_data: "CoinMarketCap",
        analysis: "Candles + Technical Indicators"
      });
    }

    // =========================
    // CURRENT PRICE
    // =========================
    if (url.pathname === "/api/price") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      const ids = {
        BTCUSDT: 1,
        ETHUSDT: 1027
      };

      if (!ids[symbol]) {
        return Response.json(
          {
            error: "Unsupported symbol",
            supported: ["BTCUSDT", "ETHUSDT"]
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
            { error: "No market data returned" },
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
    // REAL CANDLE TEST
    // =========================
    if (url.pathname === "/api/candles") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      const interval =
        url.searchParams.get("interval") || "1h";

      const limit = Math.min(
        Number(url.searchParams.get("limit")) || 100,
        100
      );

      const allowedIntervals = [
        "1m",
        "5m",
        "15m",
        "30m",
        "1h",
        "4h",
        "1d"
      ];

      if (!allowedIntervals.includes(interval)) {
        return Response.json(
          {
            error: "Invalid interval",
            allowed: allowedIntervals
          },
          { status: 400 }
        );
      }

      try {
        const endpoint =
          `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;

        const response = await fetch(endpoint, {
          headers: {
            "Accept": "application/json"
          }
        });

        const body = await response.text();

        if (!response.ok) {
          return Response.json(
            {
              error: "Candle API error",
              provider: "Binance Market Data",
              upstream_status: response.status,
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        const raw = JSON.parse(body);

        const candles = raw.map((candle) => ({
          time: candle[0],
          open: Number(candle[1]),
          high: Number(candle[2]),
          low: Number(candle[3]),
          close: Number(candle[4]),
          volume: Number(candle[5])
        }));

        return Response.json({
          success: true,
          symbol,
          interval,
          count: candles.length,
          source: "Binance Market Data",
          candles
        });

      } catch (error) {
        return Response.json(
          {
            error: "Unable to fetch candles",
            details: String(error)
          },
          { status: 500 }
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
          "/api/candles?symbol=BTCUSDT&interval=1h&limit=100"
        ]
      },
      { status: 404 }
    );
  }
};
