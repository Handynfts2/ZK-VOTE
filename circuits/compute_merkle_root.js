const circomlibjs = require('circomlibjs');

(async function() {
  const poseidon = await circomlibjs.buildPoseidon();

  // Leaf domain-separation tag (#167): every leaf is hashed with this tag
  // before entering the tree, so a raw commitment (or a forged internal-node
  // hash) is never inserted directly as a tree value. Must match LEAF_DOMAIN
  // in merkle_tree.circom and contracts/membership-tree/src/lib.rs.
  const LEAF_DOMAIN = 1n;

  // Commitment: Poseidon(12345, 67890)
  const commitment = poseidon.F.toObject(poseidon([12345n, 67890n]));
  console.log('Commitment: 0x' + commitment.toString(16).padStart(64, '0'));

  // Domain-tagged leaf hash — this, not the raw commitment, is what actually
  // enters the tree as the depth-`levels` value.
  const leafHash = poseidon.F.toObject(poseidon([LEAF_DOMAIN, commitment]));
  console.log('Leaf hash (domain-tagged): 0x' + leafHash.toString(16).padStart(64, '0'));

  // Compute zero values for each level. zeros[0] is the domain-tagged hash
  // of the empty leaf (commitment 0), not raw 0.
  const zeros = [poseidon.F.toObject(poseidon([LEAF_DOMAIN, 0n]))];
  let currentZero = zeros[0];
  for (let i = 0; i < 20; i++) {
    currentZero = poseidon.F.toObject(poseidon([currentZero, currentZero]));
    zeros.push(currentZero);
  }

  console.log('\nZero values:');
  console.log('zeros[0]:', '0x' + zeros[0].toString(16).padStart(64, '0'));
  console.log('zeros[1]:', '0x' + zeros[1].toString(16).padStart(64, '0'));
  console.log('zeros[2]:', '0x' + zeros[2].toString(16).padStart(64, '0'));
  console.log('...');
  console.log('zeros[19]:', '0x' + zeros[19].toString(16).padStart(64, '0'));

  // Simulate inserting commitment at index 0 — starting from the
  // domain-tagged leaf hash, not the raw commitment.
  let currentHash = leafHash;
  let index = 0;
  const depth = 20;

  console.log('\nInserting commitment at index 0:');
  console.log('Starting with: 0x' + currentHash.toString(16).padStart(64, '0'));

  for (let i = 0; i < depth; i++) {
    if (index % 2 === 0) {
      // Left child
      const newHash = poseidon.F.toObject(poseidon([currentHash, zeros[i]]));
      console.log(`Level ${i}: hash(current, zeros[${i}]) = 0x${newHash.toString(16).padStart(64, '0')}`);
      currentHash = newHash;
    } else {
      // Right child (won't happen for index 0)
      console.log(`Level ${i}: RIGHT (shouldn't happen for index 0!)`);
    }
    index = Math.floor(index / 2);
  }

  console.log('\n=== EXPECTED ROOT (circomlib calculation) ===');
  console.log('0x' + currentHash.toString(16).padStart(64, '0'));
})();
