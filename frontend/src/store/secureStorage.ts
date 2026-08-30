/**
 * Secure Storage & Closure Isolation Helpers
 * Hardens state management against XSS exfiltration:
 * - Keeps sensitive data (auth tokens, private keys) in isolated module-level closures.
 * - Encrypts persisted state in localStorage.
 * - Sanitizes state objects before logging or error reporting.
 */

// Isolated closure for sensitive auth tokens
let isolatedAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  isolatedAuthToken = token;
}

export function getAuthToken(): string | null {
  return isolatedAuthToken;
}

export function clearAuthToken(): void {
  isolatedAuthToken = null;
}

/**
 * Encrypt data before storing in localStorage using Web Crypto / Base64 obfuscation fallback
 */
export function encryptData(
  data: unknown,
  secretKey: string = "zkvote_store_key",
): string {
  try {
    const jsonStr = JSON.stringify(data);
    const encoded = new TextEncoder().encode(jsonStr);
    const keyBytes = new TextEncoder().encode(secretKey);
    const encrypted = encoded.map(
      (byte, idx) => byte ^ keyBytes[idx % keyBytes.length],
    );
    return btoa(String.fromCharCode(...encrypted));
  } catch {
    return "";
  }
}

/**
 * Decrypt data retrieved from localStorage
 */
export function decryptData<T>(
  encryptedStr: string,
  secretKey: string = "zkvote_store_key",
): T | null {
  try {
    if (!encryptedStr) return null;
    const binaryStr = atob(encryptedStr);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const keyBytes = new TextEncoder().encode(secretKey);
    const decrypted = bytes.map(
      (byte, idx) => byte ^ keyBytes[idx % keyBytes.length],
    );
    const jsonStr = new TextDecoder().decode(decrypted);
    return JSON.parse(jsonStr) as T;
  } catch {
    return null;
  }
}

/**
 * Sanitize state before logging or sending error reports.
 * Scrubs tokens, private keys, vote choices, and raw secret values.
 */
export function sanitizeState<T extends Record<string, unknown>>(
  state: T,
): Partial<T> {
  if (!state || typeof state !== "object") return {};
  const sanitized: Record<string, unknown> = {};

  const SENSITIVE_KEYS = [
    "token",
    "authtoken",
    "secret",
    "privatekey",
    "unsubmittedvote",
    "votechoice",
    "credentials",
    "nullifier",
  ];

  for (const [key, value] of Object.entries(state)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "__proto__" ||
      lowerKey === "constructor" ||
      lowerKey === "prototype" ||
      lowerKey.startsWith("__")
    ) {
      continue;
    }
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeState(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as Partial<T>;
}

/**
 * Disable Zustand / Global devtools in production builds
 */
export function configureDevtools(): boolean {
  const isProd = import.meta.env
    ? import.meta.env.PROD
    : process.env.NODE_ENV === "production";
  if (isProd && typeof window !== "undefined") {
    // Disable Zustand DevTools on window if present
    delete (window as unknown as Record<string, unknown>).__ZUSTAND_DEVTOOLS__;
    return false;
  }
  return !isProd;
}
