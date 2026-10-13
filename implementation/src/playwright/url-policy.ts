import { isIP } from "node:net";

export function isAllowedPublicHttpUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.username || url.password || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return false;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    return isPublicIpAddress(hostname);
  }
  if (ipVersion === 6) {
    return isPublicIpAddress(hostname);
  }

  return true;
}

export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  return url.toString();
}

export function extractDomain(rawUrl: string): string {
  return new URL(rawUrl).hostname.toLowerCase();
}

export function isPublicIpAddress(address: string): boolean {
  if (isIP(address) === 4) return !isPrivateIpv4(address);
  if (isIP(address) !== 6) return false;
  // URL normalizes compressed and embedded IPv4 forms into hexadecimal IPv6.
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (normalized.startsWith("::ffff:")) {
    const words = normalized.slice(7).split(":").map((word) => Number.parseInt(word, 16));
    const high = words[0] ?? 0;
    const low = words[1] ?? 0;
    return !isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  // Global unicast only; reject unspecified, loopback, ULA, link-local,
  // multicast, IPv4-compatible and translation/tunnelling special ranges.
  return /^[23]/.test(normalized) && !/^(2001:(?:db8:|0:|:)|2002:)/.test(normalized);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map((part) => Number(part));
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;

  return (
    a === 0 || a === 10 || a >= 224 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
