import { useState } from "react";

export interface VoterReceipt {
  id: string; // Unique identifier, can be txHash
  txHash: string;
  nullifier: string; // The nullifier (hex string)
  timestamp: number; // Unix timestamp in ms
  daoId: number;
  proposalId: number;
}

const STORAGE_KEY = "zkvote-receipts";

export function useReceipts() {
  const [receipts, setReceipts] = useState<VoterReceipt[]>(() => {
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          return JSON.parse(stored);
        }
      }
    } catch (err) {
      console.error("Failed to load receipts from localStorage", err);
    }
    return [];
  });

  const addReceipt = (receipt: Omit<VoterReceipt, "id">) => {
    const newReceipt = { ...receipt, id: receipt.txHash };
    setReceipts((prev) => {
      // Avoid duplicates
      if (prev.some((r) => r.id === newReceipt.id)) return prev;
      const updated = [newReceipt, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const importReceipts = (imported: VoterReceipt[]) => {
    setReceipts((prev) => {
      const existingIds = new Set(prev.map((r) => r.id));
      const newReceipts = imported.filter((r) => !existingIds.has(r.id));
      const updated = [...newReceipts, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const clearReceipts = () => {
    setReceipts([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return { receipts, addReceipt, removeReceipt, importReceipts, clearReceipts };
}
