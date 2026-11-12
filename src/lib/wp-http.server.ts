import { request as httpsRequest } from "node:https";

export async function wpFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? new URL(input) : input;
  const headers = new Headers(init.headers);
  const method = String(init.method ?? "GET").toUpperCase();
  const body = init.body == null ? undefined : typeof init.body === "string" ? init.body : String(init.body);

  const result = await new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
    const request = httpsRequest(url, {
      method,
      family: 4,
      servername: url.hostname,
      headers: Object.fromEntries(headers.entries()),
      timeout: 30_000,
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) responseHeaders[key] = value.join(", ");
          else if (value != null) responseHeaders[key] = String(value);
        }
        resolve({ status: incoming.statusCode ?? 0, headers: responseHeaders, body: Buffer.concat(chunks).toString("utf8") });
      });
      incoming.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("WordPress request timed out.")));
    request.on("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });

  return new Response(result.body, { status: result.status, headers: result.headers });
}
