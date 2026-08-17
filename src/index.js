export default {
  async fetch(request) {
    const url = new URL(request.url);

    // الصفحة الرئيسية
    if (url.pathname === "/") {
      return Response.json({
        name: "AI Trader Pro",
        version: "V2.2",
        status: "online",
        message: "AI Trader Pro API is running"
      });
    }

    // حالة النظام
    if (url.pathname === "/api/status") {
      return Response.json({
        status: "online",
        project: "AI Trader Pro",
        version: "V2.2"
      });
    }

    // جلب سعر BTC / ETH
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
          {
            error: "Unsupported symbol",
            supported: ["BTCUSDT", "ETHUSDT"]
          },
          { status: 400 }
        );
      }

      try {
        const response = await fetch(
          `https://api.coincap.io/v2/assets/${asset}`,
          {
            headers: {
              "Accept": "application/json",
              "User-Agent": "AI-Trader-Pro/2.2"
            }
          }
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

        let result;

        try {
          result = JSON.parse(body);
        } catch {
          return Response.json(
            {
              error: "Invalid market API response",
              details: body.slice(0, 500)
            },
            { status: 502 }
          );
        }

        const price = Number(result?.data?.priceUsd);

        if (!Number.isFinite(price)) {
          return Response.json(
            {
              error: "Price unavailable",
              details: result
            },
            { status: 502 }
          );
        }

        return Response.json({
          symbol,
          price,
          currency: "USD",
          source: "CoinCap",
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

    // أي رابط غير معروف
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
