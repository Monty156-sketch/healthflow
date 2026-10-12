// Same-origin proxy: every /api/* request from the browser lands here and is
// forwarded to the Express API on Render.
//
// Why: the browser then only ever talks to one domain, so the httpOnly
// refresh cookie is a first-party cookie. Calling Render directly from the
// frontend's domain would make it a third-party cookie, which browsers block,
// and every page refresh would sign the user out.

const API_ORIGIN = (process.env.API_ORIGIN ?? "http://localhost:4000").replace(/\/+$/, "");

// Headers never passed upstream: hop-by-hop headers, ones fetch sets itself,
// and anything a client could use to spoof its IP or our proxy headers.
const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "true-client-ip",
  "x-hf-client-ip",
  "x-hf-proxy-secret",
]);

// fetch has already decoded the body, so these would now be wrong.
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie", // re-added one by one below so multiple cookies survive
]);

function visitorIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    ""
  );
}

async function forward(request: Request): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${API_ORIGIN}${incoming.pathname}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(name) || name.startsWith("cf-")) return;
    headers.set(key, value);
  });

  const ip = visitorIp(request);
  const secret = process.env.PROXY_SHARED_SECRET;
  if (ip && secret) {
    headers.set("x-hf-client-ip", ip);
    headers.set("x-hf-proxy-secret", secret);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch {
    return Response.json({ error: "api_unreachable" }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const HEAD = forward;
export const OPTIONS = forward;
