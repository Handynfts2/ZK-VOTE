//! Rust witness generation: runs a compiled Circom2 witness-calculator WASM
//! inside `wasmtime` to compute the circuit witness. This replaces the JS
//! `circom_runtime` step in the default proving path.
//!
//! Only built with the `witness` feature (native CLI / e2e context). The
//! browser build uses the `wasm` feature and drives the circuit's compiled WASM
//! directly, so `wasmtime` is never pulled into the client bundle.

use std::collections::HashMap;

use num_bigint::BigInt;
use num_traits::ToPrimitive;
use wasmtime::{
    Caller, Config, Engine, Extern, Instance, Linker, Memory, MemoryType, Module, Store, Val,
};

use crate::field::{bigint_to_fr, Fr, SCALAR_MODULUS};

#[derive(Default)]
struct Host {
    error: Option<String>,
}

/// FNV-1a (64-bit) hash, matching `circom_runtime`'s `fnvHash`. Split into
/// `(hMSB, hLSB)` of 32 bits for the `setInputSignal` call.
fn fnv_hash(s: &str) -> u64 {
    let mut h: u64 = 0xCBF29CE484222325;
    for c in s.chars() {
        h ^= (c as u8) as u64;
        h = h.wrapping_mul(0x100000001B3);
    }
    h
}

/// Reduce `v` modulo the BN254 scalar prime into `[0, q)`.
fn norm(v: &BigInt, prime: &BigInt) -> BigInt {
    let mut v = v % prime;
    if v < BigInt::from(0) {
        v += prime;
    }
    v
}

fn call_export(
    store: &mut Store<Host>,
    instance: &Instance,
    name: &str,
    args: &[i32],
) -> Result<i32, String> {
    let func = instance
        .get_func(&mut *store, name)
        .ok_or_else(|| format!("witness wasm missing export `{name}`"))?;
    let nres = func.ty(&*store).results().len();
    let params: Vec<Val> = args.iter().map(|&a| Val::I32(a)).collect();
    if nres == 0 {
        let mut res: [Val; 0] = [];
        func.call(&mut *store, &params, &mut res)
            .map_err(|e| e.to_string())?;
        Ok(0)
    } else {
        let mut res = [Val::I32(0)];
        func.call(&mut *store, &params, &mut res)
            .map_err(|e| e.to_string())?;
        Ok(res[0].i32().unwrap_or(0))
    }
}

/// Compute the circuit witness by executing `wasm_bytes` (a Circom2
/// witness-calculator WASM) against the JSON `input` object
/// (`{ "signal": value | [values], ... }`).
pub fn calculate_witness(wasm_bytes: &[u8], input: &str) -> Result<Vec<Fr>, String> {
    let input_json: serde_json::Value =
        serde_json::from_str(input).map_err(|e| format!("input json: {e}"))?;
    let input_map = parse_input(&input_json)?;

    let engine = Engine::new(&Config::new()).map_err(|e| e.to_string())?;
    let module = Module::new(&engine, wasm_bytes).map_err(|e| e.to_string())?;

    let mut store = Store::new(&engine, Host::default());
    let mut linker = Linker::new(&engine);

    // The module imports its linear memory from `env.memory`.
    let min_pages = module
        .imports()
        .find_map(|imp| match imp.ty() {
            wasmtime::ExternType::Memory(mt) => Some(mt.minimum()),
            _ => None,
        })
        .unwrap_or(1);
    let memory = Memory::new(&mut store, MemoryType::new(min_pages as u32, Some(32767)))
        .map_err(|e| e.to_string())?;
    linker
        .define(&mut store, "env", "memory", Extern::Memory(memory))
        .map_err(|e| e.to_string())?;

    // `runtime.*` host callbacks. Most are no-ops; errors are captured so we can
    // surface a clear failure instead of silently producing a bad witness.
    linker
        .func_wrap("runtime", "printDebug", |_c: Caller<'_, Host>, _v: i32| {})
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "exceptionHandler",
            |mut c: Caller<'_, Host>, code: i32| {
                c.data_mut().error = Some(format!("circom exception (code {code})"));
            },
        )
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap("runtime", "printErrorMessage", |_c: Caller<'_, Host>| {})
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap("runtime", "writeBufferMessage", |_c: Caller<'_, Host>| {})
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap("runtime", "showSharedRWMemory", |_c: Caller<'_, Host>| {})
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "error",
            |mut c: Caller<'_, Host>, code: i32, _p: i32, _a: i32, _b: i32, _cc: i32, _d: i32| {
                c.data_mut().error = Some(format!("circom error (code {code})"));
            },
        )
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap("runtime", "log", |_c: Caller<'_, Host>, _a: i32| {})
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "logGetSignal",
            |_c: Caller<'_, Host>, _s: i32, _p: i32| {},
        )
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "logSetSignal",
            |_c: Caller<'_, Host>, _s: i32, _p: i32| {},
        )
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "logStartComponent",
            |_c: Caller<'_, Host>, _i: i32| {},
        )
        .map_err(|e| e.to_string())?;
    linker
        .func_wrap(
            "runtime",
            "logFinishComponent",
            |_c: Caller<'_, Host>, _i: i32| {},
        )
        .map_err(|e| e.to_string())?;

    let instance = linker
        .instantiate(&mut store, &module)
        .map_err(|e| e.to_string())?;

    let _version = call_export(&mut store, &instance, "getVersion", &[])?;

    let n32 = call_export(&mut store, &instance, "getFieldNumLen32", &[])? as usize;
    let prime = SCALAR_MODULUS
        .parse::<BigInt>()
        .map_err(|e| format!("prime parse: {e}"))?;

    // init(sanity=0)
    call_export(&mut store, &instance, "init", &[0])?;

    let input_size = call_export(&mut store, &instance, "getInputSize", &[])?;
    let mut counter = 0i32;

    for (k, vals) in &input_map {
        let h = fnv_hash(k);
        let h_msb = ((h >> 32) & 0xFFFF_FFFF) as i32;
        let h_lsb = (h & 0xFFFF_FFFF) as i32;

        let signal_size =
            call_export(&mut store, &instance, "getInputSignalSize", &[h_msb, h_lsb])?;
        if signal_size < 0 {
            return Err(format!("input signal `{k}` not found"));
        }
        if (vals.len() as i32) < signal_size {
            return Err(format!("not enough values for input `{k}`"));
        }
        if (vals.len() as i32) > signal_size {
            return Err(format!("too many values for input `{k}`"));
        }

        for (i, val) in vals.iter().enumerate() {
            let x = norm(val, &prime);
            // Write the field element into shared RW memory as little-endian words
            // (position 0 = least-significant word), matching this Circom2 build.
            for j in 0..n32 {
                let shift = 32 * j;
                let word = ((&x >> shift) & BigInt::from(0xFFFF_FFFFu64))
                    .to_u32()
                    .ok_or_else(|| "witness word overflow".to_string())?
                    as i32;
                call_export(
                    &mut store,
                    &instance,
                    "writeSharedRWMemory",
                    &[j as i32, word],
                )?;
            }
            call_export(
                &mut store,
                &instance,
                "setInputSignal",
                &[h_msb, h_lsb, i as i32],
            )?;
            counter += 1;
        }
    }

    if counter < input_size {
        return Err(format!(
            "not all inputs set: only {counter} of {input_size}"
        ));
    }

    let witness_size = call_export(&mut store, &instance, "getWitnessSize", &[])? as usize;
    let mut witness = Vec::with_capacity(witness_size);
    for i in 0..witness_size {
        call_export(&mut store, &instance, "getWitness", &[i as i32])?;
        // Little-endian limb order (position 0 = least-significant word).
        let mut v = BigInt::from(0u64);
        for j in 0..n32 {
            let w = call_export(&mut store, &instance, "readSharedRWMemory", &[j as i32])? as u32
                as u64;
            v += BigInt::from(w) << (32 * j);
        }
        witness.push(bigint_to_fr(&v));
    }

    if let Some(err) = store.data().error.clone() {
        return Err(format!("witness calculation failed: {err}"));
    }

    Ok(witness)
}

fn parse_input(json: &serde_json::Value) -> Result<HashMap<String, Vec<BigInt>>, String> {
    let obj = json
        .as_object()
        .ok_or_else(|| "circuit input must be a JSON object".to_string())?;
    let mut map = HashMap::new();
    for (k, v) in obj {
        let arr = value_to_bigints(v)?;
        map.insert(k.clone(), arr);
    }
    Ok(map)
}

fn value_to_bigints(v: &serde_json::Value) -> Result<Vec<BigInt>, String> {
    match v {
        serde_json::Value::Array(a) => {
            let mut out = Vec::with_capacity(a.len());
            for e in a {
                out.push(value_to_bigint(e)?);
            }
            Ok(out)
        }
        _ => Ok(vec![value_to_bigint(v)?]),
    }
}

fn value_to_bigint(v: &serde_json::Value) -> Result<BigInt, String> {
    match v {
        serde_json::Value::String(s) => BigInt::parse_bytes(s.as_bytes(), 10)
            .ok_or_else(|| format!("invalid decimal integer: {s}")),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(BigInt::from(i))
            } else {
                Err(format!("unsupported number: {n}"))
            }
        }
        _ => Err(format!("unsupported input value: {v}")),
    }
}
