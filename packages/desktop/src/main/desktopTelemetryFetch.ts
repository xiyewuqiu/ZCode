interface DesktopTelemetryFetchSource {
  fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
}

export function createDesktopTelemetryFetch(source: DesktopTelemetryFetchSource): typeof fetch {
  return (input, init) => source.fetch(input instanceof URL ? input.href : input, init);
}
