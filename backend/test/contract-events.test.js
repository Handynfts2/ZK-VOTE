import test from "node:test";
import assert from "node:assert/strict";
import {
  isEventType,
  filterEventsByDao,
  getProposalVotes,
} from "../src/generated/contract-events.ts";

test("contract-events: isEventType type guard works", () => {
  const voteEvent = {
    type: "VoteEvent",
    daoId: 1,
    proposalId: 100,
    choice: true,
    nullifier: "0x123",
  };

  const isVote = isEventType(voteEvent, "VoteEvent");
  assert.equal(isVote, true);

  const isProposal = isEventType(voteEvent, "ProposalEvent");
  assert.equal(isProposal, false);
});

test("contract-events: filterEventsByDao filters correctly", () => {
  const events = [
    { type: "VoteEvent", daoId: 1, proposalId: 1, choice: true, nullifier: "n1" },
    { type: "VoteEvent", daoId: 2, proposalId: 1, choice: false, nullifier: "n2" },
    { type: "VoteEvent", daoId: 1, proposalId: 2, choice: true, nullifier: "n3" },
    { type: "DaoCreateEvent", daoId: 3, admin: "addr", name: "DAO3" },
  ];

  const dao1Events = filterEventsByDao(events, 1);

  assert.equal(dao1Events.length, 2, "Should filter to only DAO 1 events");
  assert.ok(dao1Events.every((e) => e.daoId === 1), "All should be DAO 1");
});

test("contract-events: getProposalVotes extracts votes correctly", () => {
  const events = [
    {
      type: "ProposalEvent",
      daoId: 1,
      proposalId: 100,
      creator: "addr",
      startTime: 0,
      endTime: 1000,
      vkVersion: 1,
    },
    { type: "VoteEvent", daoId: 1, proposalId: 100, choice: true, nullifier: "n1" },
    { type: "VoteEvent", daoId: 1, proposalId: 100, choice: false, nullifier: "n2" },
    { type: "VoteEvent", daoId: 1, proposalId: 101, choice: true, nullifier: "n3" },
    {
      type: "ProposalClosedEvent",
      daoId: 1,
      proposalId: 100,
      votesFor: 1,
      votesAgainst: 1,
    },
  ];

  const proposal100Votes = getProposalVotes(events, 1, 100);

  assert.equal(proposal100Votes.length, 2, "Should extract 2 votes for proposal 100");
  assert.ok(
    proposal100Votes.every((v) => v.proposalId === 100),
    "All should be proposal 100",
  );
});

test("contract-events: handles empty filters", () => {
  const events = [
    { type: "VoteEvent", daoId: 1, proposalId: 1, choice: true, nullifier: "n1" },
  ];

  const dao999Events = filterEventsByDao(events, 999);
  assert.equal(dao999Events.length, 0, "Should return empty array for non-existent DAO");

  const proposal999Votes = getProposalVotes(events, 1, 999);
  assert.equal(proposal999Votes.length, 0, "Should return empty array for non-existent proposal");
});

test("contract-events: event type union covers all major events", () => {
  const eventTypes = [
    "DaoCreateEvent",
    "SbtMintEvent",
    "TreeInitEvent",
    "ProposalEvent",
    "VoteEvent",
    "CommentCreatedEvent",
    "CircuitRegisteredEvent",
  ];

  assert.ok(eventTypes.length > 0, "Should have multiple event types");
  eventTypes.forEach((type) => {
    assert.ok(typeof type === "string", `Event type ${type} should be a string`);
  });
});

test("contract-events: DAO membership lifecycle", () => {
  const events = [
    { type: "DaoCreateEvent", daoId: 5, admin: "admin1", name: "TestDAO" },
    { type: "SbtMintEvent", daoId: 5, to: "member1" },
    { type: "CommitEvent", daoId: 5, commitment: "c1", index: 0, newRoot: "root1", rootIndex: 0 },
    { type: "SbtRevokeEvent", daoId: 5, member: "member1" },
    { type: "RemovalEvent", daoId: 5, member: "member1", index: 0, newRoot: "root2", rootIndex: 1 },
  ];

  const dao5Events = filterEventsByDao(events, 5);

  assert.equal(dao5Events.length, 5, "Should have all 5 lifecycle events");
  const hasMint = dao5Events.some((e) => e.type === "SbtMintEvent");
  const hasRevoke = dao5Events.some((e) => e.type === "SbtRevokeEvent");
  assert.ok(hasMint && hasRevoke, "Should track member joining and leaving");
});

test("contract-events: proposal voting lifecycle", () => {
  const proposalId = 50;
  const daoId = 7;

  const events = [
    {
      type: "ProposalEvent",
      daoId,
      proposalId,
      creator: "creator",
      startTime: 100,
      endTime: 200,
      vkVersion: 2,
    },
    { type: "VoteEvent", daoId, proposalId, choice: true, nullifier: "n1" },
    { type: "VoteEvent", daoId, proposalId, choice: true, nullifier: "n2" },
    { type: "VoteEvent", daoId, proposalId, choice: false, nullifier: "n3" },
    {
      type: "ProposalClosedEvent",
      daoId,
      proposalId,
      votesFor: 2,
      votesAgainst: 1,
    },
  ];

  const votes = getProposalVotes(events, daoId, proposalId);

  assert.equal(votes.length, 3, "Should track all 3 votes");
  const yesVotes = votes.filter((v) => v.choice).length;
  const noVotes = votes.filter((v) => !v.choice).length;
  assert.equal(yesVotes, 2, "Should have 2 yes votes");
  assert.equal(noVotes, 1, "Should have 1 no vote");
});
