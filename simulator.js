/**
 * Circuit Simulator using Modified Nodal Analysis (MNA)
 */

class Simulator {
    constructor() {
        this.nodes = [];
        this.components = [];
        this.results = null;
        this.history = {
            voltages: {}, // compID -> voltage from previous step
            currents: {}  // compID -> current from previous step
        };
        this.time = 0;
    }

    reset() {
        this.results = null;
        this.history = { voltages: {}, currents: {} };
        this.time = 0;
    }

    /**
     * Solves the circuit
     * @param {Array} netlist - List of components with {type, nodes: [n1, n2], value}
     * @param {Number} dt - Time step in seconds (0 for DC steady state)
     * @returns {Object} result - {success, message, voltages, currents}
     */
    solve(netlist, dt = 0) {
        if (dt > 0) this.time += dt;
        if (netlist.length === 0) {
            return { success: false, message: "素子が配置されていません。" };
        }

        try {
            // 1. Identify unique nodes and connected components
            const nodes = Array.from(new Set(netlist.flatMap(c => c.nodes)));
            if (nodes.length < 2) {
                return { success: false, message: "回路が接続されていません。" };
            }

            const adj = new Map();
            nodes.forEach(n => adj.set(n, []));
            netlist.forEach(c => {
                adj.get(c.nodes[0]).push(c.nodes[1]);
                adj.get(c.nodes[1]).push(c.nodes[0]);
            });

            const visited = new Set();
            const componentsList = [];
            nodes.forEach(n => {
                if (!visited.has(n)) {
                    const compNodes = [];
                    const q = [n];
                    visited.add(n);
                    while(q.length > 0) {
                        const curr = q.shift();
                        compNodes.push(curr);
                        adj.get(curr).forEach(neighbor => {
                            if (!visited.has(neighbor)) {
                                visited.add(neighbor);
                                q.push(neighbor);
                            }
                        });
                    }
                    componentsList.push(compNodes);
                }
            });

            // For each isolated sub-circuit, pick a ground node
            const groundNodes = new Set();
            componentsList.forEach(compNodes => {
                let gNode = compNodes[0];
                const pSources = netlist.filter(c => (c.type === 'battery' || c.type === 'ac_source') && (compNodes.includes(c.nodes[0]) || compNodes.includes(c.nodes[1])));
                if (pSources.length > 0) {
                    gNode = pSources[0].nodes[1]; // Prefer battery negative terminal or AC terminal 2
                }
                groundNodes.add(gNode);
            });

            const nodeMap = new Map();
            let varIdx = 1; // 0 is reserved for ground
            nodes.forEach(n => {
                if (groundNodes.has(n)) {
                    nodeMap.set(n, 0);
                } else {
                    nodeMap.set(n, varIdx++);
                }
            });

            const numVariables = varIdx - 1;

            // 2. Identify voltage sources (for MNA 'B' matrix)
            const vSources = netlist.filter(c => c.type === 'battery');
            const acSources = netlist.filter(c => c.type === 'ac_source');
            const numVSources = vSources.length + acSources.length;

            // Matrix size: numVariables + numVSources
            const size = numVariables + numVSources;

            if (size === 0) {
                const voltages = {};
                nodes.forEach(n => voltages[n] = 0);
                const currents = {};
                netlist.forEach(c => currents[c.id] = 0);
                return { success: true, voltages, currents };
            }
            
            // Initialize matrices using math.js
            let A = math.zeros(size, size);
            let Z = math.zeros(size, 1);

            // ground node index
            const gndNode = 0;

            // 3. Stamping
            netlist.forEach((c, cIdx) => {
                const n1Orig = nodeMap.get(c.nodes[0]);
                const n2Orig = nodeMap.get(c.nodes[1]);
                
                // Adjust for ground (ignore row/col for gndNode)
                const n1 = n1Orig === gndNode ? -1 : (n1Orig > gndNode ? n1Orig - 1 : n1Orig);
                const n2 = n2Orig === gndNode ? -1 : (n2Orig > gndNode ? n2Orig - 1 : n2Orig);

                if (c.type === 'resistor' || c.type === 'bulb' || c.type === 'voltmeter' || c.type === 'ammeter' || (c.type === 'wire')) {
                    const r = c.type === 'wire' ? 1e-6 : parseFloat(c.value) || 100;
                    const g = 1 / r;
                    if (n1 !== -1) A.set([n1, n1], math.add(A.get([n1, n1]), g));
                    if (n2 !== -1) A.set([n2, n2], math.add(A.get([n2, n2]), g));
                    if (n1 !== -1 && n2 !== -1) {
                        A.set([n1, n2], math.subtract(A.get([n1, n2]), g));
                        A.set([n2, n1], math.subtract(A.get([n2, n1]), g));
                    }
                } else if (c.type === 'battery' || c.type === 'ac_source') {
                    const isAC = c.type === 'ac_source';
                    const vSourceIdx = isAC ? (vSources.length + acSources.indexOf(c)) : vSources.indexOf(c);
                    const vRow = numVariables + vSourceIdx;
                    let val = parseFloat(c.value) || 0;
                    
                    // Internal Resistance (Default 0.001 ohms)
                    const rInt = (c.rInt !== undefined) ? parseFloat(c.rInt) : 0.001;

                    if (isAC) {
                        // AC Source: V(t) = Vpeak * sin(2 * PI * f * t + phase)
                        const f = parseFloat(c.freq) || 1.0;
                        const p = (parseFloat(c.phase) || 0) * (Math.PI / 180);
                        val = val * Math.sin(2 * Math.PI * f * this.time + p);
                    }

                    if (n1 !== -1) {
                        A.set([n1, vRow], 1);
                        A.set([vRow, n1], 1);
                    }
                    if (n2 !== -1) {
                        A.set([n2, vRow], -1);
                        A.set([vRow, n2], -1);
                    }
                    // Add internal resistance to A matrix (V1 - V2 - I*rInt = V)
                    // With I defined as current into n1, supplying means I is negative.
                    // V1 - V2 = V + I*rInt = V - |I|*rInt. Correct.
                    A.set([vRow, vRow], -rInt);
                    Z.set([vRow, 0], val);
                } else if (c.type === 'capacitor') {
                    if (dt > 0) {
                        const c_val = (parseFloat(c.value) || 10000) * 1e-6; // uF to F
                        const g = c_val / dt;
                        const vprev = this.history.voltages[c.id] || 0;
                        const ieq = g * vprev; // Flows n1 -> n2
                        
                        if (n1 !== -1) A.set([n1, n1], math.add(A.get([n1, n1]), g));
                        if (n2 !== -1) A.set([n2, n2], math.add(A.get([n2, n2]), g));
                        if (n1 !== -1 && n2 !== -1) {
                            A.set([n1, n2], math.subtract(A.get([n1, n2]), g));
                            A.set([n2, n1], math.subtract(A.get([n2, n1]), g));
                        }
                        
                        if (n1 !== -1) Z.set([n1, 0], Z.get([n1, 0]) + ieq);
                        if (n2 !== -1) Z.set([n2, 0], Z.get([n2, 0]) - ieq);
                    } else {
                        // DC steady state: Open circuit (R = 1G ohms)
                        const g = 1e-9;
                        if (n1 !== -1) A.set([n1, n1], math.add(A.get([n1, n1]), g));
                        if (n2 !== -1) A.set([n2, n2], math.add(A.get([n2, n2]), g));
                        if (n1 !== -1 && n2 !== -1) {
                            A.set([n1, n2], math.subtract(A.get([n1, n2]), g));
                            A.set([n2, n1], math.subtract(A.get([n2, n1]), g));
                        }
                    }
                } else if (c.type === 'inductor') {
                    if (dt > 0) {
                        const l_val = (parseFloat(c.value) || 1000) * 1e-3; // mH to H
                        const g = dt / l_val;
                        const iprev = this.history.currents[c.id] || 0; // Flows n1 -> n2
                        
                        if (n1 !== -1) A.set([n1, n1], math.add(A.get([n1, n1]), g));
                        if (n2 !== -1) A.set([n2, n2], math.add(A.get([n2, n2]), g));
                        if (n1 !== -1 && n2 !== -1) {
                            A.set([n1, n2], math.subtract(A.get([n1, n2]), g));
                            A.set([n2, n1], math.subtract(A.get([n2, n1]), g));
                        }
                        
                        if (n1 !== -1) Z.set([n1, 0], Z.get([n1, 0]) - iprev);
                        if (n2 !== -1) Z.set([n2, 0], Z.get([n2, 0]) + iprev);
                    } else {
                        // DC steady state: Short circuit (R = 1 micro ohm)
                        const g = 1e6;
                        if (n1 !== -1) A.set([n1, n1], math.add(A.get([n1, n1]), g));
                        if (n2 !== -1) A.set([n2, n2], math.add(A.get([n2, n2]), g));
                        if (n1 !== -1 && n2 !== -1) {
                            A.set([n1, n2], math.subtract(A.get([n1, n2]), g));
                            A.set([n2, n1], math.subtract(A.get([n2, n1]), g));
                        }
                    }
                }
            });

            // 4. Solve Ax = Z
            // Use math.lusolve
            const X = math.lusolve(A, Z);

            // 5. Extract results
            const voltages = {};
            nodeMap.forEach((idx, id) => {
                if (idx === gndNode) {
                    voltages[id] = 0;
                } else {
                    const realIdx = idx > gndNode ? idx - 1 : idx;
                    voltages[id] = X.get([realIdx, 0]);
                }
            });

            const currents = {};
            // Simplified: Current = (V1 - V2) / R
            netlist.forEach(c => {
                const v1 = voltages[c.nodes[0]];
                const v2 = voltages[c.nodes[1]];
                if (c.type === 'resistor' || c.type === 'bulb' || c.type === 'voltmeter' || c.type === 'ammeter' || c.type === 'wire') {
                    const r = c.type === 'wire' ? 1e-6 : parseFloat(c.value) || 100;
                    currents[c.id] = (v1 - v2) / r;
                } else if (c.type === 'battery' || c.type === 'ac_source') {
                    const isAC = c.type === 'ac_source';
                    const vSourceIdx = isAC ? (vSources.length + acSources.indexOf(c)) : vSources.indexOf(c);
                    currents[c.id] = X.get([numVariables + vSourceIdx, 0]);
                } else if (c.type === 'capacitor') {
                    if (dt > 0) {
                        const c_val = (parseFloat(c.value) || 10000) * 1e-6;
                        const g = c_val / dt;
                        const ieq = g * (this.history.voltages[c.id] || 0);
                        currents[c.id] = (v1 - v2) * g - ieq;
                    } else {
                        currents[c.id] = (v1 - v2) * 1e-9;
                    }
                    this.history.voltages[c.id] = v1 - v2;
                } else if (c.type === 'inductor') {
                    if (dt > 0) {
                        const l_val = (parseFloat(c.value) || 1000) * 1e-3;
                        const g = dt / l_val;
                        const iprev = this.history.currents[c.id] || 0;
                        currents[c.id] = (v1 - v2) * g + iprev;
                    } else {
                        currents[c.id] = (v1 - v2) * 1e6;
                    }
                    this.history.currents[c.id] = currents[c.id];
                }
            });

            return { success: true, voltages, currents };
        } catch (e) {
            console.error(e);
            return { success: false, message: "解析エラー: 回路が正しく接続されていないか、ショートしている可能性があります。" };
        }
    }
}
