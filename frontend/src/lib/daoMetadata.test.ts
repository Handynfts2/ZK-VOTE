import { describe, it, expect } from "vitest";
import { isValidHexColor, validateDAOMetadata } from "./daoMetadata";

describe("isValidHexColor (issue #389 — DAO theme color)", () => {
  it("accepts strict 6-digit hex colors", () => {
    expect(isValidHexColor("#3b82f6")).toBe(true);
    expect(isValidHexColor("#FFFFFF")).toBe(true);
    expect(isValidHexColor("#000000")).toBe(true);
  });

  it("rejects shapes that aren't a bare 6-digit hex color", () => {
    expect(isValidHexColor("#fff")).toBe(false); // 3-digit shorthand not accepted
    expect(isValidHexColor("3b82f6")).toBe(false); // missing '#'
    expect(isValidHexColor("red")).toBe(false); // named color
    expect(isValidHexColor("#3b82f6ff")).toBe(false); // 8-digit with alpha
    expect(isValidHexColor("")).toBe(false);
  });

  it("rejects CSS-injection attempts disguised as a color value", () => {
    expect(isValidHexColor("red; } body { display: none")).toBe(false);
    expect(isValidHexColor("url(javascript:alert(1))")).toBe(false);
    expect(isValidHexColor("expression(alert(1))")).toBe(false);
    expect(isValidHexColor("#3b82f6; background: url(evil.com)")).toBe(false);
  });
});

describe("validateDAOMetadata themeColor validation", () => {
  it("passes for a valid or absent theme color", () => {
    expect(validateDAOMetadata({ description: "" })).toEqual([]);
    expect(
      validateDAOMetadata({ description: "", themeColor: "#3b82f6" }),
    ).toEqual([]);
  });

  it("reports an error for an invalid theme color", () => {
    const errors = validateDAOMetadata({
      description: "",
      themeColor: "not-a-color",
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.toLowerCase().includes("theme color"))).toBe(
      true,
    );
  });
});
