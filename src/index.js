export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online"
      });
    }

    if (url.pathname === "/api/status") {
      return Response.json({
        status: "online",
        project: "AI Trader Pro",
        version: "V2.2",
        market_data: "CoinMarketCap + Kraken"
      });
    }

    // اختبار الشموع الحقيقية من Kraken
    if (url.pathname === "/api/candles") {
      const pair =
        url.searchParams.get("pair") || "XBTUSD";

      const interval =
        Number(url.searchParams.get("interval")) || 60;

      try {
        const response = await fetch(
          `https://api.kraken.com/0/public/OHLC?pair=${encodeURIComponent(pair)}&interval=${interval}`,
          {
            headers: {
              "Accept": "application/json"
            }
          }
        );

        const body = await response.text();

        if (!response.ok) {
          return Response.json(
            {
              error: "Kraken API error",
              upstream_status: response.status,
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        const result = JSON.parse(body);

        if (result.error && result.error.length > 0) {
          return Response.json(
            {
              error: "Kraken returned an error",
              details: result.error
            },
            { status: 502 }
          );
        }

        const resultKey = Object.keys(result.result || {})
          .find(key => key !== "last");

        const rawCandles =
          result.result?.[resultKey] || [];

        const candles = rawCandles.map(c => ({
          time: Number(c[0]),
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          vwap: Number(c[5]),
          volume: Number(c[6]),
          trades: Number(c[7])
        }));

        return Response.json({
          success: true,
          source: "Kraken",
          pair,
          interval_minutes: interval,
          count: candles.length,
          candles
        });

      } catch (error) {
        return Response.json(
          {
            error: "Unable to connect to Kraken",
            details: String(error)
          },
          { status: 500 }
        );
      }
    }

    return Response.json(
      {
        error: "Not Found",
        endpoints: [
          "/",
          "/api/status",
          "/api/candles?pair=XBTUSD&interval=60"
        ]
      },
      { status: 404 }
    );
  }
};
