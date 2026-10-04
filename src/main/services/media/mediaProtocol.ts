/**
 * Privileged `media://` streaming protocol (root cause fix for local playback).
 *
 * The renderer runs under a localhost origin with webSecurity enabled and a
 * strict CSP, so `file://` cannot load local media and `file://C:\path` is
 * malformed on Windows anyway. This custom scheme resolves a `media://local/…`
 * URL back to a real absolute path and streams the file WITH HTTP byte-range
 * support, which the <video> element requires for seeking.
 *
 * Security: the scheme is registered privileged (standard/secure/stream/
 * supportFetchAPI) but does NOT bypass CSP — instead the scheme is added to the
 * CSP media-src/img-src in index.html. webSecurity, contextIsolation and
 * nodeIntegration are left untouched.
 */

import { protocol } from 'electron';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { extname } from 'node:path';
import { MEDIA_SCHEME, fromMediaUrl } from '@shared/utils/mediaUrl';

/** Best-effort content type from a file extension. */
function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.mkv':
      return 'video/x-matroska';
    case '.webm':
      return 'video/webm';
    case '.avi':
      return 'video/x-msvideo';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.aac':
      return 'audio/aac';
    case '.m4a':
      return 'audio/mp4';
    case '.flac':
      return 'audio/flac';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

/** Parse a `Range: bytes=start-end` header against a known file size. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  let start: number;
  let end: number;
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

/** Register the privileged scheme. MUST run before app `ready`. */
export function registerMediaProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

/** Register the streaming handler. MUST run after app `ready`. */
export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    let filePath: string;
    try {
      const url = new URL(request.url);
      filePath = fromMediaUrl(url.pathname);
    } catch {
      return new Response('Bad media URL', { status: 400 });
    }

    if (!filePath || !existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }

    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const contentType = contentTypeFor(filePath);
    const rangeHeader = request.headers.get('Range');
    const range = parseRange(rangeHeader, size);

    if (range) {
      const { start, end } = range;
      const chunkLength = end - start + 1;
      const nodeStream = createReadStream(filePath, { start, end });
      const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunkLength),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }

    const nodeStream = createReadStream(filePath);
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  });
}
