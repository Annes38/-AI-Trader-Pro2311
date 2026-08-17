export default {
  async fetch(request) {
    const url = new URL(request.url);

    // =========================
    // HOME
    // =========================
    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        message: "AI Trader Pro API is running"
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
        market_data: "Binance Market Data API"
      });
    }

    // =========================
    // MARKET PRICE
    // =========================
    if (url.pathname === "/api/price") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      // نخليو العملات المسموحة حالياً
      const supportedSymbols = [
        "BTCUSDT",
        "ETHUSDT"
      ];

      if (!supportedSymbols.includes(symbol)) {
        return Response.json(
          {
            error: "Unsupported symbol",
            supported_symbols: supportedSymbols
          },
          { status: 400 }
        );
      }

      try {
        const apiUrl =
          `https://data-api.binance.vision/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;

        const response = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "Accept": "application/json"
          }
        });

        const body = await response.text();

        // API رفض الطلب
        if (!response.ok) {
          return Response.json(
            {
              error: "Market API error",
              provider: "Binance Market Data",
              upstream_status: response.status,
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        let data;

        try {
          data = JSON.parse(body);
        } catch {
          return Response.json(
            {
              error: "Invalid market API response",
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        const price = Number(data.price);

        if (!Number.isFinite(price)) {
          return Response.json(
            {
              error: "Invalid price received",
              data
            },
            { status: 502 }
          );
        }

        return Response.json({
          success: true,
          symbol: data.symbol,
          price: price,
          currency: "USDT",
          source: "Binance Market Data",
          timestamp: Date.now()
        });

      } catch (error) {
        return Response.json(
          {
            error: "Unable to connect to market API",
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
        available_endpoints: [
          "/",
          "/api/status",
          "/api/price?symbol=BTCUSDT",
          "/api/price?symbol=ETHUSDT"
        ]
      },
      { status: 404 }
    );
  }
};
