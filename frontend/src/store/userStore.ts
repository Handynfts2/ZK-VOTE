/**
 * Hardened User Store
 * Sensitive auth token stored in isolated closure outside state tree.
 */

import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  encryptData,
  decryptData,
  sanitizeState,
} from "./secureStorage";

export interface UserState {
  address: string | null;
  isConnected: boolean;
  daoMemberships: string[];
}

const STORAGE_KEY = "zkvote_user_store";

let state: UserState = {
  address: null,
  isConnected: false,
  daoMemberships: [],
};

const listeners = new Set<() => void>();

export const userStore = {
  getState: (): UserState => state,
  getAuthToken,
  setAuthToken,

  setUser: (address: string, token?: string, memberships: string[] = []) => {
    state = {
      address,
      isConnected: true,
      daoMemberships: memberships,
    };
    if (token) setAuthToken(token);
    // Persist encrypted non-sensitive user state
    try {
      if (typeof window !== "undefined") {
        const encrypted = encryptData({ address, daoMemberships: memberships });
        localStorage.setItem(STORAGE_KEY, encrypted);
      }
    } catch {
      // ignore persistence error
    }
    listeners.forEach((l) => l());
  },

  clearUser: () => {
    state = {
      address: null,
      isConnected: false,
      daoMemberships: [],
    };
    clearAuthToken();
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    listeners.forEach((l) => l());
  },

  loadPersisted: () => {
    try {
      if (typeof window !== "undefined") {
        const item = localStorage.getItem(STORAGE_KEY);
        if (item) {
          const restored = decryptData<{
            address: string;
            daoMemberships: string[];
          }>(item);
          if (restored?.address) {
            state = {
              address: restored.address,
              isConnected: true,
              daoMemberships: restored.daoMemberships || [],
            };
            listeners.forEach((l) => l());
          }
        }
      }
    } catch {
      // ignore
    }
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSanitizedState: () =>
    sanitizeState(state as unknown as Record<string, unknown>),
};
