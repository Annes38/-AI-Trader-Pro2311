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

      const ids = {
        BTCUSDT: "1",
        ETHUSDT: "1027"
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
        const apiUrl =
          `https://pro-api.coinmarketcap.com/public-api/v1/simple/price?ids=${ids[symbol]}&convert=USD`;

        const response = await fetch(apiUrl);
        const body = await response.text();

        return Response.json({
          worker: "online",
          upstream_status: response.status,
          upstream_response: body.slice(0, 1000)
        });

      } catch (error) {
        return Response.json(
          {
            error: "Connection failed",
            details: String(error)
          },
          { status: 500 }
        );
      }
    }

    return Response.json(
      {
        error: "Not Found"
      },
      { status: 404 }
    );
  }
};
