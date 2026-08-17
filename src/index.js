export default {
  async fetch(request) {
    const url = new URL(request.url);

    const COINS = {
      BTCUSDT: 1,
      ETHUSDT: 1027
    };

    // =========================
    // HOME
    // =========================
    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        mode: "market-data"
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
        market_data: "CoinMarketCap"
      });
    }

    // =========================
    // PRICE
    // =========================
    if (url.pathname === "/api/price") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      if (!COINS[symbol]) {
        return Response.json(
          {
            error: "Unsupported symbol",
            supported_symbols: Object.keys(COINS)
          },
          { status: 400 }
        );
      }

      try {
        const response = await fetch(
          `https://pro-api.coinmarketcap.com/public-api/v1/simple/price?ids=${COINS[symbol]}&convert=USD`
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
            {
              error: "No market data returned"
            },
            { status: 502 }
          );
        }

        return Response.json({
          success: true,
          symbol,
          price: Number(coin.price),
          currency: "USD",
          source: "CoinMarketCap",
          timestamp: result?.status?.timestamp || new Date().toISOString()
        });

      } catch (error) {
        return Response.json(
          {
            error: "Market data connection failed",
            details: String(error)
          },
          { status: 500 }
        );
      }
    }

    // =========================
    // MULTI MARKET
    // =========================
    if (url.pathname === "/api/markets") {
      try {
        const response = await fetch(
          "https://pro-api.coinmarketcap.com/public-api/v1/simple/price?ids=1,1027&convert=USD"
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
        const data = result?.data || [];

        return Response.json({
          success: true,
          source: "CoinMarketCap",
          markets: data.map((coin) => ({
            id: coin.id,
            price: Number(coin.price),
            currency: "USD"
          })),
          timestamp:
            result?.status?.timestamp ||
            new Date().toISOString()
        });

      } catch (error) {
        return Response.json(
          {
            error: "Market data connection failed",
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
          "/api/price?symbol=ETHUSDT",
          "/api/markets"
        ]
      },
      { status: 404 }
    );
  }
};
