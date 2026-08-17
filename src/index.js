export default {
  async fetch(request, env) {
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
      const symbol = url.searchParams.get("symbol") || "BTCUSDT";

      try {
        const coin = symbol.replace("USDT", "").toLowerCase();

        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd`
        );

        if (!response.ok) {
          return Response.json(
            { error: "Market API error" },
            { status: 502 }
          );
        }

        const data = await response.json();

        if (!data[coin] || data[coin].usd === undefined) {
          return Response.json(
            { error: "Coin not found" },
            { status: 404 }
          );
        }

        return Response.json({
          symbol,
          price: data[coin].usd,
          currency: "USD",
          source: "CoinGecko",
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
