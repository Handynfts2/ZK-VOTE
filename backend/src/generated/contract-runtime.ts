/**
 * Generated compatibility metadata for deployed contract runtimes.
 *
 * Keep this file in sync with contract `version()` / `storage_version()`
 * entrypoints whenever a protocol upgrade changes contract or storage layout.
 */

export interface ContractRuntimeCompatibility {
  contract:
    | "dao-registry"
    | "membership-sbt"
    | "membership-tree"
    | "voting"
    | "comments";
  minSupportedContractVersion: number;
  maxSupportedContractVersion: number;
  minSupportedStorageVersion: number;
  maxSupportedStorageVersion: number;
}

export const CONTRACT_RUNTIME_COMPATIBILITY = {
  voting: {
    contract: "voting",
    minSupportedContractVersion: 2,
    maxSupportedContractVersion: 2,
    minSupportedStorageVersion: 1,
    maxSupportedStorageVersion: 1,
  },
  daoRegistry: {
    contract: "dao-registry",
    minSupportedContractVersion: 1,
    maxSupportedContractVersion: 1,
    minSupportedStorageVersion: 1,
    maxSupportedStorageVersion: 1,
  },
} as const satisfies Record<string, ContractRuntimeCompatibility>;
