/**
 * Downloads a video from a public https link for import_video_from_url,
 * without letting the link reach anything private. The address check runs
 * at connection time (the socket's own DNS lookup), so a hostname that
 * resolves to a public address when checked and a private one when
 * connecting cannot slip through; redirects are followed by hand and each
 * hop is checked again.
 */

import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import net from "node:net";
import { ToolError } from "./context.js";

const BLOCKED_V4 = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const v4Number = (ip) => ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);

function inRange(ip, [base, bits]) {
  const size = 2 ** (32 - bits);
  return Math.floor(v4Number(ip) / size) === Math.floor(v4Number(base) / size);
}

/** Whether an IP address is on the public internet (not private, loopback, link-local, carrier NAT, etc.). */
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED_V4.some((range) => inRange(address, range));
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  if (lower.startsWith("::")) return false; // unspecified, loopback, other embedded IPv4
  const first = Number.parseInt(lower.split(":")[0], 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (lower.startsWith("64:ff9b:")) return false; // NAT64 into IPv4
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return false; // documentation
  return true;
}

function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

/** Parses a link and rejects anything but a plain public https URL. */
export function checkLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ToolError("That isn't a valid link.");
  }
  if (url.protocol !== "https:") throw new ToolError("Only https links can be imported.");
  if (url.port && url.port !== "443") throw new ToolError("Only standard https links can be imported.");
  if (url.username || url.password) throw new ToolError("Links with a username or password can't be imported.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host) && !isPublicAddress(host)) throw new ToolError("That link points to a private address.");
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) {
    throw new ToolError("That link points to a private address.");
  }
  return url;
}

function get(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { "user-agent": "Posterract-Importer/1.0", accept: "video/*,*/*;q=0.5" },
      },
      resolve,
    );
    request.on("timeout", () => request.destroy(new ToolError("The link took too long to respond.")));
    request.on("error", (error) => {
      if (error instanceof ToolError) reject(error);
      else if (error.code === "EBLOCKED") reject(new ToolError("That link points to a private address."));
      else reject(new ToolError("Couldn't download that link."));
    });
  });
}

/**
 * Opens a download. Returns the response stream with its size and type, once
 * redirects are followed; the caller reads the body. Links must state their
 * size (Content-Length), so the import knows up front whether it fits.
 */
export async function openDownload(link, { maxBytes, timeoutMs = 30_000, maxRedirects = 3 }) {
  let url = checkLink(link);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await get(url, timeoutMs);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      response.resume();
      if (!response.headers.location) throw new ToolError("The link redirected nowhere.");
      url = checkLink(new URL(response.headers.location, url).toString());
      continue;
    }
    if (response.statusCode !== 200) {
      response.resume();
      throw new ToolError(`The link answered with HTTP ${response.statusCode}, so it can't be downloaded.`);
    }
    const size = Number(response.headers["content-length"]);
    if (!Number.isFinite(size) || size <= 0) {
      response.destroy();
      throw new ToolError("That link doesn't say how big the file is. Download it and use start_video_upload instead.");
    }
    if (size > maxBytes) {
      response.destroy();
      throw new ToolError(`That video is over ${Math.round(maxBytes / 1_000_000)} MB. Use start_video_upload for large files.`);
    }
    const contentType = response.headers["content-type"]?.split(";")[0].trim().toLowerCase();
    return { response, size, contentType, url };
  }
  throw new ToolError("The link redirected too many times.");
}
