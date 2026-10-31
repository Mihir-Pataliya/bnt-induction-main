export function decodePresentationUrl(value: string): string {
  const decoded = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  try {
    return new URL(decoded.trim()).toString();
  } catch {
    return "";
  }
}

export function isValidPresentationUrl(value: string): boolean {
  return Boolean(decodePresentationUrl(value));
}
