import dns from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, connect, type Socket } from "node:net";
import { isAllowedPublicHttpUrl, isPublicIpAddress } from "../../playwright/url-policy.js";

export type PublicHttpResult = {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
};

// Transport resource bounds, never a partial-body or summary-quality verdict.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const REQUEST_DEADLINE_MS = 60_000;

export async function resolvePublicAddress(url: URL): Promise<{ address: string; family: number }> {
  if (!isAllowedPublicHttpUrl(url.href)) throw new Error("URL is not a public HTTP(S) URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new Error("DNS destination is not a public IP address");
  }
  return addresses[0]!;
}

export async function publicHttpGet(rawUrl: string): Promise<PublicHttpResult> {
  let url = new URL(rawUrl);
  const signal = AbortSignal.timeout(REQUEST_DEADLINE_MS);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const destination = await resolvePublicAddress(url);
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === "https:" ? https : http).request(url, {
        method: "GET",
        agent: false,
        signal,
        headers: { "user-agent": "VRC-AI-Bot-public-source-fetch/2.0", "accept-encoding": "identity" },
        // Retain the hostname for Host/TLS verification but connect only to the
        // address checked above. No second DNS lookup (including Happy Eyeballs).
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [destination]);
          else callback(null, destination.address, destination.family);
        }
      }, resolve);
      request.on("error", reject);
      request.end();
    });
    const status = response.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
      response.destroy();
      if (redirect === MAX_REDIRECTS) throw new Error("public fetch redirect limit exceeded");
      url = new URL(response.headers.location, url);
      continue;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_RESPONSE_BYTES) {
        response.destroy();
        throw new Error("public response exceeds byte limit; body was not acquired completely");
      }
      chunks.push(bytes);
    }
    return { finalUrl: url.href, status, contentType: response.headers["content-type"] ?? null, body: Buffer.concat(chunks).toString("utf8") };
  }
  throw new Error("public fetch redirect limit exceeded");
}

// yt-dlp's extractor performs its own HTTPS requests. Route those through the
// same DNS/connection boundary; the subprocess cannot re-resolve checked hosts.
export async function withPublicHttpsProxy<T>(run: (proxy: string) => Promise<T>): Promise<T> {
  const sockets = new Set<Socket>();
  const server = http.createServer((_request, response) => { response.writeHead(405).end(); });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (request, client, head) => {
    void (async () => {
      const target = new URL(`https://${request.url}`);
      if ((target.port && target.port !== "443") || target.pathname !== "/") throw new Error("unsupported tunnel destination");
      const address = await resolvePublicAddress(target);
      if (client.destroyed) return;
      const upstream = connect({ host: address.address, family: address.family, port: 443 });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.setTimeout(REQUEST_DEADLINE_MS, () => upstream.destroy());
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    })().catch(() => client.destroy());
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("public proxy did not bind");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
