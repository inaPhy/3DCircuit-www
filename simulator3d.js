class Simulator3D {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.meshes = [];
        this.isActive = false;
        
        this.GRID_SCALE = 50; // Visual scale factor for grid X/Y
        this.Z_SCALE = 30;    // Visual scale factor for voltage Z
        this.textureParams = {}; // Cache to avoid recreating textures unnecessarily
    }

    init() {
        if (this.scene) return;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#ffdce6');

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
        this.camera.position.set(0, -600, 600); // Isometric-ish
        this.camera.up.set(0, 0, 1); // Z is up

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
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
            if (comp.type === 'battery') {
                const isHoriz = (comp.rotation === 0 || comp.rotation === 2);
                const n1 = isHoriz ? `v_${comp.x}_${comp.y}` : `h_${comp.x}_${comp.y}`;
                const n2 = isHoriz ? `v_${comp.x+1}_${comp.y}` : `h_${comp.x}_${comp.y+1}`;
                const v1 = simulationResults.voltages[n1];
                const v2 = simulationResults.voltages[n2];
                // 実質的に機能している（MNAで電位差が解かれている）電池のみをアクティブの起点とする
                if (v1 !== undefined && v2 !== undefined && Math.abs(v1 - v2) > 0.1) {
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
        let minV = Infinity;
        for (const node of activeNodes) {
            const v = simulationResults.voltages[node];
            if (v !== undefined && v < minV) minV = v;
        }
        if (minV === Infinity) minV = 0;

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
            // 電池とコンデンサーとスイッチは垂直に切り立つ崖（Cliff）を表現
            if (['battery', 'capacitor', 'switch'].includes(comp.type)) {
                profile = [ [0, vStart], [0.49, vStart], [0.51, vEnd], [1, vEnd] ];
            } else {
                // 抵抗などはなだらかな斜面
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

    getComponentTexture(comp) {
        // Simple caching based on type, rotation, and state
        const stateKey = comp.type === 'switch' ? (comp.value === 1 ? "on" : "off") : "";
        const key = comp.type + "_" + comp.rotation + "_" + stateKey;
        if (this.textureParams[key]) return this.textureParams[key];

        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        // Background color
        if (comp.type === 'battery') ctx.fillStyle = 'rgba(255, 120, 120, 0.9)';
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

        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = 4;
        this.textureParams[key] = tex;
        return tex;
    }
}

// Global instance to be used in main.js
const simulator3D = new Simulator3D('canvas-3d-container');
