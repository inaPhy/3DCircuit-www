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

            // 1. ノードと接続性の特定
            const adj = new Map();
            nodes.forEach(n => adj.set(n, []));
            netlist.forEach(c => {
                adj.get(c.nodes[0]).push(c.nodes[1]);
                adj.get(c.nodes[1]).push(c.nodes[0]);
            });

            // 2. 「島（孤立した回路網）」の特定
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

            // 3. ノード番号のマッピング (1から開始)
            const nodeMap = new Map();
            let varIdx = 1;
            nodes.forEach(n => { nodeMap.set(n, varIdx++); });
            const numVariables = varIdx - 1;

            // 4. 電圧源の特定
            const vSources = netlist.filter(c => c.type === 'battery');
            const acSources = netlist.filter(c => c.type === 'ac_source');
            const numVSources = vSources.length + acSources.length;
            const size = numVariables + numVSources;

            // 5. 行列の初期化
            let A = math.zeros(size, size);
            let Z = math.zeros(size, 1);

            // GMIN: 行列を正則にするための微小コンダクタンス
            const GMIN = 1e-12;
            for (let i = 0; i < numVariables; i++) A.set([i, i], GMIN);

            // 5. 各島に対してアンカー（接地）を設定
            componentsList.forEach(compNodes => {
                const nodeScores = new Map();
                compNodes.forEach(n => nodeScores.set(n, 0));

                // 島内の電源系素子を抽出
                const islandSources = netlist.filter(c => 
                    (c.type === 'battery' || c.type === 'ac_source' || c.type === 'capacitor' || c.type === 'inductor') && 
                    (compNodes.includes(c.nodes[0]) || compNodes.includes(c.nodes[1]))
                );

                islandSources.forEach(s => {
                    let nPos = null, nNeg = null;
                    let weight = 1; // デフォルト（蓄電素子など）
                    if (s.type === 'battery' || s.type === 'ac_source') {
                        nPos = s.nodes[0]; nNeg = s.nodes[1];
                        weight = 10; // 電源系は優先度を高くする
                    } else {
                        const vprev = this.history.voltages[s.id] || 0;
                        if (Math.abs(vprev) > 1e-6) {
                            nPos = vprev > 0 ? s.nodes[0] : s.nodes[1];
                            nNeg = vprev > 0 ? s.nodes[1] : s.nodes[0];
                            weight = 1; // 蓄電素子は優先度低
                        }
                    }
                    if (nPos && nodeScores.has(nPos)) nodeScores.set(nPos, nodeScores.get(nPos) - weight);
                    if (nNeg && nodeScores.has(nNeg)) nodeScores.set(nNeg, nodeScores.get(nNeg) + weight);
                });

                let anchorNode = null;
                let maxScore = -Infinity;
                let maxY = -Infinity;
                let minX = Infinity;

                compNodes.forEach(node => {
                    const score = nodeScores.get(node);
                    const parts = node.split('_');
                    const x = parseInt(parts[1]);
                    const y = parseInt(parts[2]);

                    // スコアが高い（マイナス端子として有力）ものを優先
                    // スコアが同じなら、より下（Y大）にあるものを優先
                    if (score > maxScore) {
                        maxScore = score; maxY = y; minX = x; anchorNode = node;
                    } else if (score === maxScore) {
                        if (y > maxY || (y === maxY && x < minX)) {
                            maxY = y; minX = x; anchorNode = node;
                        }
                    }
                });

                if (anchorNode) {
                    const anchorIdx = nodeMap.get(anchorNode) - 1;
                    A.set([anchorIdx, anchorIdx], A.get([anchorIdx, anchorIdx]) + 1.0);
                }
            });

            // 4. スタンプ処理
            netlist.forEach((c, cIdx) => {
                const n1 = nodeMap.get(c.nodes[0]) - 1; // 0-based index
                const n2 = nodeMap.get(c.nodes[1]) - 1; // 0-based index

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

            // 6. 結果の抽出
            const voltages = {};
            nodeMap.forEach((idx, id) => {
                voltages[id] = X.get([idx - 1, 0]);
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
                    this.history.voltages[c.id] = v1 - v2; // コイルの電圧履歴を保存
                }
            });

            return { success: true, voltages, currents };
        } catch (e) {
            console.error(e);
            return { success: false, message: "解析エラー: 回路が正しく接続されていないか、ショートしている可能性があります。" };
        }
    }
}
