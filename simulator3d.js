// 抵抗器のカラーコード算出ヘルパー (3D用)
function getResistorColorBands3D(value) {
    const colors = ['#000000', '#8b4513', '#ff0000', '#ffa500', '#ffff00', '#008000', '#0000ff', '#ee82ee', '#808080', '#ffffff'];
    if (value <= 0) return [colors[0], colors[0], colors[0], '#ffd700'];
    const s = value.toExponential().split('e');
    let d1 = Math.floor(parseFloat(s[0]));
    let d2 = Math.round((parseFloat(s[0]) - d1) * 10);
    let multiplier = parseInt(s[1]) - 1;
    if (d2 >= 10) { d1++; d2 = 0; if (d1 >= 10) { d1 = 1; multiplier++; } }
    let mColor = (multiplier === -1) ? '#ffd700' : (multiplier === -2 ? '#c0c0c0' : (multiplier >= 0 && multiplier <= 9 ? colors[multiplier] : colors[0]));
    return [colors[Math.max(0, Math.min(9, d1))], colors[Math.max(0, Math.min(9, d2))], mColor, '#ffd700'];
}

class Simulator3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.meshes = [];
        this.particleMesh = null;
        this.isActive = false;

        this.GRID_SCALE = 50; // Visual scale factor for grid X/Y
        this.Z_SCALE = 30;    // Visual scale factor for voltage Z
        this.textureParams = {}; // Cache to avoid recreating textures unnecessarily
    }

    init() {
        if (this.scene) return;

        this.scene = new THREE.Scene();
        this.scene.background = null;

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        this.camera.position.set(0, -600, 600); // Isometric-ish
        this.camera.up.set(0, 0, 1); // Z is up

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setClearColor(0x000000, 0); // 透明
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, document.getElementById('workspace-content'));
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
        dirLight.position.set(100, -100, 500);
        this.scene.add(dirLight);

        // 動的グリッド用のグループ
        this.gridLines = new THREE.Group();
        this.scene.add(this.gridLines);

        this.GRID_SIZE_X = 11;
        this.GRID_SIZE_Y = 7;

        // 電荷表示用のインスタンスメッシュ（最大2000個）
        const particleGeo = new THREE.SphereGeometry(4, 8, 8);
        const particleMat = new THREE.MeshBasicMaterial({ color: 0xff1493 }); // 正電荷
        this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, 2000);
        this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.particleMesh);

        // 負電荷表示用のインスタンスメッシュ（青紫色）
        const negParticleMat = new THREE.MeshBasicMaterial({ color: 0x5c5cff }); 
        this.negParticleMesh = new THREE.InstancedMesh(particleGeo, negParticleMat, 2000);
        this.negParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.negParticleMesh);

        window.addEventListener('resize', () => this.onWindowResize());


        this.animate();
    }

    onWindowResize() {
        if (!this.isActive || !this.camera || !this.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    show() {
        this.isActive = true;
        this.container.style.display = 'block';
        if (!this.scene) {
            this.init();
        }
        this.onWindowResize();
    }

    hide() {
        this.isActive = false;
        this.container.style.display = 'none';
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (!this.isActive) return;
        if (this.controls) this.controls.update();
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    }

    build(components) {
        if (!this.isActive || !this.scene) return;

        this.meshes.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
            else if (m.material) m.material.dispose();
            if (m.userData.line) {
                this.scene.remove(m.userData.line);
                m.userData.line.geometry.dispose();
                m.userData.line.material.dispose();
            }
        });
        this.meshes = [];
        this.circuitComponents = components;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        components.forEach(comp => {
            if (comp.x < minX) minX = comp.x;
            if (comp.x > maxX) maxX = comp.x;
            if (comp.y < minY) minY = comp.y;
            if (comp.y > maxY) maxY = comp.y;
        });
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2;

        this.controls.target.set(0, 0, 0);

        components.forEach(comp => {
            const geometry = new THREE.BufferGeometry();

            // Dummy vertices, will be set in update()
            const vertices = new Float32Array(30 * 3);
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

            const uvs = new Float32Array([...[0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0], ...(new Array(24 * 2).fill(0))]);
            geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
            geometry.computeVertexNormals();

            const texture = this.getComponentTexture(comp);
            const topMaterial = new THREE.MeshPhongMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });

            let sideColor = 0xffffff;
            if (comp.type === 'battery') sideColor = 0xffcccc;
            else if (comp.type === 'resistor') sideColor = 0xffffcc;
            else if (comp.type === 'switch') sideColor = 0xccffcc;
            else sideColor = 0xeeeeee;

            const sideMaterial = new THREE.MeshPhongMaterial({ color: sideColor, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

            geometry.addGroup(0, 6, 0);
            geometry.addGroup(6, 24, 1);

            const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial]);
            mesh.userData.comp = comp; // store reference

            // Edges will be added dynamically in update since geometry changes

            this.scene.add(mesh);
            this.meshes.push(mesh);
        });
    }

    update(components, simulationResults) {
        this.updateGrid();
        if (!this.isActive || !this.scene || !simulationResults || !components) return;

        this.circuitComponents = components;
        this.simulationResults = simulationResults;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        this.circuitComponents.forEach(comp => {
            if (comp.x < minX) minX = comp.x;
            if (comp.x > maxX) maxX = comp.x;
            if (comp.y < minY) minY = comp.y;
            if (comp.y > maxY) maxY = comp.y;
        });
        if (minX === Infinity) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2;

        // activeNodes is built first, we will calculate minV right after building activeNodes.
        // Wait, to calculate minV from activeNodes, activeNodes must be built first!

        // Clear all previous meshes
        this.meshes.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
            else if (m.material) m.material.dispose();
            if (m.userData.lines) {
                m.userData.lines.forEach(l => {
                    this.scene.remove(l);
                    l.geometry.dispose();
                    l.material.dispose();
                });
            } else if (m.userData.line) {
                this.scene.remove(m.userData.line);
                m.userData.line.geometry.dispose();
                m.userData.line.material.dispose();
            }
        });
        this.meshes = [];

        // 動的接続性スキャン（バッテリーから繋がるアクティブなノードを特定）
        const activeNodes = new Set();
        this.circuitComponents.forEach(comp => {
            if (comp.type === 'battery' || comp.type === 'ac_source' || comp.type === 'capacitor' || comp.type === 'inductor') {
                const isHoriz = (comp.rotation === 0 || comp.rotation === 2);
                const n1 = isHoriz ? `v_${comp.x}_${comp.y}` : `h_${comp.x}_${comp.y}`;
                const n2 = isHoriz ? `v_${comp.x + 1}_${comp.y}` : `h_${comp.x}_${comp.y + 1}`;
                const v1 = simulationResults.voltages[n1];
                const v2 = simulationResults.voltages[n2];
                // 実質的に機能している（MNAで電位差が解かれている）電源や蓄電素子をアクティブの起点とする。
                if (v1 !== undefined && v2 !== undefined) {
                    const diff = Math.abs(v1 - v2);
                    if (diff > 1e-6 || comp.type === 'ac_source' || comp.type === 'capacitor' || comp.type === 'inductor') {
                        activeNodes.add(n1);
                        activeNodes.add(n2);
                    }
                }
            }
        });
        let changed = true;
        while (changed) {
            changed = false;
            this.circuitComponents.forEach(comp => {
                if (comp.type === 'switch' && comp.value !== 1) return; // 開いたスイッチは伝播しない

                const isHoriz = (comp.rotation === 0 || comp.rotation === 2 || (comp.type === 'wire' && (comp.rotation === 0 || comp.rotation === 2)));
                let nodesForComp = [];
                if (['wire_l', 'wire_t', 'wire_cross'].includes(comp.type)) {
                    nodesForComp = [`v_${comp.x}_${comp.y}`, `v_${comp.x + 1}_${comp.y}`, `h_${comp.x}_${comp.y}`, `h_${comp.x}_${comp.y + 1}`];
                } else if (isHoriz) {
                    nodesForComp = [`v_${comp.x}_${comp.y}`, `v_${comp.x + 1}_${comp.y}`];
                } else {
                    nodesForComp = [`h_${comp.x}_${comp.y}`, `h_${comp.x}_${comp.y + 1}`];
                }

                const hasActive = nodesForComp.some(n => activeNodes.has(n));
                if (hasActive) {
                    nodesForComp.forEach(n => {
                        if (!activeNodes.has(n)) {
                            activeNodes.add(n);
                            changed = true;
                        }
                    });
                }
            });
        }

        // 常に 0V を地面（高さ0）の基準とする。
        // これにより、各島がそれぞれの 0V ノードで地面に接地し、互いに干渉しなくなる。
        this.minV = 0;
        const minV = this.minV;

        this.circuitComponents.forEach(comp => {
            const leftNode = `v_${comp.x}_${comp.y}`;
            const rightNode = `v_${comp.x + 1}_${comp.y}`;
            const topNode = `h_${comp.x}_${comp.y}`;
            const bottomNode = `h_${comp.x}_${comp.y + 1}`;

            const getV = (node) => {
                let v = simulationResults.voltages[node];
                if (!activeNodes.has(node) || v === undefined || isNaN(v) || !isFinite(v)) return minV;
                return v;
            };

            const vL = getV(leftNode);
            const vR = getV(rightNode);
            const vT = getV(topNode);
            const vB = getV(bottomNode);

            const definedVolts = [
                !activeNodes.has(leftNode) ? undefined : simulationResults.voltages[leftNode],
                !activeNodes.has(rightNode) ? undefined : simulationResults.voltages[rightNode],
                !activeNodes.has(topNode) ? undefined : simulationResults.voltages[topNode],
                !activeNodes.has(bottomNode) ? undefined : simulationResults.voltages[bottomNode]
            ].filter(v => v !== undefined);

            const eqV = definedVolts.length > 0 ? definedVolts[0] : minV;

            let isHorizontal = true;
            let vStart = minV, vEnd = minV;

            if (['wire_l', 'wire_t', 'wire_cross'].includes(comp.type)) {
                // Junctions should be equipotential surfaces at their center junction point.
                const midNode = `mid_${comp.x}_${comp.y}`;
                const midV = simulationResults.voltages[midNode];
                if (midV !== undefined) {
                    vStart = vEnd = midV;
                } else {
                    // Fallback: use the average of defined boundary potentials
                    const activeVs = definedVolts.length > 0 ? definedVolts : [minV];
                    const avgV = activeVs.reduce((a, b) => a + b, 0) / activeVs.length;
                    vStart = vEnd = avgV;
                }
            } else if (comp.rotation === 0 || comp.rotation === 2 || (comp.type === 'wire' && (comp.rotation === 0 || comp.rotation === 2))) {
                isHorizontal = true;
                vStart = vL; vEnd = vR;
            } else {
                isHorizontal = false;
                vStart = vT; vEnd = vB;
            }

            vStart -= minV;
            vEnd -= minV;

            // Fix Y-axis inversion: 2D +Y (down) maps to 3D -Y (down).
            const x0 = (comp.x - this.cx) * this.GRID_SCALE;
            const x1 = (comp.x + 1 - this.cx) * this.GRID_SCALE;
            const y0 = -(comp.y - this.cy) * this.GRID_SCALE;      // TOP EDGE (Larger Y)
            const y1 = -(comp.y + 1 - this.cy) * this.GRID_SCALE;  // BOTTOM EDGE (Smaller Y)

            let profile = [];
            if (['battery', 'ac_source'].includes(comp.type)) {
                const i = simulationResults.currents[comp.id] || 0;
                const rInt = (comp.rInt !== undefined) ? comp.rInt : 0.001;
                const vIr = i * rInt;

                if (comp.type === 'battery') {
                    const emf = parseFloat(comp.value) || 0;
                    if (comp.rotation === 0 || comp.rotation === 1) {
                        // vStart: Pos, vEnd: Neg. Peak is always vEnd + EMF
                        profile = [[0, vStart], [0.5, vEnd + emf], [0.51, vEnd], [1, vEnd]];
                    } else {
                        // vStart: Neg, vEnd: Pos. Peak is always vStart + EMF
                        profile = [[0, vStart], [0.49, vStart], [0.5, vStart + emf], [1, vEnd]];
                    }
                } else {
                    // ac_source stays relative to handle animation
                    if (comp.rotation === 0 || comp.rotation === 1) {
                        profile = [[0, vStart], [0.5, vStart - vIr], [0.51, vEnd], [1, vEnd]];
                    } else {
                        profile = [[0, vStart], [0.49, vStart], [0.5, vEnd - vIr], [1, vEnd]];
                    }
                }
            } else if (comp.type === 'capacitor') {
                // 極板の線に干渉しない安全圏(0.43, 0.57)を斜面にする
                profile = [[0, vStart], [0.43, vStart], [0.57, vEnd], [1, vEnd]];
            } else if (comp.type === 'switch') {
                profile = [[0, vStart], [0.49, vStart], [0.51, vEnd], [1, vEnd]];
            } else {
                profile = [[0, vStart], [1, vEnd]];
            }

            const topVerts = [];
            const topUvs = [];
            const wallVerts = [];
            const baseZ = 0; // 一番低い電位(Z=0)にぴったりくっつけるため、土台の底面を0に設定

            const addTopTri = (p1, p2, p3, uv1, uv2, uv3) => {
                topVerts.push(...p1, ...p2, ...p3);
                topUvs.push(...uv1, ...uv2, ...uv3);
            };

            const addWallTri = (p1, p2, p3) => {
                wallVerts.push(...p1, ...p2, ...p3);
            };

            const addQuad = (pTL, pTR, pBL, pBR, uvTL, uvTR, uvBL, uvBR) => {
                // Surface (normal roughly +Z)
                addTopTri(pTR, pTL, pBL, uvTR, uvTL, uvBL);
                addTopTri(pTR, pBL, pBR, uvTR, uvBL, uvBR);
            };

            const addWall = (pA, pB) => {
                const bA = [pA[0], pA[1], baseZ];
                const bB = [pB[0], pB[1], baseZ];
                addWallTri(pA, pB, bB);
                addWallTri(pA, bB, bA);
            };

            for (let i = 0; i < profile.length - 1; i++) {
                const tA = profile[i][0], zA = profile[i][1] * this.Z_SCALE;
                const tB = profile[i + 1][0], zB = profile[i + 1][1] * this.Z_SCALE;

                let pTL, pTR, pBL, pBR;
                let uvTL, uvTR, uvBL, uvBR;

                if (isHorizontal) {
                    const xa = x0 + tA * (x1 - x0);
                    const xb = x0 + tB * (x1 - x0);
                    pTL = [xa, y0, zA]; pTR = [xb, y0, zB];
                    pBL = [xa, y1, zA]; pBR = [xb, y1, zB];
                    uvTL = [tA, 1]; uvTR = [tB, 1];
                    uvBL = [tA, 0]; uvBR = [tB, 0];
                } else {
                    const ya = y0 - tA * (y0 - y1);
                    const yb = y0 - tB * (y0 - y1);
                    pTL = [x0, ya, zA]; pTR = [x1, ya, zA];
                    pBL = [x0, yb, zB]; pBR = [x1, yb, zB];
                    uvTL = [0, 1 - tA]; uvTR = [1, 1 - tA];
                    uvBL = [0, 1 - tB]; uvBR = [1, 1 - tB];
                }

                // スイッチ（OFF時）のみ中間セグメントを隙間にする
                const isGap = (i === 1) && (comp.type === 'switch' && comp.value === 0);

                if (isGap) {
                    // 断面を閉じる
                    if (isHorizontal) {
                        addWall(pBL, pTL); // 前半部分の右端
                        addWall(pTR, pBR); // 後半部分の左端
                    } else {
                        addWall(pTL, pTR); // 前半部分の下端
                        addWall(pBR, pBL); // 後半部分の上端
                    }
                    continue; // 表面ポリゴンの描画をスキップ
                }

                addQuad(pTL, pTR, pBL, pBR, uvTL, uvTR, uvBL, uvBR);

                if (isHorizontal) {
                    addWall(pTR, pTL);
                    addWall(pBL, pBR);
                } else {
                    addWall(pTL, pBL);
                    addWall(pBR, pTR);
                }
                if (i === 0) {
                    if (isHorizontal) addWall(pTL, pBL);
                    else addWall(pTR, pTL);
                }
                if (i === profile.length - 2) {
                    if (isHorizontal) addWall(pBR, pTR);
                    else addWall(pBL, pBR);
                }
            }

            const topGeometry = new THREE.BufferGeometry();
            topGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(topVerts), 3));
            topGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(topUvs), 2));
            topGeometry.computeVertexNormals();

            const wallGeometry = new THREE.BufferGeometry();
            wallGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wallVerts), 3));
            wallGeometry.computeVertexNormals();

            const texture = this.getComponentTexture(comp);
            const topMaterial = new THREE.MeshPhongMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });

            const mesh = new THREE.Mesh(topGeometry, topMaterial);
            mesh.userData.comp = comp;

            // 点灯状態の判定 (電球の場合)
            let isBulbLit = false;
            if (comp.type === 'bulb') {
                const current = Math.abs(simulationResults.currents[comp.id] || 0);
                if (current > 0.01) isBulbLit = true;
            }

            // パネルの周りは実線
            const topEdges = new THREE.EdgesGeometry(topGeometry);
            const topLines = new THREE.LineSegments(topEdges, new THREE.LineBasicMaterial({
                color: 0x555555,
                opacity: 0.4,
                transparent: true
            }));
            topLines.visible = !isBulbLit; // 点灯中は非表示
            mesh.add(topLines);

            // 高さに当たる側面は点線
            const wallEdges = new THREE.EdgesGeometry(wallGeometry);
            const wallLines = new THREE.LineSegments(wallEdges, new THREE.LineDashedMaterial({
                color: 0x555555,
                opacity: 0.5,
                transparent: true,
                dashSize: 4,
                gapSize: 3
            }));
            wallLines.computeLineDistances();
            wallLines.visible = !isBulbLit; // 点灯中は非表示
            mesh.add(wallLines);

            mesh.userData.lines = [topLines, wallLines];

            this.scene.add(mesh);
            this.meshes.push(mesh);

        });
    }

    getComponentTexture(comp, isHighlighted = false) {
        const isDarkMode = !document.documentElement.classList.contains('light-mode');
        // Simple caching based on type, rotation, state, theme, and illustration mode
        let stateValue = 0;
        if (comp.type === 'switch') stateValue = comp.value;
        else if (comp.type === 'bulb' && this.simulationResults) {
            stateValue = Math.abs(this.simulationResults.currents[comp.id] || 0);
        }

        const stateKey = (comp.type === 'switch' || comp.type === 'bulb') ? (stateValue > 0.01 ? "on" : "off") : "";
        const themeKey = isDarkMode ? "dark" : "light";
        const illKey = (typeof showIllustrations !== 'undefined' && showIllustrations) ? "ill_v29" : "sym_v29";
        // キャッシュキーに値を加える (抵抗値などの変化に対応)
        const valKey = (comp.type === 'resistor' || comp.type === 'battery') ? "_" + comp.value : "";
        const state = stateValue; // 描画ロジック用
        const key = comp.type + "_" + comp.rotation + "_" + stateKey + "_" + themeKey + "_" + illKey + valKey + (isHighlighted ? "_hl" : "");
        if (this.textureParams[key]) return this.textureParams[key];

        // ダークモード時も導線は黒に設定 (ユーザー要望)
        const color = "#000000";

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Background color
        if (comp.type === 'battery' || comp.type === 'ac_source') ctx.fillStyle = 'rgba(255, 120, 120, 0.9)';
        else if (comp.type === 'resistor') ctx.fillStyle = 'rgba(255, 255, 120, 0.9)';
        else if (comp.type === 'switch') ctx.fillStyle = '#fffaf0';
        else if (comp.type === 'bulb') ctx.fillStyle = '#CCCCCC';
        else if (comp.type === 'inductor') ctx.fillStyle = '#71FFFF';
        else if (comp.type === 'capacitor') ctx.fillStyle = '#98fb98';
        else if (comp.type === 'voltmeter') ctx.fillStyle = '#ffd700';
        else if (comp.type === 'ammeter') ctx.fillStyle = '#0099FF';
        else ctx.fillStyle = '#ffffff';

        ctx.fillRect(0, 0, 128, 128);

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.save();
        ctx.translate(64, 64);
        if (comp.rotation) ctx.rotate(comp.rotation * Math.PI / 2);

        ctx.beginPath();
        if (comp.type === 'wire') {
            ctx.moveTo(-64, 0); ctx.lineTo(64, 0);
        } else if (comp.type === 'wire_l') {
            ctx.moveTo(0, -64); ctx.lineTo(0, 0); ctx.lineTo(64, 0);
        } else if (comp.type === 'wire_cross') {
            ctx.moveTo(-64, 0); ctx.lineTo(64, 0);
            ctx.moveTo(0, -64); ctx.lineTo(0, 64);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#000'; ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        } else if (comp.type === 'wire_t') {
            ctx.moveTo(-64, 0); ctx.lineTo(64, 0);
            ctx.moveTo(0, 0); ctx.lineTo(0, 64);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#000'; ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
        } else if (comp.type === 'resistor') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                // イラスト描画 (3D用テクスチャ: リアルな抵抗器)

                // 導線を最初に描画
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(64, 0);
                ctx.stroke();

                // 本体のグラデーション (ベージュ)
                const gradBody = ctx.createLinearGradient(0, -20, 0, 20);
                gradBody.addColorStop(0, '#fdf5e6');
                gradBody.addColorStop(0.5, '#f5e1a4');
                gradBody.addColorStop(1, '#e6d08a');

                // 本体
                ctx.fillStyle = gradBody;
                ctx.strokeStyle = 'rgba(0,0,0,0)'; // 枠線を確実に無効化
                ctx.beginPath();
                const rx = -40, ry = -20, rw = 80, rh = 40, rr = 15;
                ctx.moveTo(rx + rr, ry);
                ctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
                ctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
                ctx.arcTo(rx, ry + rh, rx, ry, rr);
                ctx.arcTo(rx, ry, rx + rw, ry, rr);
                ctx.closePath();
                ctx.fill();

                // カラーバンド (動的算出)
                const resColors = getResistorColorBands3D(comp.value);
                const bandX = [-25, -10, 5, 25];
                resColors.forEach((c, i) => {
                    ctx.fillStyle = c;
                    ctx.fillRect(bandX[i], -20, 6, 40);
                });

                // ハイライト
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect(-40, -15, 80, 6);
            } else {
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-30, 0);
                ctx.moveTo(30, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(-30, -15, 60, 30);
                ctx.lineWidth = 4; // 抵抗の枠線は4
                ctx.strokeRect(-30, -15, 60, 30);
                ctx.lineWidth = 3; // 元に戻す
            }
        } else if (comp.type === 'battery') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                // イラスト描画 (3D用テクスチャ: リアルな実物風デザイン)

                // 導線を最初に描画 (重なりの一番下、左右均等化)
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-50.5, 0);
                ctx.moveTo(50.5, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();

                // 本体のグラデーション (赤)
                const gradBody = ctx.createLinearGradient(0, -32, 0, 32);
                gradBody.addColorStop(0, '#ff5c5c');
                gradBody.addColorStop(0.3, '#e03131');
                gradBody.addColorStop(0.7, '#c92a2a');
                gradBody.addColorStop(1, '#a52828');

                // 金属端子のグラデーション
                const gradMetal = ctx.createLinearGradient(0, -12, 0, 12);
                gradMetal.addColorStop(0, '#f8f9fa');
                gradMetal.addColorStop(0.5, '#adb5bd');
                gradMetal.addColorStop(1, '#495057');

                // プラス端子（左側の金属突起）: -56+5.5 = -50.5
                ctx.fillStyle = gradMetal;
                ctx.fillRect(-50.5, -12, 11, 24);

                // 本体: -45+5.5 = -39.5
                ctx.fillStyle = gradBody;
                ctx.fillRect(-39.5, -32, 90, 64);

                // ハイライト
                ctx.fillStyle = 'rgba(255,255,255,0.2)';
                ctx.fillRect(-39.5, -24, 90, 8);

                // 記号と稲妻
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 32px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('+', -19.5, 5);

                // 稲妻マークの描画 (5.5ずらす)
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.strokeStyle = 'rgba(255, 255, 255, 0)';
                ctx.lineWidth = 0;
                ctx.beginPath();
                ctx.moveTo(20.5, -15);
                ctx.lineTo(35.5, -2);
                ctx.lineTo(27.5, -2);
                ctx.lineTo(37.5, 16);
                ctx.lineTo(22.5, 3);
                ctx.lineTo(30.5, 3);
                ctx.closePath();
                ctx.fill();
            } else {
                // シンボル描画 (ver2.0確定デザインの完全復元)
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
                ctx.moveTo(15, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();

                ctx.lineWidth = 9; // 以前決定した最適な太さ
                ctx.moveTo(-15, -30); ctx.lineTo(-15, 30); // 長い極板
                ctx.moveTo(15, -16); ctx.lineTo(15, 16);   // 短い極板
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3;
            }
        } else if (comp.type === 'ac_source') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                // イラスト描画 (3D用テクスチャ: 交流電源装置)

                // 1. 筐体 (ダークグレーのメタリック調)
                const gradBody = ctx.createLinearGradient(0, -40, 0, 40);
                gradBody.addColorStop(0, '#4a5568');
                gradBody.addColorStop(0.5, '#2d3748');
                gradBody.addColorStop(1, '#1a202c');
                ctx.fillStyle = gradBody;
                ctx.beginPath();
                ctx.roundRect(-48, -36, 96, 72, 6);
                ctx.fill();
                // 枠線を排除

                // 2. 液晶ディスプレイ
                ctx.fillStyle = '#0f172a';
                ctx.beginPath();
                ctx.roundRect(-36, -24, 72, 32, 2);
                ctx.fill();
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 1;
                ctx.stroke();

                // 3. サイン波 (発光風)
                ctx.strokeStyle = '#38bdf8';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-28, -8);
                ctx.bezierCurveTo(-28, -20, -14, -20, -14, -8);
                ctx.bezierCurveTo(-14, 4, 0, 4, 0, -8);
                ctx.bezierCurveTo(0, -20, 14, -20, 14, -8);
                ctx.bezierCurveTo(14, 4, 28, 4, 28, -8);
                ctx.stroke();

                // 4. 操作ノブ (2個)
                [-20, 20].forEach(kx => {
                    ctx.fillStyle = '#94a3b8';
                    ctx.beginPath();
                    ctx.arc(kx, 20, 8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#475569';
                    ctx.lineWidth = 1;
                    ctx.stroke();

                    // 指標線
                    ctx.strokeStyle = '#1e293b';
                    ctx.beginPath();
                    ctx.moveTo(kx, 20);
                    ctx.lineTo(kx + 4, 20 - 4);
                    ctx.stroke();
                });

                // 6. 導線 (リード線)
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-64, 0); ctx.lineTo(-48, 0);
                ctx.moveTo(48, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();
            } else {
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-36, 0);
                ctx.moveTo(36, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.arc(0, 0, 36, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 6; // 交流電源は太め(6)
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 4; // 中のサイン波は4
                ctx.moveTo(-20, 0);
                ctx.bezierCurveTo(-20, -12, -10, -12, 0, 0);
                ctx.bezierCurveTo(10, 12, 20, 12, 20, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3; // 元に戻す
            }
        } else if (comp.type === 'capacitor') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                // 1. 極板1 (左) のグラデーション: 2Dと完全に一致
                const gradPlate1 = ctx.createLinearGradient(-22, 0, -10, 0);
                gradPlate1.addColorStop(0, '#ced4da');
                gradPlate1.addColorStop(0.5, '#e2e8f0');
                gradPlate1.addColorStop(1, '#adb5bd');

                // 2. 極板2 (右) のグラデーション: 2Dと完全に一致
                const gradPlate2 = ctx.createLinearGradient(10, 0, 22, 0);
                gradPlate2.addColorStop(0, '#ced4da');
                gradPlate2.addColorStop(0.5, '#e2e8f0');
                gradPlate2.addColorStop(1, '#adb5bd');

                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = 1;

                // Plate 1 描画
                ctx.fillStyle = gradPlate1;
                ctx.fillRect(-22, -40, 12, 80);
                ctx.strokeRect(-22, -40, 12, 80);

                // Plate 2 描画
                ctx.fillStyle = gradPlate2;
                ctx.fillRect(10, -40, 12, 80);
                ctx.strokeRect(10, -40, 12, 80);

                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-22, 0);
                ctx.moveTo(22, 0); ctx.lineTo(64, 0);
                ctx.stroke();
            } else {
                ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
                ctx.moveTo(15, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();

                ctx.lineWidth = 9;
                ctx.moveTo(-15, -30); ctx.lineTo(-15, 30);
                ctx.moveTo(15, -30); ctx.lineTo(15, 30);
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3;
            }
        } else if (comp.type === 'switch') {
            ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
            ctx.moveTo(15, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#000';
            ctx.arc(-15, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath();
            if (comp.value === 1) {
                ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
                ctx.stroke(); ctx.beginPath();
            }
            ctx.arc(15, 0, 5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath();
        } else if (comp.type === 'bulb') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                const isLit = state > 0.01;
                const intensity = Math.min(state * 2, 1);

                // 導線
                ctx.save();
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-40, 0); ctx.lineTo(-40, 39); ctx.lineTo(-8, 39);
                ctx.moveTo(64, 0); ctx.lineTo(40, 0); ctx.lineTo(40, 19); ctx.lineTo(15, 19);
                ctx.stroke();
                ctx.restore();

                // 金属口金
                ctx.save();
                const gradBase = ctx.createLinearGradient(-15, 0, 15, 0);
                gradBase.addColorStop(0, '#868e96');
                gradBase.addColorStop(0.5, '#ced4da');
                gradBase.addColorStop(1, '#495057');
                ctx.fillStyle = gradBase;
                ctx.fillRect(-15, 2, 30, 34);
                // ネジ模様
                ctx.strokeStyle = 'rgba(0,0,0,0.3)';
                ctx.lineWidth = 2;
                for (let i = 0; i < 4; i++) {
                    ctx.beginPath();
                    const ty = 8 + i * 8;
                    ctx.moveTo(-15, ty);
                    ctx.quadraticCurveTo(0, ty + 2, 15, ty);
                    ctx.stroke();
                }
                ctx.fillStyle = '#343a40';
                ctx.fillRect(-8, 36, 16, 6);
                ctx.restore();

                // ガラス球 (色は固定)
                ctx.save();
                ctx.beginPath();
                const gradGlass = ctx.createRadialGradient(-8, -26, 4, 0, -20, 30);
                gradGlass.addColorStop(0, '#ffffff');
                gradGlass.addColorStop(1, '#adb5bd');
                ctx.fillStyle = gradGlass;
                ctx.strokeStyle = 'rgba(0,0,0,0)';
                ctx.lineWidth = 0;
                ctx.globalAlpha = 0.6;
                ctx.arc(0, -20, 30, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();

                // フィラメント
                ctx.save();
                ctx.beginPath();
                const r_f = Math.round(52 + (255 - 52) * intensity);
                const g_f = Math.round(58 + (255 - 58) * intensity);
                const b_f = Math.round(64 + (255 - 64) * intensity);
                ctx.strokeStyle = `rgb(${r_f},${g_f},${b_f})`;
                ctx.lineWidth = 3;
                ctx.moveTo(-10, -12);
                ctx.bezierCurveTo(-10, -26, 10, -26, 10, -12);
                ctx.stroke();
                ctx.restore();
                ctx.beginPath();
            } else {
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-28, 0);
                ctx.moveTo(28, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.arc(0, 0, 28, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 4; // 電球は少し控えめ(4)
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3; // 元に戻す
                ctx.moveTo(-18, -18); ctx.lineTo(18, 18);
                ctx.moveTo(-18, 18); ctx.lineTo(18, -18);
                ctx.stroke(); ctx.beginPath();
            }
        } else if (comp.type === 'inductor') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                // イラスト描画 (3D用テクスチャ: 芯材付きコイル)

                // 1. グラデーション定義
                const gradCore = ctx.createLinearGradient(0, -15, 0, 15);
                gradCore.addColorStop(0, '#94a3b8');
                gradCore.addColorStop(0.3, '#f1f5f9');
                gradCore.addColorStop(0.5, '#ffffff');
                gradCore.addColorStop(0.7, '#e2e8f0');
                gradCore.addColorStop(1, '#64748b');

                const gradWire = ctx.createLinearGradient(0, -15, 0, 15);
                gradWire.addColorStop(0, '#78350f');
                gradWire.addColorStop(1, '#451a03');

                const step = 10; // ステップを短く調整
                const coreH = 28;
                const loopCount = 6;
                const coreW = step * (loopCount - 1);
                const startX = -coreW / 2;

                // 2. 背面の巻き線
                ctx.strokeStyle = '#451a03';
                ctx.lineWidth = 3;
                for (let i = 0; i < loopCount; i++) {
                    const x = startX + i * step;
                    ctx.beginPath();
                    ctx.moveTo(x, -coreH / 2); ctx.lineTo(x, coreH / 2);
                    ctx.stroke();
                }

                // 3. 芯材 (コア)
                ctx.fillStyle = gradCore;
                ctx.beginPath();
                ctx.roundRect(startX - step / 2 - 4, -coreH / 2, coreW + step + 8, coreH, 6);
                ctx.fill();
                // 枠線を排除

                // 4. 前面の巻き線 (上下反転: 右斜め下への傾斜)
                ctx.strokeStyle = gradWire;
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';

                // 左端開始線
                ctx.beginPath();
                ctx.moveTo(startX - step / 2, 0);
                ctx.lineTo(startX, coreH / 2);
                ctx.stroke();

                for (let i = 0; i < loopCount; i++) {
                    const x = startX + i * step;
                    if (i < loopCount - 1) {
                        ctx.beginPath();
                        ctx.moveTo(x, -coreH / 2); ctx.lineTo(x + step, coreH / 2);
                        ctx.stroke();
                    } else {
                        // 右端終了線
                        ctx.beginPath();
                        ctx.moveTo(x, -coreH / 2); ctx.lineTo(x + step / 2, 0);
                        ctx.stroke();
                    }
                }

                // 5. 導線 (リード線)
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(-64, 0); ctx.lineTo(startX - step / 2, 0);
                ctx.moveTo(startX + (loopCount - 1) * step + step / 2, 0); ctx.lineTo(64, 0);
                ctx.stroke();
            } else {
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-30, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 4; // コイル部分は4
                ctx.arc(-22.5, 0, 7.5, Math.PI, 0);
                ctx.arc(-7.5, 0, 7.5, Math.PI, 0);
                ctx.arc(7.5, 0, 7.5, Math.PI, 0);
                ctx.arc(22.5, 0, 7.5, Math.PI, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3; // 元に戻す
                ctx.moveTo(30, 0); ctx.lineTo(64, 0);
                ctx.stroke();
            }
        } else if (comp.type === 'voltmeter' || comp.type === 'ammeter') {
            if (typeof showIllustrations !== 'undefined' && showIllustrations) {
                const isV = comp.type === 'voltmeter';
                const val = (this.simulationResults) ? (isV ?
                    (function () {
                        const { n1, n2 } = getCompNodeNames(comp);
                        return ((this.simulationResults.voltages[n1] || 0) - (this.simulationResults.voltages[n2] || 0));
                    }.bind(this))() :
                    (this.simulationResults.currents[comp.id] || 0)) : 0;

                // 導線
                ctx.beginPath();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-36, 0);
                ctx.moveTo(36, 0); ctx.lineTo(64, 0);
                ctx.stroke();

                // 本体 (2Dと共通の配色)
                ctx.fillStyle = isV ? '#1e3a8a' : '#334155';
                ctx.beginPath();
                const bx = -36, by = -36, bw = 72, bh = 72, br = 10;
                ctx.moveTo(bx + br, by);
                ctx.arcTo(bx + bw, by, bx + bw, by + bh, br);
                ctx.arcTo(bx + bw, by + bh, bx, by + bh, br);
                ctx.arcTo(bx, by + bh, bx, by, br);
                ctx.arcTo(bx, by, bx + bw, by, br);
                ctx.closePath();
                ctx.fill();

                // 文字盤 (白)
                ctx.fillStyle = '#f8f9fa';
                ctx.beginPath();
                ctx.arc(0, 0, 30, Math.PI, 0);
                ctx.lineTo(30, 6); ctx.lineTo(-30, 6);
                ctx.closePath();
                ctx.fill();

                // 指針 (赤)
                const maxLimit = comp.range || (isV ? 300 : 5);
                const ratio = Math.max(Math.min(val / maxLimit, 1.1), -0.1);
                const angle = (-50 + ratio * 100) * Math.PI / 180;

                ctx.save();
                ctx.translate(0, 10);
                ctx.rotate(angle);
                ctx.strokeStyle = '#e03131';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(0, -32);
                ctx.stroke();
                ctx.restore();

                // ラベル V/A
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 20px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(isV ? 'V' : 'A', 0, 26);

                // 端子 (プラス:赤, マイナス:黒)
                ctx.fillStyle = '#ff4444';
                ctx.beginPath(); ctx.arc(-22, 26, 6, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#333333';
                ctx.beginPath(); ctx.arc(22, 26, 6, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); // 後続の stroke() が端子に適用されないようにパスをクリア
            } else {
                const t = comp.type === 'voltmeter' ? 'V' : 'A';
                ctx.lineWidth = 3;
                ctx.moveTo(-64, 0); ctx.lineTo(-28, 0);
                ctx.moveTo(28, 0); ctx.lineTo(64, 0);
                ctx.stroke(); ctx.beginPath();
                ctx.fillStyle = '#ffffff';
                ctx.arc(0, 0, 28, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 5; // 円を少し太く(6から5に微調整)
                ctx.stroke(); ctx.beginPath();
                ctx.lineWidth = 3; // 元に戻す
                ctx.fillStyle = '#000'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.save();
                if (comp.rotation) { ctx.rotate(-comp.rotation * Math.PI / 2); }
                ctx.fillText(t, 0, 2);
                ctx.restore();

                // 図記号モードでも端子は表示 (2Dの X=26 を2倍して 52)
                ctx.fillStyle = '#ff0000';
                ctx.beginPath(); ctx.arc(-52, 0, 8, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = '#777777';
                ctx.beginPath(); ctx.arc(52, 0, 8, 0, Math.PI * 2); ctx.fill();
                ctx.stroke();
            }
        }

        ctx.stroke();
        ctx.restore();

        // 枠線のハイライトをテクスチャの縁に描画
        if (isHighlighted) {
            ctx.strokeStyle = '#a5d8ff';
            ctx.lineWidth = 16;
            ctx.strokeRect(0, 0, 128, 128);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        this.textureParams[key] = tex;
        return tex;
    }

    highlightComponent(id) {
        if (!this.isActive) return;
        this.meshes.forEach(mesh => {
            if (mesh.userData.comp && mesh.userData.comp.id === id) {
                const hlTex = this.getComponentTexture(mesh.userData.comp, true);
                mesh.material.map = hlTex;
                mesh.material.needsUpdate = true;
            }
        });
    }

    unhighlightComponent() {
        if (!this.isActive) return;
        this.meshes.forEach(mesh => {
            if (mesh.userData.comp) {
                const normalTex = this.getComponentTexture(mesh.userData.comp, false);
                mesh.material.map = normalTex;
                mesh.material.needsUpdate = true;
            }
        });
    }

    updateParticles(components, simulationResults) {
        if (!this.isActive || !this.particleMesh || !simulationResults) return;

        const showParticlesCheckbox = document.getElementById('show-particles-checkbox');
        if (showParticlesCheckbox && !showParticlesCheckbox.checked) {
            this.particleMesh.visible = false;
            if (this.negParticleMesh) this.negParticleMesh.visible = false;
            return;
        }
        this.particleMesh.visible = true;
        if (this.negParticleMesh) this.negParticleMesh.visible = true;

        let count = 0;
        let negCount = 0;
        const dummy = new THREE.Object3D();
        const negDummy = new THREE.Object3D();

        // クラス共通の最小電位を基準とする（未設定なら0）
        const minV = this.minV !== undefined ? this.minV : 0;

        components.forEach(comp => {
            const cx = (comp.x + 0.5 - this.cx) * this.GRID_SCALE;
            const cy = -(comp.y + 0.5 - this.cy) * this.GRID_SCALE;

            const leftNode = `v_${comp.x}_${comp.y}`;
            const rightNode = `v_${comp.x + 1}_${comp.y}`;
            const topNode = `h_${comp.x}_${comp.y}`;
            const bottomNode = `h_${comp.x}_${comp.y + 1}`;

            const getV = (node) => (simulationResults.voltages[node] !== undefined ? simulationResults.voltages[node] : minV);
            // 素子が等電位である場合に、接続されているいずれかのノードから有効な電位を取得する
            const getAnyV = () => {
                const vals = [simulationResults.voltages[leftNode], simulationResults.voltages[rightNode], simulationResults.voltages[topNode], simulationResults.voltages[bottomNode]];
                for (const v of vals) { if (v !== undefined) return v; }
                return minV;
            };

            if (comp.type === 'wire_cross') {
                const eqV = getAnyV(); // 十字も等電位
                const z = (eqV - minV) * this.Z_SCALE;
                const activeSides = ['left', 'right', 'top', 'bottom'];

                activeSides.forEach(side => {
                    if (!comp.legProgress || comp.legProgress[side] === undefined) return;
                    const num = 2;
                    for (let p = 0; p < num; p++) {
                        if (count >= 2000) break;
                        const normProg = (comp.legProgress[side] + p / num) % 1;
                        let lx = 0, ly = 0;
                        if (side === 'left') { lx = -0.5 + normProg * 0.5; ly = 0; }
                        else if (side === 'right') { lx = 0.5 - normProg * 0.5; ly = 0; }
                        else if (side === 'top') { lx = 0; ly = 0.5 - normProg * 0.5; }
                        else if (side === 'bottom') { lx = 0; ly = -0.5 + normProg * 0.5; }

                        dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, z + 2);
                        dummy.updateMatrix();
                        if (typeof isElectronMode !== 'undefined' && isElectronMode && this.negParticleMesh) {
                            this.negParticleMesh.setMatrixAt(negCount++, dummy.matrix);
                        } else {
                            this.particleMesh.setMatrixAt(count++, dummy.matrix);
                        }
                    }
                });
            } else if (comp.type === 'wire_t') {
                const midNode = `mid_${comp.x}_${comp.y}`;
                const eqV = simulationResults.voltages[midNode] !== undefined ? simulationResults.voltages[midNode] : getAnyV();
                const z = (eqV - minV) * this.Z_SCALE;
                
                const i1 = simulationResults.currents[comp.id + '_1'] || 0;
                const i2 = simulationResults.currents[comp.id + '_2'] || 0;
                const i3 = simulationResults.currents[comp.id + '_3'] || 0;
                
                const activeSides = [];
                if (comp.rotation === 0) activeSides.push({s:'left', i:i1}, {s:'right', i:i2}, {s:'bottom', i:i3});
                else if (comp.rotation === 1) activeSides.push({s:'top', i:i1}, {s:'bottom', i:i2}, {s:'left', i:i3});
                else if (comp.rotation === 2) activeSides.push({s:'left', i:i1}, {s:'right', i:i2}, {s:'top', i:i3});
                else activeSides.push({s:'top', i:i1}, {s:'bottom', i:i2}, {s:'right', i:i3});

                activeSides.forEach(leg => {
                    const side = leg.s;
                    if (!comp.legProgress || comp.legProgress[side] === undefined) return;
                    const num = 2;
                    for (let p = 0; p < num; p++) {
                        if (count >= 2000) break;
                        const normProg = (comp.legProgress[side] + p / num) % 1;
                        let lx = 0, ly = 0;
                        const half = 0.5;
                        if (side === 'left') { lx = -half + normProg * half; ly = 0; }
                        else if (side === 'right') { lx = half - normProg * half; ly = 0; }
                        else if (side === 'top') { lx = 0; ly = half - normProg * half; }
                        else if (side === 'bottom') { lx = 0; ly = -half + normProg * half; }

                        dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, z + 2);
                        dummy.updateMatrix();
                        if (typeof isElectronMode !== 'undefined' && isElectronMode && this.negParticleMesh) {
                            this.negParticleMesh.setMatrixAt(negCount++, dummy.matrix);
                        } else {
                            this.particleMesh.setMatrixAt(count++, dummy.matrix);
                        }
                    }
                });
            } else if (comp.type === 'wire_l') {
                const midNode = `mid_${comp.x}_${comp.y}`;
                const eqV = simulationResults.voltages[midNode] !== undefined ? simulationResults.voltages[midNode] : getAnyV();
                const z = (eqV - minV) * this.Z_SCALE;
                
                let iT = 0, iR = 0, iB = 0, iL = 0;
                if (comp.rotation === 0) {
                    iT = simulationResults.currents[comp.id + '_T'] || 0;
                    iR = simulationResults.currents[comp.id + '_R'] || 0;
                } else if (comp.rotation === 1) {
                    iR = simulationResults.currents[comp.id + '_R'] || 0;
                    iB = simulationResults.currents[comp.id + '_B'] || 0;
                } else if (comp.rotation === 2) {
                    iB = simulationResults.currents[comp.id + '_B'] || 0;
                    iL = simulationResults.currents[comp.id + '_L'] || 0;
                } else {
                    iL = simulationResults.currents[comp.id + '_L'] || 0;
                    iT = simulationResults.currents[comp.id + '_T'] || 0;
                }

                const legs = [];
                if (comp.rotation === 0) legs.push({s:'top', i:iT}, {s:'right', i:iR});
                else if (comp.rotation === 1) legs.push({s:'right', i:iR}, {s:'bottom', i:iB});
                else if (comp.rotation === 2) legs.push({s:'bottom', i:iB}, {s:'left', i:iL});
                else legs.push({s:'left', i:iL}, {s:'top', i:iT});

                legs.forEach(leg => {
                    const side = leg.s;
                    if (!comp.legProgress || comp.legProgress[side] === undefined) return;
                    const num = 2;
                    for (let p = 0; p < num; p++) {
                        if (count >= 2000) break;
                        const normProg = (comp.legProgress[side] + p / num) % 1;
                        let lx = 0, ly = 0;
                        const half = 0.5;
                        if (side === 'left') { lx = -half + normProg * half; ly = 0; }
                        else if (side === 'right') { lx = half - normProg * half; ly = 0; }
                        else if (side === 'top') { lx = 0; ly = half - normProg * half; }
                        else if (side === 'bottom') { lx = 0; ly = -half + normProg * half; }

                        dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, z + 2);
                        dummy.updateMatrix();
                        if (typeof isElectronMode !== 'undefined' && isElectronMode && this.negParticleMesh) {
                            this.negParticleMesh.setMatrixAt(negCount++, dummy.matrix);
                        } else {
                            this.particleMesh.setMatrixAt(count++, dummy.matrix);
                        }
                    }
                });
            } else if (comp.type === 'capacitor') {
                let v1, v2;
                if (comp.rotation === 0) { v1 = getV(leftNode); v2 = getV(rightNode); }
                else if (comp.rotation === 1) { v1 = getV(topNode); v2 = getV(bottomNode); }
                else if (comp.rotation === 2) { v1 = getV(rightNode); v2 = getV(leftNode); }
                else { v1 = getV(bottomNode); v2 = getV(topNode); }

                // 1. Static Stored Charges (Plate Colony)
                const plateDiff = v1 - v2;
                const rawNum = Math.abs(plateDiff) * 8;
                const numStatic = Math.min(Math.ceil(rawNum), 40);
                if (numStatic > 0) {
                    const isV1Positive = plateDiff > 0;
                    for (let s = 0; s < numStatic; s++) {
                        if (count >= 2000 || negCount >= 2000) break;
                        const hash1 = Math.abs(Math.sin(s * 12.9898 + comp.x * 78.233 + comp.y) * 43758.5453);
                        const hash2 = Math.abs(Math.sin(s * 78.233 + comp.x * 12.9898 + comp.y * 3) * 43758.5453);
                        const rand1 = hash1 - Math.floor(hash1);
                        const rand2 = hash2 - Math.floor(hash2);

                        const rY = -0.23 + rand1 * 0.46;
                        const rX = -0.025 + rand2 * 0.05;

                        let splx, sply, snlx, snly, sz, nz;
                        const isIll = (typeof showIllustrations !== 'undefined' && showIllustrations);
                        const v1Offset = (comp.rotation === 0) ? (isIll ? -0.125 : -0.117) : (comp.rotation === 1) ? (isIll ? 0.125 : 0.117) : (comp.rotation === 2) ? (isIll ? 0.125 : 0.117) : (isIll ? -0.125 : -0.117);
                        const v2Offset = -v1Offset;

                        const posOffset = isV1Positive ? v1Offset : v2Offset;
                        const negOffset = isV1Positive ? v2Offset : v1Offset;

                        if (comp.rotation === 0 || comp.rotation === 2) {
                            splx = posOffset + (isV1Positive ? rX : -rX); sply = rY;
                            snlx = negOffset + (isV1Positive ? rX : -rX); snly = rY;
                        } else {
                            sply = posOffset - (isV1Positive ? rX : -rX); splx = rY;
                            snly = negOffset - (isV1Positive ? rX : -rX); snlx = rY;
                        }
                        
                        sz = isV1Positive ? v1 : v2;
                        nz = isV1Positive ? v2 : v1;

                        const scaleFactor = Math.min(Math.max(rawNum - s, 0), 1);

                        // Positive Charge
                        dummy.position.set(cx + splx * this.GRID_SCALE, cy + sply * this.GRID_SCALE, (sz - minV) * this.Z_SCALE + 2);
                        dummy.scale.set(scaleFactor, scaleFactor, scaleFactor);
                        dummy.updateMatrix();
                        this.particleMesh.setMatrixAt(count++, dummy.matrix);

                        // Negative Charge
                        if (this.negParticleMesh) {
                            negDummy.position.set(cx + snlx * this.GRID_SCALE, cy + snly * this.GRID_SCALE, (nz - minV) * this.Z_SCALE + 2);
                            negDummy.scale.set(scaleFactor, scaleFactor, scaleFactor);
                            negDummy.updateMatrix();
                            this.negParticleMesh.setMatrixAt(negCount++, negDummy.matrix);
                        }
                    }
                    // 他の粒子に影響しないようスケールをリセット
                    dummy.scale.set(1, 1, 1);
                    if (this.negParticleMesh) negDummy.scale.set(1, 1, 1);
                }

                // 2. Moving Charges (Wires)
                const num = 2;
                for (let p = 0; p < num; p++) {
                    const prog = (comp.pProgress + p / num) % 1;
                    for (let wire = 0; wire < 2; wire++) {
                        if (count >= 2000) break;
                        let lx = 0, ly = 0, z = 0;
                        const wireProg = (wire === 0) ? prog * 0.4 : 0.6 + prog * 0.4;
                        const currentV = (wire === 0) ? v1 : v2;
                        z = (currentV - minV) * this.Z_SCALE;

                        if (comp.rotation === 0) { lx = -0.5 + wireProg; ly = 0; }
                        else if (comp.rotation === 1) { lx = 0; ly = 0.5 - wireProg; }
                        else if (comp.rotation === 2) { lx = 0.5 - wireProg; ly = 0; }
                        else { lx = 0; ly = -0.5 + wireProg; }

                        dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, z + 2);
                        dummy.updateMatrix();
                        if (typeof isElectronMode !== 'undefined' && isElectronMode && this.negParticleMesh) {
                            this.negParticleMesh.setMatrixAt(negCount++, dummy.matrix);
                        } else {
                            this.particleMesh.setMatrixAt(count++, dummy.matrix);
                        }
                    }
                }
            } else {
                const num = 4;
                for (let p = 0; p < num; p++) {
                    if (count >= 2000) break;
                    const prog = (comp.pProgress + p / num) % 1;
                    let lx = 0, ly = 0;
                    if (comp.rotation === 0) { lx = -0.5 + prog; ly = 0; }
                    else if (comp.rotation === 1) { lx = 0; ly = 0.5 - prog; }
                    else if (comp.rotation === 2) { lx = 0.5 - prog; ly = 0; }
                    else { lx = 0; ly = -0.5 + prog; }

                    // Unified coordinate system: vPos is always n1, vNeg is always n2
                    // prog=0 is n1(Pos), prog=1 is n2(Neg)
                    let vPos, vNeg;
                    if (comp.rotation === 0) { vPos = getV(leftNode); vNeg = getV(rightNode); }
                    else if (comp.rotation === 1) { vPos = getV(topNode); vNeg = getV(bottomNode); }
                    else if (comp.rotation === 2) { vPos = getV(rightNode); vNeg = getV(leftNode); }
                    else { vPos = getV(bottomNode); vNeg = getV(topNode); }

                    let z = 0;
                    if (comp.type === 'battery') {
                        const emf = parseFloat(comp.value) || 0;
                        const vPeak = vNeg + emf;
                        // prog 0(Pos)..1(Neg)
                        if (prog < 0.5) z = vPos + (vPeak - vPos) * (prog / 0.5); // Peak to Pos slope
                        else if (prog < 0.51) z = vPeak; // Jump
                        else z = vNeg; // Neg side
                    } else if (comp.type === 'ac_source') {
                        const i = simulationResults.currents[comp.id] || 0;
                        const rInt = (comp.rInt !== undefined) ? comp.rInt : 0.001;
                        const vIr = i * rInt;
                        const vPeak = vPos - vIr;
                        if (prog < 0.5) z = vPos + (vPeak - vPos) * (prog / 0.5);
                        else if (prog < 0.51) z = vPeak;
                        else z = vNeg;
                    } else if (comp.type === 'switch') {
                        z = (prog < 0.5 ? vPos : vNeg);
                    } else {
                        z = vPos + (vNeg - vPos) * prog;
                    }
                    z = (z - minV) * this.Z_SCALE;

                    dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, z + 2);
                    dummy.updateMatrix();
                    if (typeof isElectronMode !== 'undefined' && isElectronMode && this.negParticleMesh) {
                        this.negParticleMesh.setMatrixAt(negCount++, dummy.matrix);
                    } else {
                        this.particleMesh.setMatrixAt(count++, dummy.matrix);
                    }
                }
            }
        });

        // 残りのインスタンスを場外へ
        dummy.position.set(0, 0, -10000);
        dummy.updateMatrix();
        for (; count < 2000; count++) {
            this.particleMesh.setMatrixAt(count, dummy.matrix);
        }
        this.particleMesh.instanceMatrix.needsUpdate = true;

        if (this.negParticleMesh) {
            negDummy.position.set(0, 0, -10000);
            negDummy.updateMatrix();
            for (; negCount < 2000; negCount++) {
                this.negParticleMesh.setMatrixAt(negCount, negDummy.matrix);
            }
            this.negParticleMesh.instanceMatrix.needsUpdate = true;
        }
    }

    updateGrid() {
        if (!this.gridLines) return;

        // 既存の線をクリア
        while (this.gridLines.children.length > 0) {
            this.gridLines.remove(this.gridLines.children[0]);
        }

        const material = new THREE.LineBasicMaterial({
            color: 0x000000,
            opacity: 0.1,
            transparent: true
        });

        const points = [];
        const scale = this.GRID_SCALE;
        const gx = this.GRID_SIZE_X || 11;
        const gy = this.GRID_SIZE_Y || 7;
        const cx = this.cx || 0;
        const cy = this.cy || 0;

        // 垂直線
        for (let i = 0; i <= gx; i++) {
            const x = (i - cx) * scale;
            points.push(new THREE.Vector3(x, cy * scale, 0));
            points.push(new THREE.Vector3(x, -(gy - cy) * scale, 0));
        }

        // 水平線
        for (let j = 0; j <= gy; j++) {
            const y = -(j - cy) * scale;
            points.push(new THREE.Vector3(-cx * scale, y, 0));
            points.push(new THREE.Vector3((gx - cx) * scale, y, 0));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const lines = new THREE.LineSegments(geometry, material);

        this.gridLines.add(lines);
    }
}

// Global instance to be used in main.js
const simulator3D = new Simulator3D('canvas-3d-container');
