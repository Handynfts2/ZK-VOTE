/**
 * Structured Logger Service with PII Redaction
 */

import crypto from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMeta = Record<string, any>;

export interface RedactionPolicy {
  redactedFields: string[];
  detailedLevels: LogLevel[];
  showClientIp: "plain" | "hash" | "none";
  showBodyKeysOnly: boolean;
  stellarTruncateLength: number;
}

const DEFAULT_POLICY: RedactionPolicy = {
  redactedFields: [
    "proof",
    "nullifier",
    "commitment",
    "secret",
    "token",
    "password",
    "jwt",
    "refresh_token",
    "access_token",
    "api_key",
    "private_key",
    "seed",
    "mnemonic",
  ],
  detailedLevels: ["debug"],
  showClientIp: "hash",
  showBodyKeysOnly: true,
  stellarTruncateLength: 4,
};

let currentPolicy: RedactionPolicy = { ...DEFAULT_POLICY };

export function setRedactionPolicy(policy: Partial<RedactionPolicy>): void {
  currentPolicy = { ...currentPolicy, ...policy };
}

export function getRedactionPolicy(): RedactionPolicy {
  return { ...currentPolicy };
}

export function truncateStellarAddress(address: string): string {
  if (!address || address.length < 8) return "[REDACTED]";
  const prefix = currentPolicy.stellarTruncateLength;
  return address.slice(0, prefix) + "..." + address.slice(-prefix);
}

function applyRedaction(value: any, key: string, level: LogLevel): any {
  if (value && typeof value === "object" && value !== null) {
    if (Array.isArray(value)) {
      return value.map((v) => applyRedaction(v, key, level));
    }
    const result: any = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = applyRedaction(v, k, level);
    }
    return result;
  }

  // Check if this field is in the redacted fields list
  if (
    currentPolicy.redactedFields.some(
      (f) =>
        key.toLowerCase().includes(f.toLowerCase()) ||
        f.toLowerCase().includes(key.toLowerCase()),
    )
  ) {
    return "[REDACTED]";
  }

  // For string values, apply pattern-based redaction
  if (typeof value === "string") {
    // Stellar addresses
    if (value.match(/^G[A-Z0-9]{55}$/)) {
      return truncateStellarAddress(value);
    }
    // Stellar secret keys
    if (value.match(/^S[A-Z0-9]{55}$/)) {
      return "[REDACTED_SECRET]";
    }
    // IP addresses
    if (value.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)) {
      return "[REDACTED_IP]";
    }
    // Transaction hashes (64 hex)
    if (value.match(/^[0-9a-fA-F]{64}$/)) {
      return value.slice(0, 6) + "..." + value.slice(-6);
    }
    // IPFS CIDs
    if (value.match(/^(Qm|bafy)[a-zA-Z0-9]{44,59}$/)) {
      return value.slice(0, 6) + "..." + value.slice(-6);
    }
    return value;
  }

  return value;
}

export function redact(meta: LogMeta, level: LogLevel = "info"): LogMeta {
  const isDetailed = currentPolicy.detailedLevels.includes(level);

  const safe: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (
      isDetailed &&
      !currentPolicy.redactedFields.some((f) =>
        key.toLowerCase().includes(f.toLowerCase()),
      )
    ) {
      safe[key] = value;
      continue;
    }
    safe[key] = applyRedaction(value, key, level);
  }
  return safe;
}

export interface Logger {
  log(level: LogLevel, event: string, meta?: LogMeta): void;
  debug(event: string, meta?: LogMeta): void;
  info(event: string, meta?: LogMeta): void;
  warn(event: string, meta?: LogMeta): void;
  error(event: string, meta?: LogMeta): void;
}

export function createLogger(service: string): Logger {
  const log = (level: LogLevel, event: string, meta: LogMeta = {}): void => {
    const minLevel = (process.env.LOG_LEVEL || "info") as LogLevel;
    const levels = ["debug", "info", "warn", "error"];
    if (levels.indexOf(level) < levels.indexOf(minLevel)) {
      return;
    }

    const redactedMeta = redact(meta, level);
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      env: process.env.NODE_ENV || "development",
      ...redactedMeta,
    };
    console.log(JSON.stringify(entry));
  };

  return {
    log,
    debug: (event: string, meta?: LogMeta) => log("debug", event, meta),
    info: (event: string, meta?: LogMeta) => log("info", event, meta),
    warn: (event: string, meta?: LogMeta) => log("warn", event, meta),
    error: (event: string, meta?: LogMeta) => log("error", event, meta),
  };
}

export function generateRequestId(): string {
  return crypto.randomBytes(6).toString("hex");
}

export function hashIp(ip: string | undefined): string {
  return crypto
    .createHash("sha256")
    .update(ip || "")
    .digest("hex")
    .slice(0, 12);
}

export function log(level: LogLevel, event: string, meta: LogMeta = {}): void {
  const safe = redact(meta, level);
  const minLevel = (process.env.LOG_LEVEL || "info") as LogLevel;
  const levels = ["debug", "info", "warn", "error"];
  if (levels.indexOf(level) < levels.indexOf(minLevel)) {
    return;
  }
  console.log(
    JSON.stringify({
      level,
      event,
      ts: new Date().toISOString(),
      env: process.env.NODE_ENV || "development",
      ...safe,
    }),
  );
}

export const logger = createLogger(process.env.SERVICE_NAME || "relayer");
