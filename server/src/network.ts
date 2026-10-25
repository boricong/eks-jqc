import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

// Validate the literal authority before URL parsing can normalize alternate IP forms.
function authority(value: string): URL | undefined {
  if (!/^(?:\[::1\]|[a-zA-Z0-9.-]+)(?::[0-9]{1,5})?$/.test(value))
    return undefined;
  try {
    const url = new URL(`http://${value}`);
    const rawHost = value.replace(/:\d+$/, "").toLowerCase();
    if (url.hostname !== rawHost || (url.port && Number(url.port) === 0))
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function isLocalNetworkHost(host: string): boolean {
  if (host === "localhost" || host === "[::1]") return true;
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

function originURL(value: string): URL | undefined {
  try {
    const url = new URL(value);
    const rawAuthority = /^https?:\/\/([^/\?#]+)\/?$/.exec(value)?.[1];
    if (
      !rawAuthority ||
      !authority(rawAuthority) ||
      url.username ||
      url.password
    )
      return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function createNetworkPolicy(origins: string[] = []) {
  const allowed = origins.map((value) => {
    const url = originURL(value);
    if (!url)
      throw new Error(
        `허용 출처는 경로 없는 HTTP(S) 주소여야 합니다: ${value}`,
      );
    return url;
  });
  return {
    acceptsHost(host: string | undefined): boolean {
      const url = host && authority(host);
      return (
        !!url &&
        (isLocalNetworkHost(url.hostname) ||
          allowed.some((entry) => entry.hostname === url.hostname))
      );
    },
    acceptsOrigin(host: string, protocol: string, origin: string): boolean {
      const destination = authority(host);
      const source = originURL(origin);
      if (!destination || !source || !["http", "https"].includes(protocol))
        return false;
      return (
        source.origin === new URL(`${protocol}://${host}`).origin ||
        allowed.some((entry) => entry.origin === source.origin)
      );
    },
  };
}

export function listenHost(
  value: string | undefined,
  fallback: string,
): string {
  const host = value ?? fallback;
  if (host !== "localhost" && !isIP(host))
    throw new Error("수신 주소는 IP 또는 localhost여야 합니다.");
  return host;
}

export function listenPort(
  value: string | undefined,
  fallback: number,
): number {
  if (value !== undefined && !/^\d+$/.test(value))
    throw new Error("포트는 정수여야 합니다.");
  const port = value === undefined ? fallback : Number(value);
  if (port < 1 || port > 65535) throw new Error("포트는 1~65535여야 합니다.");
  return port;
}

export function connectionCandidates(host: string, port: number): string[] {
  const hosts =
    host === "0.0.0.0"
      ? [
          "127.0.0.1",
          ...Object.values(networkInterfaces()).flatMap((entries) =>
            (entries ?? [])
              .filter(
                (entry) =>
                  entry.family === "IPv4" &&
                  !entry.internal &&
                  isLocalNetworkHost(entry.address),
              )
              .map((entry) => entry.address),
          ),
        ]
      : [host.includes(":") ? `[${host}]` : host];
  return [...new Set(hosts)].map((entry) => `http://${entry}:${port}`);
}
