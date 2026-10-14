// Element IDs for components that need one (a chip and the explanation it
// opens). The counter lives for the whole build, so an ID is unique within
// every page.
let next = 0;

export function uniqueId(prefix: string): string {
  next += 1;
  return `${prefix}-${next}`;
}
