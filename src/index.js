export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        message: "AI Trader Pro API is running"
      });
    }

    if (url.pathname === "/api/status") {
      return Response.json({
        status: "online",
        project: "AI Trader Pro",
        version: "V2.2"
      });
    }

    if (url.pathname === "/api/price") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      const assets = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum"
      };

      const asset = assets[symbol];

      if (!asset) {
        return Response.json(
          { error: "Supported symbols: BTCUSDT, ETHUSDT" },
          { status: 400 }
        );
      }

      try {
        const response = await fetch(
          `https://api.coincap.io/v2/assets/${asset}`
        );

        if (!response.ok) {
          return Response.json(
            { error: "Market API error" },
            { status: 502 }
          );
        }

        const result = await response.json();

        return Response.json({
          symbol,
          price: Number(result.data.priceUsd),
          currency: "USD",
          source: "CoinCap",
          timestamp: Date.now()
        });

      } catch (error) {
        return Response.json(
          { error: "Unable to fetch market price" },
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
          "/api/price?symbol=BTCUSDT"
        ]
      },
      { status: 404 }
    );
  }
};
