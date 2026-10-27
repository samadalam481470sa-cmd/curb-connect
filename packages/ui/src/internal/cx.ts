/** Joins truthy class names. Tiny on purpose: the package has no runtime dependencies. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Joins space-separated id lists (aria-describedby, aria-labelledby), dropping empties. */
export function joinIds(...ids: Array<string | false | null | undefined>): string | undefined {
  const value = ids.filter(Boolean).join(' ').trim();
  return value.length > 0 ? value : undefined;
}
