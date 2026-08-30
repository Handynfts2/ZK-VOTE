/**
 * Hardened Election Store
 * Unsubmitted vote choices and sensitive proposal details stored securely.
 */

import { sanitizeState } from "./secureStorage";

export interface ElectionState {
  activeDaoId: string | null;
  activeProposalId: string | null;
  unsubmittedVoteChoices: Record<string, number>; // proposalId -> option index
}

let state: ElectionState = {
  activeDaoId: null,
  activeProposalId: null,
  unsubmittedVoteChoices: {},
};

const listeners = new Set<() => void>();

export const electionStore = {
  getState: (): ElectionState => state,

  setActiveDao: (daoId: string | null) => {
    state = { ...state, activeDaoId: daoId };
    listeners.forEach((l) => l());
  },

  setUnsubmittedVote: (proposalId: string, choiceIndex: number) => {
    state = {
      ...state,
      unsubmittedVoteChoices: {
        ...state.unsubmittedVoteChoices,
        [proposalId]: choiceIndex,
      },
    };
    listeners.forEach((l) => l());
  },

  clearUnsubmittedVote: (proposalId: string) => {
    const updated = { ...state.unsubmittedVoteChoices };
    delete updated[proposalId];
    state = { ...state, unsubmittedVoteChoices: updated };
    listeners.forEach((l) => l());
  },

  clearElectionStore: () => {
    state = {
      activeDaoId: null,
      activeProposalId: null,
      unsubmittedVoteChoices: {},
    };
    listeners.forEach((l) => l());
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSanitizedState: () =>
    sanitizeState(state as unknown as Record<string, unknown>),
};
