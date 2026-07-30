import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { prompt, image_url } = await request.json();
    const base64Image = image_url ? image_url.replace(/^data:image\/\w+;base64,/, "") : "";
    const apiKey = process.env.REVE_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "REVE_API_KEY is not configured on the server." },
        { status: 500 }
      );
    }

    const res = await fetch("https://api.reve.com/v1/image/edit", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ edit_instruction: prompt, reference_image: base64Image }),
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
