/**
 * Shared encoding contract for the privileged `media://` streaming protocol.
 *
 * The renderer cannot load local files via `file://` under a localhost origin
 * with webSecurity + a strict CSP, and `file://C:\path` is malformed on
 * Windows. Instead the main process registers a `media://` protocol that
 * streams a real absolute path. The renderer (via the preload bridge) turns an
 * absolute path into a URL with `toMediaUrl`, and the main handler reverses it
 * with `fromMediaUrl`. Both sides MUST use these functions so the encoding
 * stays identical.
 *
 * Form: `media://local/<encoded>` where `<encoded>` is the path with `\`
 * normalized to `/`, split on `/`, each segment `encodeURIComponent`'d, then
 * re-joined with `/`. Per-segment encoding keeps the slashes readable while
 * safely escaping spaces (the sample video filename contains spaces) and other
 * reserved characters.
 */

export const MEDIA_SCHEME = 'media';
export const MEDIA_HOST = 'local';

/** Convert an absolute filesystem path to a `media://local/...` URL. */
export function toMediaUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encoded}`;
}

/**
 * Reverse `toMediaUrl`. Accepts the pathname portion of a `media://` request
 * (e.g. from `new URL(request.url).pathname`, which begins with `/`) and
 * returns the decoded absolute filesystem path. On Windows this yields e.g.
 * `C:/Users/...`, which Node's fs APIs accept directly.
 */
export function fromMediaUrl(pathname: string): string {
  const trimmed = pathname.replace(/^\/+/, '');
  const decoded = trimmed
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
  return decoded;
}
