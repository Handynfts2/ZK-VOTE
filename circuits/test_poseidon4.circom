pragma circom 2.0.0;
include "node_modules/circomlib/circuits/poseidon.circom";
template TestP4() {
  signal input a; signal input b; signal input c; signal input d;
  signal output out;
  component p = Poseidon(4);
  p.inputs[0] <== a; p.inputs[1] <== b; p.inputs[2] <== c; p.inputs[3] <== d;
  out <== p.out;
}
component main {public [a,b,c,d]} = TestP4();
