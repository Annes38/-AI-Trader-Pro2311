export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // الصفحة الرئيسية
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({
          name: "AI Trader Pro",
          version: "V2.2",
          status: "online",
          message: "AI Trader Pro API is running"
        }),
        {
          headers: {
            "content-type": "application/json; charset=UTF-8"
          }
        }
      );
    }

    // فحص حالة النظام
    if (url.pathname === "/api/status") {
      return Response.json({
        status: "online",
        project: "AI Trader Pro",
        version: "V2.2",
        market: "crypto",
        mode: "analysis"
      });
    }

    // جلب سعر BTC من Binance
    if (url.pathname === "/api/price") {
      try {
        const symbol = url.searchParams.get("symbol") || "BTCUSDT";

        const response = await fetch(
          `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
        );

        if (!response.ok) {
          return Response.json(
            {
              error: "Binance API error"
            },
            { status: 502 }
          );
        }

        const data = await response.json();

        return Response.json({
          symbol: data.symbol,
          price: Number(data.price),
          source: "Binance",
          timestamp: Date.now()
        });
      } catch (error) {
        return Response.json(
          {
            error: "Unable to fetch market price"
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
