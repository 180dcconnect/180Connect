import { isIP } from "node:net";

import { urlField } from "./validation.ts";

export type WebsiteFormatStatus =
  | { status: "missing"; url: null; message: string }
  | { status: "invalid"; url: string; message: string }
  | { status: "valid"; url: string; hostname: string; message: null };

export type WebsiteStatus =
  | WebsiteFormatStatus
  | { status: "unreachable"; url: string; message: string }
  | { status: "reachable"; url: string; message: null };

export function validateWebsiteFormat(value: string | null | undefined): WebsiteFormatStatus {
  const original = value?.trim() ?? "";
  if (!original) {
    return {
      status: "missing",
      url: null,
      message: "No website is recorded. Booklet research may have limited context.",
    };
  }

  const parsed = urlField().safeParse(original);
  if (!parsed.success) {
    return {
      status: "invalid",
      url: original,
      message: "This website URL has an invalid format.",
    };
  }

  const url = new URL(parsed.data);
  if (url.username || url.password || !url.hostname || isUnsafeHostname(url.hostname)) {
    return {
      status: "invalid",
      url: original,
      message: "This website URL is not safe to check.",
    };
  }

  return { status: "valid", url: url.toString(), hostname: url.hostname, message: null };
}

/** Protects the server-side reachability checker from local/private destinations. */
export function isUnsafeHostname(hostname: string): boolean {
  // WHATWG URL keeps brackets around IPv6 literals (`[::1]`). Strip them before
  // handing the value to isIP/isPrivateAddress or private literals look like names.
  const value = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) {
    return true;
  }
  return isIP(value) !== 0 && isPrivateAddress(value);
}

export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");

  if (value.includes(":")) {
    const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
    if (mapped) return isPrivateAddress(mapped);

    return (
      value === "::" ||
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe8") ||
      value.startsWith("fe9") ||
      value.startsWith("fea") ||
      value.startsWith("feb")
    );
  }

  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    first >= 224
  );
}

export type WebsiteCheckDependencies = {
  resolve: (hostname: string) => Promise<readonly string[]>;
  /** Requests the URL through the exact address that was checked above. */
  request: (url: string, pinnedAddress: string) => Promise<WebsiteResponse>;
  onFailure?: (error: unknown, hostname: string) => Promise<void> | void;
};

export type WebsiteResponse = { status: number; location: string | null };

const MAX_REDIRECTS = 3;

/**
 * Checks DNS and HTTP reachability without following a redirect to an unchecked host.
 * A broken site is a field-quality warning, never grounds for discarding the client.
 */
export async function checkWebsite(
  value: string | null | undefined,
  dependencies: WebsiteCheckDependencies,
): Promise<WebsiteStatus> {
  const format = validateWebsiteFormat(value);
  if (format.status !== "valid") return format;

  let current = format.url;

  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const currentUrl = new URL(current);
      const addresses = await dependencies.resolve(currentUrl.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        await dependencies.onFailure?.(
          new Error(addresses.length === 0 ? "Website hostname did not resolve" : "Website resolved to a private address"),
          currentUrl.hostname,
        );
        return {
          status: "unreachable",
          url: format.url,
          message: "This website could not be safely resolved.",
        };
      }

      // Pin the transport to the address we just validated. A second, independent
      // DNS lookup here would create a DNS-rebinding TOCTOU hole.
      const response = await dependencies.request(current, addresses[0]);

      if (response.status >= 300 && response.status < 400) {
        const location = response.location;
        if (!location || redirects === MAX_REDIRECTS) break;
        const redirected = new URL(location, current).toString();
        const redirectedFormat = validateWebsiteFormat(redirected);
        if (redirectedFormat.status !== "valid") {
          await dependencies.onFailure?.(
            new Error("Website redirected to an unsafe or malformed destination"),
            currentUrl.hostname,
          );
          break;
        }
        current = redirectedFormat.url;
        continue;
      }

      if ((response.status >= 200 && response.status < 300) || response.status === 401 || response.status === 403) {
        return { status: "reachable", url: format.url, message: null };
      }

      await dependencies.onFailure?.(
        new Error(`Website returned HTTP ${response.status}`),
        currentUrl.hostname,
      );
      return {
        status: "unreachable",
        url: format.url,
        message: `This website returned HTTP ${response.status}.`,
      };
    }
  } catch (error) {
    // The wrapper records the real diagnostic in ERROR_LOG/Sentry. The CAM receives
    // only the safe status below; unexpected programming errors are no longer swallowed.
    await dependencies.onFailure?.(error, new URL(current).hostname);
  }

  await dependencies.onFailure?.(
    new Error("Website exceeded the redirect limit or returned an unusable redirect"),
    new URL(current).hostname,
  );
  return {
    status: "unreachable",
    url: format.url,
    message: "This website did not respond to the validation check.",
  };
}
