// "Chrome on Android" rather than a raw user-agent string, for the session
// list. Deliberately coarse: enough to recognise your own devices.

export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "A browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  return os ? `${browser} on ${os}` : browser;
}
