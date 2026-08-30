pragma circom 2.0.0;
include "node_modules/circomlib/circuits/poseidon.circom";
template TestP() {
  signal input a;
  signal input b;
  signal input c;
  signal output out;
  component p = Poseidon(3);
  p.inputs[0] <== a;
  p.inputs[1] <== b;
  p.inputs[2] <== c;
  out <== p.out;
}
component main {public [a,b,c]} = TestP();
