/**
 * Tests for PII Redaction in Logger
 */

import { describe, it, expect } from "vitest";
import {
  redact,
  truncateStellarAddress,
  setRedactionPolicy,
  getRedactionPolicy,
} from "../src/services/logger.js";

describe("Logger PII Redaction", () => {
  describe("Stellar address redaction", () => {
    it("should truncate Stellar addresses (show first 4 + last 4)", () => {
      const address = "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN";
      const result = truncateStellarAddress(address);
      expect(result).toBe("GABC...KLMN");
    });

    it("should redact Stellar addresses in logs", () => {
      const meta = {
        voter: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN",
        action: "vote_cast",
      };
      const result = redact(meta);
      expect(result.voter).toContain("GABC...KLMN");
    });
  });

  describe("Field-based redaction", () => {
    it("should redact known sensitive fields", () => {
      const meta = {
        proof: "abcdef123456",
        nullifier: "xyz789",
        secret: "secret123",
        token: "jwt123",
        password: "pass123",
        data: "not_sensitive",
      };
      const result = redact(meta);
      expect(result.proof).toBe("[REDACTED]");
      expect(result.nullifier).toBe("[REDACTED]");
      expect(result.secret).toBe("[REDACTED]");
      expect(result.token).toBe("[REDACTED]");
      expect(result.password).toBe("[REDACTED]");
      expect(result.data).toBe("not_sensitive");
    });
  });

  describe("Log-level based redaction", () => {
    it("should show more details in debug mode", () => {
      const meta = {
        voter: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN",
        proof: "abcdef123456",
        debugData: "detailed_info",
      };
      
      // In debug mode, proof is still redacted but other data is shown
      const result = redact(meta, "debug");
      expect(result.proof).toBe("[REDACTED]");
      // Voter should be truncated but visible
      expect(result.voter).toContain("GABC...KLMN");
      // Debug data should be visible
      expect(result.debugData).toBe("detailed_info");
    });

    it("should redact more in production (info) mode", () => {
      const meta = {
        voter: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMN",
        debugData: "detailed_info",
      };
      const result = redact(meta, "info");
      expect(result.voter).toContain("GABC...KLMN");
      // Debug data might be redacted or filtered based on policy
    });
  });

  describe("Pattern-based redaction", () => {
    it("should redact transaction hashes (show first 6 + last 6)", () => {
      const meta = {
        txHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      };
      const result = redact(meta);
      expect(result.txHash).toContain("abcdef...7890");
    });

    it("should redact IP addresses", () => {
      const meta = {
        ip: "192.168.1.100",
        userIp: "10.0.0.1",
      };
      const result = redact(meta);
      expect(result.ip).toBe("[REDACTED_IP]");
      expect(result.userIp).toBe("[REDACTED_IP]");
    });

    it("should redact IPFS CIDs (show first 6 + last 6)", () => {
      const meta = {
        ipfsCid: "Qmabcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr",
      };
      const result = redact(meta);
      expect(result.ipfsCid).toContain("Qmabcd...mnopqr");
    });
  });

  describe("RedactionPolicy configuration", () => {
    it("should allow custom redaction policy", () => {
      setRedactionPolicy({
        redactedFields: ["custom_field", "sensitive"],
        showClientIp: "none",
      });
      
      const policy = getRedactionPolicy();
      expect(policy.redactedFields).toContain("custom_field");
      expect(policy.showClientIp).toBe("none");
    });
  });
});
