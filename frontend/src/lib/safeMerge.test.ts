import { describe, it, expect } from "vitest";
import { isSafeKey, safeClone, safeMerge, safeJsonParse } from "./safeMerge";

describe("safeMerge and Prototype Pollution Protections", () => {
  it("correctly identifies safe vs unsafe keys", () => {
    expect(isSafeKey("name")).toBe(true);
    expect(isSafeKey("__proto__")).toBe(false);
    expect(isSafeKey("constructor")).toBe(false);
    expect(isSafeKey("prototype")).toBe(false);
    expect(isSafeKey("__foo")).toBe(false);
  });

  it("safeClone strips prototype pollution keys", () => {
    const malicious = JSON.parse(
      '{"name":"test","__proto__":{"polluted":true}}',
    );
    const cloned = safeClone(malicious);
    expect(cloned.name).toBe("test");
    expect(({} as any).polluted).toBeUndefined();
  });

  it("safeMerge merges objects safely without prototype pollution", () => {
    const base = { a: 1, nested: { b: 2 } };
    const malicious = JSON.parse(
      '{"__proto__":{"polluted":true},"nested":{"c":3}}',
    );
    const merged = safeMerge(base, malicious);

    expect(merged.a).toBe(1);
    expect(merged.nested).toEqual({ b: 2, c: 3 });
    expect(({} as any).polluted).toBeUndefined();
  });

  it("safeJsonParse strips prototype pollution keys during parsing", () => {
    const jsonStr = '{"title":"DAO","__proto__":{"isAdmin":true}}';
    const parsed = safeJsonParse<{ title: string }>(jsonStr);
    expect(parsed?.title).toBe("DAO");
    expect(({} as any).isAdmin).toBeUndefined();
  });
});
