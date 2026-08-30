use criterion::{criterion_group, criterion_main, Criterion};
use nova_aggregator::{IvcState, NovaAggregator, VoteStepCircuit, VoteWitness};

fn benchmark_nova_folding(c: &mut Criterion) {
    let initial_state = IvcState::default();

    let witness_1k: Vec<VoteWitness> = (0..1000)
        .map(|i| VoteWitness {
            secret: format!("secret_{}", i),
            salt: format!("salt_{}", i),
            path_elements: vec![],
            path_indices: vec![],
            vote_choice: (i % 2) as u8,
            nullifier: VoteStepCircuit::compute_nullifier(&format!("secret_{}", i), 1, 100),
            dao_id: 1,
            proposal_id: 100,
        })
        .collect();

    c.bench_function("nova_fold_1k_votes", |b| {
        b.iter(|| {
            NovaAggregator::aggregate_batch(initial_state.clone(), &witness_1k).unwrap();
        });
    });
}

criterion_group!(benches, benchmark_nova_folding);
criterion_main!(benches);
