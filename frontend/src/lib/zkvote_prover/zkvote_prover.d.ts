/* tslint:disable */
/* eslint-disable */
/**
 * Generate a Groth16 proof from a decimal JSON witness array.
 *
 * * `zkey_bytes` — the `.zkey` proving key (same file snarkjs uses).
 * * `witness_json` — JSON array of decimal bigint strings (the circuit witness,
 *   position 0 = the `1` signal).
 */
export function prove(zkey_bytes: Uint8Array, witness_json: string): any;
/**
 * Initialize the WASM module (installs a panic hook that logs to the console).
 */
export function init(): void;
/**
 * Generate a Groth16 proof from a binary `.wtns` witness file.
 *
 * * `zkey_bytes` — the `.zkey` proving key (same file snarkjs uses).
 * * `wtns_bytes` — the binary `.wtns` witness (snarkjs `wtns_calculate` output).
 *
 * This is the preferred entry point from the browser: the frontend computes the
 * witness with the circom WASM (via snarkjs's `wtns_calculate`) and passes the
 * raw bytes straight to Rust, avoiding any decimal JSON round-trip.
 */
export function prove_wtns(zkey_bytes: Uint8Array, wtns_bytes: Uint8Array): any;

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly init: () => void;
  readonly prove: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
  ) => void;
  readonly prove_wtns: (
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
  ) => void;
  readonly __wbindgen_export: (a: number, b: number) => number;
  readonly __wbindgen_export2: (
    a: number,
    b: number,
    c: number,
    d: number,
  ) => number;
  readonly __wbindgen_export3: (a: number) => void;
  readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(
  module: { module: SyncInitInput } | SyncInitInput,
): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<InitOutput>;
