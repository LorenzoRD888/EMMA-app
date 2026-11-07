import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16],["192.0.0.0",24],["192.0.2.0",24],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]]) blocked.addSubnet(ip, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

// Syntactic check only. Fetches must use fetchExternalUrl, which also
// validates DNS at the moment the socket connects.
export function isSafeExternalUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return { ok: false, reason: "Invalid URL" }; }
  if (!["http:", "https:"].includes(u.protocol)) return { ok: false, reason: "Only http/https URLs are allowed" };
  if (u.username || u.password) return { ok: false, reason: "URL credentials are not allowed" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) return isPublicAddress(host) ? { ok: true } : { ok: false, reason: "Private/internal IP addresses are not allowed" };
  if (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "Internal hostnames are not allowed" };
  return { ok: true };
}
