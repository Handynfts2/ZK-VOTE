import { describe, it, expect } from "vitest";
import { PROPOSAL_TEMPLATES, getProposalTemplate } from "./proposalTemplates";

describe("PROPOSAL_TEMPLATES (issue #383)", () => {
  it("only uses vote modes CreateProposalForm actually supports", () => {
    for (const template of PROPOSAL_TEMPLATES) {
      expect(["fixed", "trailing"]).toContain(template.voteMode);
    }
  });

  it("has unique, non-empty ids", () => {
    const ids = PROPOSAL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("has a positive deadline for every template", () => {
    for (const template of PROPOSAL_TEMPLATES) {
      expect(template.deadlineSeconds).toBeGreaterThan(0);
    }
  });
});

describe("getProposalTemplate", () => {
  it("returns the matching template by id", () => {
    const template = getProposalTemplate("quick-poll");
    expect(template).toBeDefined();
    expect(template?.voteMode).toBe("fixed");
  });

  it("returns undefined for an unknown id", () => {
    expect(getProposalTemplate("does-not-exist")).toBeUndefined();
  });
});
