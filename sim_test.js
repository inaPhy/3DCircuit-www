const L = 1;
const g = 0.016 / L;
const Vs = 1.5;
const R = 10;
let iprev = 0;

for (let i=0; i<10; i++) {
    // V2 is node between R and L.
    // Node 1 (Vs), Node 2. Inductor from 2 to 0. Resistor from 1 to 2.
    // (V2 - 1.5)/10 + g*V2 + iprev = 0
    // V2(0.1 + g) = 0.15 - iprev
    let V2 = (0.15 - iprev) / (0.1 + g);
    let i_curr = g * V2 + iprev;
    console.log(`t=${i}, V2=${V2.toFixed(3)}, I=${i_curr.toFixed(3)}`);
    iprev = i_curr;
}
