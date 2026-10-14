// Links built from report data. Much of a report is written by whoever built
// an image: a source URL comes from an image label, and a label can say
// anything, including javascript:. A report value becomes a link only when it
// is an absolute http(s) URL; anything else is shown as text.

/** The address to link to, or undefined when the value must stay text. */
export function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  // https://github.com@evil.example reads as GitHub and goes elsewhere.
  if (url.username !== '' || url.password !== '') return undefined;
  return url.href;
}
