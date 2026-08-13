// Send the tutorial to a phone with no server: the entire tutorial is
// packed, deflate-compressed, and base64url-encoded into a URL fragment,
// which the mirror displays as a QR code. The phone scans it and this same
// app, seeing the fragment, renders instruction cards instead of the mirror.
// Nothing is uploaded anywhere; the data travels inside the QR itself.

export const COMPANION_HASH_PREFIX = "#companion=";

/** Minimal wire form of a look's tutorial. */
export function packSteps(look) {
  return {
    v: 1,
    name: look.name,
    steps: look.steps.map((s) => ({
      l: s.layer,
      t: s.title,
      i: s.instruction,
      p: s.tip,
      c: look.layers[s.layer]?.color ?? null,
    })),
  };
}

// -- base64url over Uint8Array --

function bytesToBase64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64urlToBytes(str) {
  const b64 = str.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipeThrough(bytes, TransformCtor, kind) {
  const stream = new Blob([bytes]).stream().pipeThrough(new TransformCtor(kind));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Encode a payload object to a compact URL-safe string. Prefix marks the
 * encoding: "d." deflate-raw + base64url, "p." plain base64url (fallback
 * for browsers without CompressionStream).
 */
export async function encodePayload(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== "undefined") {
    const deflated = await pipeThrough(raw, CompressionStream, "deflate-raw");
    return "d." + bytesToBase64url(deflated);
  }
  return "p." + bytesToBase64url(raw);
}

export async function decodePayload(str) {
  const dot = str.indexOf(".");
  const scheme = str.slice(0, dot);
  const bytes = base64urlToBytes(str.slice(dot + 1));
  const raw = scheme === "d"
    ? await pipeThrough(bytes, DecompressionStream, "deflate-raw")
    : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Full URL a phone should open, based on the current page's location. */
export function buildCompanionUrl(baseHref, encodedPayload) {
  const base = baseHref.split("#")[0];
  return `${base}${COMPANION_HASH_PREFIX}${encodedPayload}`;
}

/** Parse a location.hash; returns the payload object or null. */
export async function parseCompanionHash(hash) {
  if (!hash?.startsWith(COMPANION_HASH_PREFIX)) return null;
  try {
    const data = await decodePayload(hash.slice(COMPANION_HASH_PREFIX.length));
    if (data?.v !== 1 || !Array.isArray(data.steps) || data.steps.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}
