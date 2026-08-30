//! Nova Aggregator CLI Binary
//!
//! Provides command-line entrypoint for off-chain aggregation service
//! to load vote witnesses, run IVC folding, and output compressed proofs.

use clap::Parser;
use nova_aggregator::{IvcState, NovaAggregator, RecursiveProofPayload, VoteWitness};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Parser, Debug)]
#[command(author, version, about = "Nova IVC Recursive Vote Aggregator CLI")]
struct Args {
    /// Path to JSON file containing vote witnesses array
    #[arg(short, long)]
    batch: PathBuf,

    /// Path to output JSON file for recursive proof payload
    #[arg(short, long)]
    out: PathBuf,

    /// Merkle tree root (hex string)
    #[arg(
        short,
        long,
        default_value = "0x0000000000000000000000000000000000000000000000000000000000000000"
    )]
    root: String,

    /// Run in benchmark mode and print timing metrics
    #[arg(long, default_value_t = false)]
    benchmark: bool,
}

fn main() {
    let args = Args::parse();

    println!(
        "[NovaAggregator] Loading vote witnesses from {:?}",
        args.batch
    );
    let batch_content =
        fs::read_to_string(&args.batch).expect("Failed to read vote batch JSON file");

    let witnesses: Vec<VoteWitness> =
        serde_json::from_str(&batch_content).expect("Failed to parse vote witnesses JSON array");

    println!(
        "[NovaAggregator] Successfully loaded {} vote witnesses",
        witnesses.len()
    );

    let initial_state = IvcState {
        step_count: 0,
        root: args.root,
        yes_votes: 0,
        no_votes: 0,
        acc_nullifier_hash: String::from(
            "0x0000000000000000000000000000000000000000000000000000000000000000",
        ),
    };

    let start_time = Instant::now();
    let payload: RecursiveProofPayload = NovaAggregator::aggregate_batch(initial_state, &witnesses)
        .expect("Failed to perform Nova IVC aggregation");
    let duration = start_time.elapsed();

    println!(
        "[NovaAggregator] Completed aggregation of {} votes in {:?}",
        payload.num_votes, duration
    );
    println!(
        "[NovaAggregator] Final Tally: YES={}, NO={}",
        payload.final_state.yes_votes, payload.final_state.no_votes
    );
    println!("[NovaAggregator] Proof bytes: {}", payload.proof_bytes);

    if args.benchmark {
        let avg_step_time = if payload.num_votes > 0 {
            duration.as_micros() as f64 / payload.num_votes as f64
        } else {
            0.0
        };
        println!("--- BENCHMARK RESULTS ---");
        println!("Total Votes: {}", payload.num_votes);
        println!("Total Proving Time: {} ms", duration.as_millis());
        println!("Avg Step Proving Time: {:.2} us/vote", avg_step_time);
        println!("Compressed Proof Size: {} bytes", payload.proof_bytes.len());
        println!("-------------------------");
    }

    let output_content = serde_json::to_string_pretty(&payload)
        .expect("Failed to serialize recursive proof payload");

    fs::write(&args.out, output_content).expect("Failed to write output proof file");

    println!("[NovaAggregator] Written recursive proof to {:?}", args.out);
}
