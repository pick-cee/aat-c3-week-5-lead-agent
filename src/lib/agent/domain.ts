export function canonicalizeDomain(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const hostname = new URL(candidate).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

export function isCandidateDomain(url: string, domainCanonical: string): boolean {
  const hostname = canonicalizeDomain(url);
  return hostname === domainCanonical || hostname.endsWith(`.${domainCanonical}`);
}
