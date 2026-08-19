// Send the tutorial to a phone with no server: the entire tutorial is
// packed, deflate-compressed, and base64url-encoded into a URL fragment,
// which the mirror displays as a QR code. The phone scans it and this same
// app, seeing the fragment, renders instruction cards instead of the mirror.
// Nothing is uploaded anywhere; the data travels inside the QR itself.

import { LOOKS } from "./looks.js";
import { PHOTO_STEPS } from "./photolook.js";

export const COMPANION_HASH_PREFIX = "#companion=";

/**
 * Wire form of a look's tutorial.
 *
 * The phone opens this same app, so it already holds every word of the
 * step text. Only what the phone cannot know travels in the code: which
 * look, or — for a look built from a photo — which steps survived sampling
 * and what colour each came out. Sending the prose instead pushed a
 * sixteen-step tutorial to 2907 bytes against a 2953-byte ceiling, one
 * step away from producing no QR code at all.
 */
export function packSteps(look) {
  const preset = LOOKS.find((l) => l.id === look.id);
  if (preset) return { v: 2, look: preset.id };
  return {
    v: 2,
    name: look.name,
    photo: look.steps.map((s) => [s.layer, look.layers[s.layer]?.color ?? null]),
  };
}

/** Rebuild the full tutorial from a decoded payload. */
export function unpackSteps(data) {
  if (data?.v === 1) return data; // links made before the payload shrank
  if (data?.look) {
    const look = LOOKS.find((l) => l.id === data.look);
    if (!look) return null;
    return {
      name: look.name,
      steps: look.steps.map((s) => ({
        t: s.title, i: s.instruction, p: s.tip,
        c: look.layers[s.layer]?.color ?? null,
      })),
    };
  }
  if (Array.isArray(data?.photo)) {
    const steps = [];
    for (const [layer, color] of data.photo) {
      const step = PHOTO_STEPS.find((s) => s.layer === layer);
      if (step) steps.push({ t: step.title, i: step.instruction, p: step.tip, c: color });
    }
    return steps.length ? { name: data.name, steps } : null;
  }
  return null;
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
    const full = unpackSteps(data);
    if (!full || !Array.isArray(full.steps) || full.steps.length === 0) return null;
    return full;
  } catch {
    return null;
  }
}
