import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();
    const apiKey = process.env.REVE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "REVE_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const res = await fetch("https://api.reve.com/v1/image/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, aspect_ratio: "1:1" }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `Reve API error: ${res.statusText} - ${errorText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ url: `data:image/jpeg;base64,${data.image}` });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
