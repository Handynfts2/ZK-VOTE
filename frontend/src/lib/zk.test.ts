import { describe, expect, it } from "vitest";
import {
  buildDidAttributeCircuitInput,
  buildReputationAttestationCircuitInput,
} from "./zk";

describe("ZK attribute and reputation input builders", () => {
  it("builds DID attribute circuit inputs without vote identifiers", async () => {
    const input = await buildDidAttributeCircuitInput({
      issuerId: "11",
      attributeKey: "22",
      minAttributeValue: "30",
      signedClaimHash: "33",
      attributeValue: "90",
      claimSalt: "44",
    });

    expect(input.issuerId).toBe("11");
    expect(input.minAttributeValue).toBe("30");
    expect(input.attributeValue).toBe("90");
    expect(BigInt(input.attributeNullifier)).toBeGreaterThan(0n);
    expect("daoId" in input).toBe(false);
    expect("proposalId" in input).toBe(false);
  });

  it("builds scoped reputation nullifier and commitment inputs", async () => {
    const input = await buildReputationAttestationCircuitInput({
      sourceDaoId: "1",
      targetDaoId: "2",
      attesterKeyHash: "3",
      minScore: "50",
      subjectSecret: "4",
      score: "77",
      attestationSalt: "5",
      revocationNonce: "6",
    });

    expect(input.sourceDaoId).toBe("1");
    expect(input.targetDaoId).toBe("2");
    expect(input.minScore).toBe("50");
    expect(BigInt(input.attestationCommitment)).toBeGreaterThan(0n);
    expect(BigInt(input.reputationNullifier)).toBeGreaterThan(0n);
  });
});
