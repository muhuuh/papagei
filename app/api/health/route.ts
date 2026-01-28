export async function GET() {
  return new Response(JSON.stringify({ ok: true, app: "papagei" }), {
    headers: { "content-type": "application/json" },
  });
}
