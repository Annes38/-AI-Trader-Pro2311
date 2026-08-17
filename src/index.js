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
        version: "V2.2"
      });
    }

    if (url.pathname === "/api/price") {
      const symbol = (
        url.searchParams.get("symbol") || "BTCUSDT"
      ).toUpperCase();

      try {
        const response = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
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
              error: "Binance API error",
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
              error: "Invalid Binance response",
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        return Response.json({
          symbol: data.symbol,
          price: Number(data.price),
          source: "Binance",
          timestamp: Date.now()
        });

      } catch (error) {
        return Response.json(
          {
            error: "Unable to connect to Binance",
            details: String(error)
          },
          { status: 500 }
        );
      }
    }

    return Response.json(
      {
        error: "Not Found",
        available_endpoints: [
          "/",
          "/api/status",
          "/api/price?symbol=BTCUSDT"
        ]
      },
      { status: 404 }
    );
  }
};
