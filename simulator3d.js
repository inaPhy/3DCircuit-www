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

        // Grid plane at Z=0
        const gridHelper = new THREE.GridHelper(2000, 40, 0x000000, 0x000000);
        gridHelper.material.opacity = 0.1;
        gridHelper.material.transparent = true;
        gridHelper.rotation.x = Math.PI / 2; 
        this.scene.add(gridHelper);
        
        // 電荷表示用のインスタンスメッシュ（最大2000個）
        const particleGeo = new THREE.SphereGeometry(2, 6, 6);
        const particleMat = new THREE.MeshBasicMaterial({ color: 0xfcc419 });
        this.particleMesh = new THREE.InstancedMesh(particleGeo, particleMat, 2000);
        this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.scene.add(this.particleMesh);

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

            const uvs = new Float32Array([...[0,1, 1,1, 0,0, 1,1, 1,0, 0,0], ...(new Array(24 * 2).fill(0))]);
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
        if (!this.isActive || !this.scene || !simulationResults || !components) return;

        this.circuitComponents = components;

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
            if (comp.type === 'battery' || comp.type === 'ac_source') {
                const isHoriz = (comp.rotation === 0 || comp.rotation === 2);
                const n1 = isHoriz ? `v_${comp.x}_${comp.y}` : `h_${comp.x}_${comp.y}`;
                const n2 = isHoriz ? `v_${comp.x+1}_${comp.y}` : `h_${comp.x}_${comp.y+1}`;
                const v1 = simulationResults.voltages[n1];
                const v2 = simulationResults.voltages[n2];
                // 実質的に機能している（MNAで電位差が解かれている）電源をアクティブの起点とする。
                // 交流電源は0Vを跨ぐため、しきい値は十分に小さく設定する。
                if (v1 !== undefined && v2 !== undefined && (Math.abs(v1 - v2) > 1e-6 || comp.type === 'ac_source')) {
                    activeNodes.add(n1);
                    activeNodes.add(n2);
                }
            }
        });
        let changed = true;
        while(changed) {
            changed = false;
            this.circuitComponents.forEach(comp => {
                if (comp.type === 'switch' && comp.value !== 1) return; // 開いたスイッチは伝播しない

                const isHoriz = (comp.rotation === 0 || comp.rotation === 2 || (comp.type === 'wire' && (comp.rotation===0||comp.rotation===2)));
                let nodesForComp = [];
                if (['wire_l', 'wire_t'].includes(comp.type)) {
                    nodesForComp = [`v_${comp.x}_${comp.y}`, `v_${comp.x+1}_${comp.y}`, `h_${comp.x}_${comp.y}`, `h_${comp.x}_${comp.y+1}`];
                } else if (isHoriz) {
                    nodesForComp = [`v_${comp.x}_${comp.y}`, `v_${comp.x+1}_${comp.y}`];
                } else {
                    nodesForComp = [`h_${comp.x}_${comp.y}`, `h_${comp.x}_${comp.y+1}`];
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

        // activeNodesに含まれる電圧のみを使ってminVを決定する（ノイズとしての0Vを排除）
        // 常に0Vを基準（地面）とする。AC回路などで負の電位がある場合は地面の下に描画されるが、
        // そうしないと0V地点（未接続素子など）がACの変動に合わせて跳ね上がってしまう。
        let minV = 0;

        this.circuitComponents.forEach(comp => {
            const leftNode = `v_${comp.x}_${comp.y}`;
            const rightNode = `v_${comp.x + 1}_${comp.y}`;
            const topNode = `h_${comp.x}_${comp.y}`;
            const bottomNode = `h_${comp.x}_${comp.y + 1}`;

            const getV = (node) => {
                const v = simulationResults.voltages[node];
                if (!activeNodes.has(node)) return minV; // バッテリーに繋がっていない孤立ノードはMNA上の0Vを無視して地面(minV)に落とす
                return v !== undefined ? v : minV; 
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

            if (['wire_l', 'wire_t'].includes(comp.type)) {
                vStart = eqV; vEnd = eqV;
            } else if (comp.rotation === 0 || comp.rotation === 2 || (comp.type === 'wire' && (comp.rotation===0||comp.rotation===2))) {
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
                        profile = [ [0, vStart], [0.5, vEnd + emf], [0.51, vEnd], [1, vEnd] ];
                    } else {
                        // vStart: Neg, vEnd: Pos. Peak is always vStart + EMF
                        profile = [ [0, vStart], [0.49, vStart], [0.5, vStart + emf], [1, vEnd] ];
                    }
                } else {
                    // ac_source stays relative to handle animation
                    if (comp.rotation === 0 || comp.rotation === 1) {
                        profile = [ [0, vStart], [0.5, vStart - vIr], [0.51, vEnd], [1, vEnd] ];
                    } else {
                        profile = [ [0, vStart], [0.49, vStart], [0.5, vEnd - vIr], [1, vEnd] ];
                    }
                }
            } else if (['capacitor', 'switch'].includes(comp.type)) {
                profile = [ [0, vStart], [0.49, vStart], [0.51, vEnd], [1, vEnd] ];
            } else {
                profile = [ [0, vStart], [1, vEnd] ];
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
                const tB = profile[i+1][0], zB = profile[i+1][1] * this.Z_SCALE;

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

            // パネルの周りは実線
            const topEdges = new THREE.EdgesGeometry(topGeometry);
            const topLines = new THREE.LineSegments(topEdges, new THREE.LineBasicMaterial({ color: 0x555555, opacity: 0.4, transparent: true }));
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
            mesh.add(wallLines);

            mesh.userData.lines = [topLines, wallLines];

            this.scene.add(mesh);
            this.meshes.push(mesh);
        });
    }

    getComponentTexture(comp, isHighlighted = false) {
        const isDarkMode = !document.documentElement.classList.contains('light-mode');
        // Simple caching based on type, rotation, state, and theme
        const stateKey = comp.type === 'switch' ? (comp.value === 1 ? "on" : "off") : "";
        const themeKey = isDarkMode ? "dark" : "light";
        const key = comp.type + "_" + comp.rotation + "_" + stateKey + "_" + themeKey + (isHighlighted ? "_hl" : "");
        if (this.textureParams[key]) return this.textureParams[key];

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

        ctx.strokeStyle = '#000';
        ctx.lineWidth = 6;
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
        } else if (comp.type === 'wire_t') {
            ctx.moveTo(-64, 0); ctx.lineTo(64, 0); 
            ctx.moveTo(0, 0); ctx.lineTo(0, 64);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#000'; ctx.arc(0,0,4,0,Math.PI*2); ctx.fill();
        } else if (comp.type === 'resistor') {
            ctx.moveTo(-64, 0); ctx.lineTo(-30, 0);
            ctx.moveTo(30, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(-30, -15, 60, 30);
            ctx.strokeRect(-30, -15, 60, 30);
        } else if (comp.type === 'battery') {
            ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
            ctx.moveTo(15, 0); ctx.lineTo(64, 0);
            ctx.moveTo(-15, -30); ctx.lineTo(-15, 30);
            ctx.moveTo(15, -16); ctx.lineTo(15, 16);
            ctx.stroke(); ctx.beginPath();
        } else if (comp.type === 'ac_source') {
            ctx.moveTo(-64, 0); ctx.lineTo(-36, 0);
            ctx.moveTo(36, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            
            ctx.fillStyle = '#ffffff';
            ctx.lineWidth = 8; // わずかに細く (10 から 8 へ)
            ctx.arc(0, 0, 36, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke(); ctx.beginPath();

            ctx.lineWidth = 6; // 波は元の太さに戻す
            // サイン波を平坦化 (20 -> 12)
            ctx.moveTo(-20, 0);
            ctx.bezierCurveTo(-20, -12, -10, -12, 0, 0);
            ctx.bezierCurveTo(10, 12, 20, 12, 20, 0);
            ctx.stroke(); ctx.beginPath();
        } else if (comp.type === 'capacitor') {
            ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
            ctx.moveTo(-15, -30); ctx.lineTo(-15, 30);
            ctx.moveTo(15, -30); ctx.lineTo(15, 30);
            ctx.moveTo(15, 0); ctx.lineTo(64, 0);
        } else if (comp.type === 'switch') {
            ctx.moveTo(-64, 0); ctx.lineTo(-15, 0);
            ctx.moveTo(15, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle='#000'; 
            ctx.arc(-15,0,5,0,Math.PI*2); ctx.fill(); ctx.beginPath();
            if (comp.value === 1) {
                ctx.moveTo(-15, 0); ctx.lineTo(15, 0);
                ctx.stroke(); ctx.beginPath();
            }
            ctx.arc(15,0,5,0,Math.PI*2); ctx.fill(); ctx.beginPath();
        } else if (comp.type === 'bulb') {
            ctx.moveTo(-64, 0); ctx.lineTo(-28, 0);
            ctx.moveTo(28, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#ffffff';
            ctx.arc(0, 0, 28, 0, Math.PI*2);
            ctx.fill(); ctx.stroke(); ctx.beginPath();
            ctx.moveTo(-18, -18); ctx.lineTo(18, 18);
            ctx.moveTo(-18, 18); ctx.lineTo(18, -18);
        } else if (comp.type === 'inductor') {
            ctx.moveTo(-64, 0); ctx.lineTo(-30, 0);
            // 4つの山を等間隔で描画 (幅60を15ずつに分割し半径7.5)
            ctx.arc(-22.5, 0, 7.5, Math.PI, 0);
            ctx.arc(-7.5,  0, 7.5, Math.PI, 0);
            ctx.arc(7.5,   0, 7.5, Math.PI, 0);
            ctx.arc(22.5,  0, 7.5, Math.PI, 0);
            ctx.moveTo(30, 0); ctx.lineTo(64, 0);
        } else if (comp.type === 'voltmeter' || comp.type === 'ammeter') {
            const t = comp.type === 'voltmeter' ? 'V' : 'A';
            ctx.moveTo(-64, 0); ctx.lineTo(-28, 0);
            ctx.moveTo(28, 0); ctx.lineTo(64, 0);
            ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#ffffff';
            ctx.arc(0, 0, 28, 0, Math.PI*2);
            ctx.fill(); ctx.stroke(); ctx.beginPath();
            ctx.fillStyle = '#000'; ctx.font = 'bold 32px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.save();
            if (comp.rotation) { ctx.rotate(-comp.rotation * Math.PI / 2); }
            ctx.fillText(t, 0, 2);
            ctx.restore();
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
            return;
        }
        this.particleMesh.visible = true;

        let count = 0;
        const dummy = new THREE.Object3D();
        
        // 常に0Vを基準（地面）とする
        const minV = 0;

        components.forEach(comp => {
            const cx = (comp.x + 0.5 - this.cx) * this.GRID_SCALE;
            const cy = -(comp.y + 0.5 - this.cy) * this.GRID_SCALE;
            
            const leftNode = `v_${comp.x}_${comp.y}`;
            const rightNode = `v_${comp.x+1}_${comp.y}`;
            const topNode = `h_${comp.x}_${comp.y}`;
            const bottomNode = `h_${comp.x}_${comp.y+1}`;

            const getV = (node) => (simulationResults.voltages[node] !== undefined ? simulationResults.voltages[node] : minV);
            // 素子が等電位である場合に、接続されているいずれかのノードから有効な電位を取得する
            const getAnyV = () => {
                const vals = [simulationResults.voltages[leftNode], simulationResults.voltages[rightNode], simulationResults.voltages[topNode], simulationResults.voltages[bottomNode]];
                for (const v of vals) { if (v !== undefined) return v; }
                return minV;
            };

            if (comp.type === 'wire_t') {
                const eqV = getAnyV(); // T字は等電位
                const z = (eqV - minV) * this.Z_SCALE;
                
                let activeSides = [];
                if (comp.rotation === 0) activeSides = ['left', 'right', 'bottom'];
                else if (comp.rotation === 1) activeSides = ['top', 'bottom', 'left'];
                else if (comp.rotation === 2) activeSides = ['left', 'right', 'top'];
                else activeSides = ['top', 'bottom', 'right'];

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
                        this.particleMesh.setMatrixAt(count++, dummy.matrix);
                    }
                });
            } else if (comp.type === 'wire_l') {
                const eqV = getAnyV(); // L字は等電位
                const z = (eqV - minV) * this.Z_SCALE;
                const num = 4;
                for (let p = 0; p < num; p++) {
                    if (count >= 2000) break;
                    const prog = (comp.pProgress + p / num) % 1;
                    let lx, ly;
                    if (prog < 0.5) {
                        lx = 0; ly = -0.5 + prog; // 2D: Top to Center
                    } else {
                        lx = (prog - 0.5); ly = 0; // 2D: Center to Right
                    }
                    // Apply rotation in 2D space then invert Y for 3D
                    let rx = lx, ry = ly;
                    if (comp.rotation === 1) { const tx = rx; rx = -ry; ry = tx; }
                    else if (comp.rotation === 2) { rx = -rx; ry = -ry; }
                    else if (comp.rotation === 3) { const tx = rx; rx = ry; ry = -tx; }
                    
                    dummy.position.set(cx + rx * this.GRID_SCALE, cy - ry * this.GRID_SCALE, z + 2);
                    dummy.updateMatrix();
                    this.particleMesh.setMatrixAt(count++, dummy.matrix);
                }
            } else if (comp.type === 'capacitor') {
                let v1, v2;
                if (comp.rotation === 0) { v1 = getV(leftNode); v2 = getV(rightNode); }
                else if (comp.rotation === 1) { v1 = getV(topNode); v2 = getV(bottomNode); }
                else if (comp.rotation === 2) { v1 = getV(rightNode); v2 = getV(leftNode); }
                else { v1 = getV(bottomNode); v2 = getV(topNode); }
                
                // 1. Static Stored Charges (Plate Colony)
                const plateDiff = v1 - v2;
                const numStatic = Math.min(Math.round(Math.abs(plateDiff) * 8), 40);
                if (numStatic > 0) {
                    const isV1Positive = plateDiff > 0;
                    for (let s = 0; s < numStatic; s++) {
                        if (count >= 2000) break;
                        const hash1 = Math.abs(Math.sin(s * 12.9898 + comp.x * 78.233 + comp.y) * 43758.5453);
                        const hash2 = Math.abs(Math.sin(s * 78.233 + comp.x * 12.9898 + comp.y * 3) * 43758.5453);
                        const rand1 = hash1 - Math.floor(hash1);
                        const rand2 = hash2 - Math.floor(hash2);
                        
                        const rY = -0.23 + rand1 * 0.46; 
                        const rX = -0.025 + rand2 * 0.05;
                        
                        let lx, ly, z;
                        const v1Offset = (comp.rotation === 0) ? -0.08 : (comp.rotation === 1) ? 0.08 : (comp.rotation === 2) ? 0.08 : -0.08;
                        const v2Offset = -v1Offset;
                        
                        if (comp.rotation === 0 || comp.rotation === 2) {
                            lx = (isV1Positive ? v1Offset : v2Offset) + (isV1Positive ? rX : -rX); 
                            ly = rY;
                        } else {
                            ly = (isV1Positive ? v1Offset : v2Offset) - (isV1Positive ? rX : -rX);
                            lx = rY;
                        }
                        z = (isV1Positive ? v1 : v2);
                        
                        dummy.position.set(cx + lx * this.GRID_SCALE, cy + ly * this.GRID_SCALE, (z - minV) * this.Z_SCALE + 2);
                        dummy.updateMatrix();
                        this.particleMesh.setMatrixAt(count++, dummy.matrix);
                    }
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
                        this.particleMesh.setMatrixAt(count++, dummy.matrix);
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
                    this.particleMesh.setMatrixAt(count++, dummy.matrix);
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
    }
}

// Global instance to be used in main.js
const simulator3D = new Simulator3D('canvas-3d-container');
