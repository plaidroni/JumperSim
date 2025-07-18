export async function handler(event) {
  const { lat, lon, zoom = "14" } = event.queryStringParameters;

  if (!lat || !lon) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing lat or lon" }),
    };
  }

  const url = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${lon},${lat},${zoom}/512x512?access_token=${process.env.MAPBOX_TOKEN}`;

  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
      body: Buffer.from(buffer).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Mapbox fetch failed",
        details: err.message,
      }),
    };
  }
}
