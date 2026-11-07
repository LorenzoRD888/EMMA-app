import {auditPage} from "./research-audit.js";
import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import { isPublicAddress, isSafeExternalUrl } from "./urlSafety.js";

export function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) return callback(new Error("Blocked non-public DNS address"));
    const wanted = typeof options === "number" ? options : options?.family;
    const candidates = wanted ? addresses.filter(a => a.family === wanted) : addresses;
    if (!candidates.length) return callback(new Error("No public address for requested family"));
    if (options?.all) return callback(null, candidates);
    callback(null, candidates[0].address, candidates[0].family);
  });
}

function requestOnce(url, { headers, signal, maxBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    // The socket uses the checked address directly, with no second DNS lookup.
    const req = transport.request(url, { method: "GET", agent: false, lookup: publicLookup, signal, headers: { ...headers, "Accept-Encoding": "identity" } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.destroy();
        return resolve({ redirect: res.headers.location });
      }
      let size = 0;
      const chunks = [];
      res.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          const error = new Error("External response exceeds size limit");
          reject(error); res.destroy(error); req.destroy(error);
        } else chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => {
        const resultHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value != null) resultHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: resultHeaders }));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// GET only, bounded bodies and timeout. Every redirect is checked before connecting.
async function fetchExternalUrlImpl(raw, { headers = {}, signal = AbortSignal.timeout(12000), maxBytes = 5 * 1024 * 1024 } = {}) {
  let url = new URL(raw);
  for (let hop = 0; hop <= 5; hop++) {
    const check = isSafeExternalUrl(url.href);
    if (!check.ok) throw new Error(check.reason);
    const response = await requestOnce(url, { headers, signal, maxBytes });
    if (!response.redirect) return response;
    const target = new URL(response.redirect, url);
    if (url.protocol === "https:" && target.protocol !== "https:") throw new Error("Insecure redirect blocked");
    url = target;
  }
  throw new Error("Too many redirects");
}

export function fetchExternalUrl(url,options){return auditPage(url,()=>fetchExternalUrlImpl(url,options));}
