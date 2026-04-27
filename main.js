const simulator = new Simulator();

// Config
const GRID_SIZE_X = 15;
const GRID_SIZE_Y = 10;
const CELL_SIZE = 60;
const SVG_WIDTH = GRID_SIZE_X * CELL_SIZE;
const SVG_HEIGHT = GRID_SIZE_Y * CELL_SIZE;

// State
let components = []; // { id, type, x, y, rotation, value }
let simulationResults = null;
let editingCompId = null;

// Dragging state
let dragTarget = null; // { type, ghostNode, isNew }
let draggedCompId = null; 
let isSimulating = false; // Simulation running state

// DOM
const svg = document.getElementById('grid-svg');
const circuitLayer = document.getElementById('circuit-layer');
const ghostLayer = document.getElementById('ghost-layer');
const interactionLayer = document.getElementById('interaction-layer');
const messageArea = document.getElementById('error-text');
const solveBtn = document.getElementById('solve-btn');
const trashCan = document.getElementById('trash-can');
const paramModal = document.getElementById('param-modal');
const tooltip = document.getElementById('tooltip');

// Init
function init() {
    svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
    document.documentElement.classList.add('light-mode'); // 3Dモデルの色と統一するため、デフォルトはライトモード
    renderGridBackground();
    setupEventListeners();
    render();
}

function renderGridBackground() {
    const bgGroup = document.getElementById('grid-lines');
    bgGroup.innerHTML = '';
    
    // Nodes as cells
    const fillColor = isSimulating ? 'rgba(255, 184, 198, 0.15)' : 'rgba(165, 216, 255, 0.15)';
    for (let x = 0; x < GRID_SIZE_X; x++) {
        for (let y = 0; y < GRID_SIZE_Y; y++) {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x * CELL_SIZE);
            rect.setAttribute('y', y * CELL_SIZE);
            rect.setAttribute('width', CELL_SIZE);
            rect.setAttribute('height', CELL_SIZE);
            rect.setAttribute('fill', fillColor);
            rect.setAttribute('stroke', 'var(--grid-line)'); // Softer borders for better light pastel colors
            rect.setAttribute('stroke-width', '1');
            bgGroup.appendChild(rect);
        }
    }
}

function setupEventListeners() {
    // Pointer DnD from toolbar
    document.querySelectorAll('.tool-item').forEach(item => {
        item.addEventListener('pointerdown', (e) => {
            const type = item.dataset.type;
            startDragging(e, type, true);
        });
    });

    // Global listeners for dragging
    window.addEventListener('pointermove', onDragging);
    window.addEventListener('pointerup', endDragging);

    // Dark Mode Toggle
    const darkModeCheckbox = document.getElementById('dark-mode-checkbox');
    if (darkModeCheckbox) {
        darkModeCheckbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.documentElement.classList.remove('light-mode');
            } else {
                document.documentElement.classList.add('light-mode');
            }
        });
    }

    // Solve / Stop / Results
    solveBtn.addEventListener('click', toggleSimulation);
    const resCheckbox = document.getElementById('results-toggle-checkbox');
    if (resCheckbox) {
        resCheckbox.addEventListener('change', (e) => {
            const panel = document.getElementById('results-panel');
            if (e.target.checked) {
                panel.style.display = 'block';
                updateResultsTable();
            } else {
                panel.style.display = 'none';
                document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
            }
        });
    }
    document.getElementById('close-results-btn').addEventListener('click', () => {
        document.getElementById('results-panel').style.display = 'none';
        const resCheckbox = document.getElementById('results-toggle-checkbox');
        if (resCheckbox) resCheckbox.checked = false;
        document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
    });

    // Modal
    document.getElementById('modal-cancel').onclick = () => paramModal.style.display = 'none';
    document.getElementById('modal-delete').onclick = () => {
        removeComponent(editingCompId);
        paramModal.style.display = 'none';
    };
    document.getElementById('modal-save').onclick = saveParams;
}

function updateResultsTable() {
    const tbody = document.querySelector('#results-table tbody');
    tbody.innerHTML = '';
    
    if (!simulationResults || !simulationResults.success) return;

    components.forEach(c => {
        if (c.type.startsWith('wire') || c.type === 'switch') return;
        
        const left = `v_${c.x}_${c.y}`;
        const right = `v_${c.x + 1}_${c.y}`;
        const top = `h_${c.x}_${c.y}`;
        const bottom = `h_${c.x}_${c.y + 1}`;
        
        let n1, n2;
        if (c.rotation === 0) { n1 = left; n2 = right; }
        else if (c.rotation === 1) { n1 = top; n2 = bottom; }
        else if (c.rotation === 2) { n1 = right; n2 = left; }
        else { n1 = bottom; n2 = top; }
        
        const volt = Math.abs(simulationResults.voltages[n1] - simulationResults.voltages[n2]) || 0;
        const curr = Math.abs(simulationResults.currents[c.id] || 0);

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `<td>${getLabel(c.type)} (${c.x},${c.y})</td><td>${volt.toFixed(2)}</td><td>${curr.toFixed(3)}</td>`;
        
        const highlightFn = () => {
            document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
            const group = document.getElementById(`comp-group-${c.id}`);
            if (group && isSimulating) {
                // Bring the component group to the front so highlight is not obscured by neighboring panels
                group.parentNode.appendChild(group);
                
                const hl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hl.setAttribute('x', -35); hl.setAttribute('y', -35);
                hl.setAttribute('width', 70); hl.setAttribute('height', 70);
                hl.setAttribute('fill', 'none');
                hl.setAttribute('stroke', '#a5d8ff');
                hl.setAttribute('stroke-width', '4');
                hl.setAttribute('rx', '8');
                hl.setAttribute('filter', 'drop-shadow(0 0 5px #a5d8ff)');
                hl.classList.add('comp-highlight');
                group.appendChild(hl);  
            }
        };
        const unhighlightFn = () => {
            document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
        };

        tr.addEventListener('mouseenter', highlightFn);
        tr.addEventListener('mouseleave', unhighlightFn);

        tbody.appendChild(tr);
    });
}

function forceStopSimulation() {
    if (isSimulating) {
        toggleSimulation();
    }
}

function toggleSimulation() {
    isSimulating = !isSimulating;
    
    solveBtn.innerText = isSimulating ? '停止' : 'OK';
    solveBtn.style.backgroundColor = isSimulating ? '#a5d8ff' : '#ffb8c6';
    
    const toggleBtn = document.getElementById('results-toggle-container');
    if (toggleBtn) toggleBtn.style.display = isSimulating ? 'flex' : 'none';
    
    const showParticlesToggle = document.getElementById('show-particles-toggle');
    if (showParticlesToggle) showParticlesToggle.style.display = isSimulating ? 'flex' : 'none';

    // Default or Stop grid uses light pink if stopping while running
    renderGridBackground();

    if (isSimulating) {
        simulator.reset();
        activeNetlist = buildNetlist();
        const res = simulator.solve(activeNetlist, 1e-6);
        if (res.success) {
            simulationResults = res;
            messageArea.innerText = '開始'; // 短くする
            
            // Show results panel by default when simulation starts
            document.getElementById('results-panel').style.display = 'block';
            const resCheckbox = document.getElementById('results-toggle-checkbox');
            if (resCheckbox) resCheckbox.checked = true;
            updateResultsTable();
            
            simulator3D.show();
            simulator3D.update(components, simulationResults);
            
            render();
            startAnimation();
        } else {
            simulationResults = null;
            messageArea.innerText = res.message;
            messageArea.style.color = "var(--error-text)";
            render();
            forceStopSimulation();
        }
    } else {
        simulator3D.hide();
        simulationResults = null;
        messageArea.innerText = '';
        document.getElementById('results-panel').style.display = 'none';
        stopAnimation();
        simulator.reset(); // Clear explicit charge/history
        render(); // clears glow
    }
}

function startDragging(e, type, isNew, compId = null) {
    // Determine rotation
    let rot = 0;
    let val = undefined;
    if (compId) {
        const actual = components.find(c => c.id === compId);
        if (actual) {
            rot = actual.rotation;
            val = actual.value;
        }
    }

    // Create ghost wrapper
    const ghostWrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ghostWrapper.classList.add('ghost');
    ghostWrapper.style.pointerEvents = 'none';
    
    // Ghost inner group for rotation
    const ghostGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ghostGroup.setAttribute('transform', `rotate(${rot * 90})`);
    ghostGroup.appendChild(drawComponentVisual({ type, x: 0, y: 0, rotation: rot, value: val }));
    
    ghostWrapper.appendChild(ghostGroup);

    // Add upright text for ghost if applicable
    if (!type.startsWith('wire') && type !== 'switch' && type !== 'voltmeter' && type !== 'ammeter') {
        const unit = { battery: 'V', resistor: 'Ω', bulb: 'Ω', capacitor: 'μF', inductor: 'mH' }[type] || '';
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = `${val !== undefined ? val : ''}${unit}`;
        txt.setAttribute('x', 0);
        txt.setAttribute('y', 25);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('font-size', '10px');
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('fill', 'var(--text-primary)');
        txt.setAttribute('filter', 'drop-shadow(0 1px 2px var(--text-shadow))');
        ghostWrapper.appendChild(txt);
    }
    
    // Add switch button to ghost
    if (type === 'switch') {
        const swBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const btnBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        btnBg.setAttribute('x', -14);
        btnBg.setAttribute('y', 12);
        btnBg.setAttribute('width', 28);
        btnBg.setAttribute('height', 14);
        btnBg.setAttribute('rx', 4);
        btnBg.setAttribute('fill', '#fff');
        
        const btnTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        btnTxt.textContent = val === 1 ? 'ON' : 'OFF';
        btnTxt.setAttribute('x', 0);
        btnTxt.setAttribute('y', 22);
        btnTxt.setAttribute('text-anchor', 'middle');
        btnTxt.setAttribute('font-size', '10px');
        btnTxt.setAttribute('font-weight', 'bold');
        btnTxt.setAttribute('fill', '#1a1b1e');
        
        swBtn.appendChild(btnBg);
        swBtn.appendChild(btnTxt);
        ghostWrapper.appendChild(swBtn);
    }

    ghostLayer.appendChild(ghostWrapper);

    dragTarget = {
        type,
        ghostNode: ghostWrapper,
        isNew,
        compId,
        rotation: rot
    };
    
    if (!isNew && compId) {
        const existingNode = document.getElementById(`comp-group-${compId}`);
        if (existingNode) existingNode.style.display = 'none';
        ghostWrapper.style.opacity = '1.0'; // Appears as fully picked up
    } else {
        ghostWrapper.style.opacity = '0.6';
    }

    updateGhostPos(e);
}

function onDragging(e) {
    if (!dragTarget) return;
    updateGhostPos(e);
    
    // Highlight trash can if hovering
    const trashRect = trashCan.getBoundingClientRect();
    if (e.clientX >= trashRect.left && e.clientX <= trashRect.right && 
        e.clientY >= trashRect.top && e.clientY <= trashRect.bottom) {
        trashCan.classList.add('drag-over');
    } else {
        trashCan.classList.remove('drag-over');
    }
}

function endDragging(e) {
    if (!dragTarget) return;
    
    let hasChanged = false;
    const pt = getSVGPoint(e.clientX, e.clientY);
    const gx = Math.floor(pt.x / CELL_SIZE);
    const gy = Math.floor(pt.y / CELL_SIZE);
    
    // Trash check
    const trashRect = trashCan.getBoundingClientRect();
    const isOverTrash = (e.clientX >= trashRect.left && e.clientX <= trashRect.right && 
                         e.clientY >= trashRect.top && e.clientY <= trashRect.bottom);

    if (isOverTrash && !dragTarget.isNew) {
        removeComponent(dragTarget.compId);
        hasChanged = true;
    } else if (gx >= 0 && gx < GRID_SIZE_X && gy >= 0 && gy < GRID_SIZE_Y) {
        // Find if target is occupied
        const existing = components.find(c => c.x === gx && c.y === gy);
        
        if (dragTarget.isNew) {
            if (!existing) { addComponent(dragTarget.type, gx, gy); hasChanged = true; }
        } else {
            // Move existing
            const comp = components.find(c => c.id === dragTarget.compId);
            if (comp) {
                if (!existing || existing.id === comp.id) {
                    if (comp.x !== gx || comp.y !== gy) {
                        comp.x = gx; comp.y = gy;
                        hasChanged = true;
                    }
                }
            }
        }
    }
    
    // Cleanup
    if (dragTarget.ghostNode) dragTarget.ghostNode.remove();
    dragTarget = null;
    trashCan.classList.remove('drag-over');

    if (hasChanged) {
        forceStopSimulation(); // Return to Edit mode
    }
    render(); // Ensure everything is redrawn
}

function updateGhostPos(e) {
    if (!dragTarget || !dragTarget.ghostNode) return;
    const pt = getSVGPoint(e.clientX, e.clientY);
    
    const gx = Math.floor(pt.x / CELL_SIZE);
    const gy = Math.floor(pt.y / CELL_SIZE);

    // Visual snapping: Ghost always stays in a cell center if inside grid
    if (gx >= 0 && gx < GRID_SIZE_X && gy >= 0 && gy < GRID_SIZE_Y) {
        const targetX = gx * CELL_SIZE + CELL_SIZE / 2;
        const targetY = gy * CELL_SIZE + CELL_SIZE / 2;
        dragTarget.ghostNode.setAttribute('transform', `translate(${targetX}, ${targetY})`);
    } else {
        // Follow mouse directly if outside grid
        dragTarget.ghostNode.setAttribute('transform', `translate(${pt.x}, ${pt.y})`);
    }
}

function getSVGPoint(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

// Logic
function addComponent(type, x, y) {
    // Prevent overlapping same cell (mostly for simplicity)
    if (components.find(c => c.x === x && c.y === y)) return;

    const id = Date.now().toString();
    const defaultValue = {
        battery: 1.5,
        resistor: 10,
        bulb: 10,
        capacitor: 10000,
        inductor: 1000,
        wire: 0,
        wire_l: 0,
        wire_t: 0,
        switch: 0,
        voltmeter: 1e7,
        ammeter: 1e-3
    }[type];

    components.push({ id, type, x, y, rotation: 0, value: defaultValue });
    render();
}

function removeComponent(id) {
    components = components.filter(c => c.id !== id);
    forceStopSimulation();
    render();
}

function rotateComponent(id) {
    const comp = components.find(c => c.id === id);
    if (comp) {
        comp.rotation = (comp.rotation + 1) % 4;
        render();
    }
}

function openEdit(id) {
    const comp = components.find(c => c.id === id);
    if (comp) {
        editingCompId = id;
        document.getElementById('modal-title').innerText = `${getLabel(comp.type)} の設定`;
        
        if (comp.type === 'switch') {
            document.getElementById('input-group-number').style.display = 'none';
            document.getElementById('input-group-switch').style.display = 'block';
            document.getElementById('comp-switch-val').value = comp.value;
        } else if (comp.type.startsWith('wire')) {
            document.getElementById('input-group-number').style.display = 'none';
            document.getElementById('input-group-switch').style.display = 'none';
        } else {
            document.getElementById('input-group-number').style.display = 'block';
            document.getElementById('input-group-switch').style.display = 'none';
            document.getElementById('comp-value').value = comp.value;
            const unit = { battery: 'V', resistor: 'Ω', bulb: 'Ω', capacitor: 'μF', inductor: 'mH', voltmeter: 'Ω', ammeter: 'Ω' }[comp.type] || '';
            const valLabel = { battery: '起電力:', resistor: '抵抗値:', bulb: '抵抗値:', capacitor: '電気容量:', inductor: '自己インダクタンス:', voltmeter: '内部抵抗:', ammeter: '内部抵抗:' }[comp.type] || '値:';
            document.getElementById('comp-value-label').innerText = valLabel;
            document.getElementById('comp-unit').innerText = unit;
        }
        const bgType = comp.type.startsWith('wire') ? 'wire' : comp.type;
        document.querySelector('#param-modal .modal-content').style.backgroundColor = `var(--bg-${bgType}, var(--panel-bg))`;
        paramModal.style.display = 'flex';
    }
}

function saveParams() {
    const comp = components.find(c => c.id === editingCompId);
    if (comp) {
        if (comp.type === 'switch') {
            comp.value = parseInt(document.getElementById('comp-switch-val').value);
        } else {
            comp.value = Math.max(0, parseFloat(document.getElementById('comp-value').value) || 0);
        }
    }
    paramModal.style.display = 'none';
    if (isSimulating) {
        runSimulation();
    }
    render();
}

function getLabel(type) {
    return { battery: '電池', resistor: '抵抗', bulb: '電球', capacitor: 'コンデンサー', inductor: 'コイル', wire: '直線導線', wire_l: 'L字導線', wire_t: 'T字導線', switch: 'スイッチ', voltmeter: '電圧計', ammeter: '電流計' }[type];
}

// Rendering
function render() {
    circuitLayer.innerHTML = '';
    interactionLayer.innerHTML = '';

    components.forEach(comp => {
        const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.id = `comp-group-${comp.id}`;
        
        if (dragTarget && !dragTarget.isNew && dragTarget.compId === comp.id) {
            wrapper.style.display = 'none';
        }
        const cx = comp.x * CELL_SIZE + CELL_SIZE / 2;
        const cy = comp.y * CELL_SIZE + CELL_SIZE / 2;
        wrapper.setAttribute('transform', `translate(${cx}, ${cy})`);
        wrapper.style.cursor = 'pointer';

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', `rotate(${comp.rotation * 90})`);
        group.classList.add('comp-group');
        group.dataset.id = comp.id;

        // Visual
        const visual = drawComponentVisual(comp);
        group.appendChild(visual);

        // Click to rotate (4 zones)
        addRotationZones(group, comp.id);

        // Invisible hit box for body
        const hitBox = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitBox.setAttribute('x', -20);
        hitBox.setAttribute('y', -20);
        hitBox.setAttribute('width', 40);
        hitBox.setAttribute('height', 40);
        hitBox.setAttribute('fill', 'rgba(255,255,255,0.01)'); // Non-zero opacity to ensure hits in all browsers
        group.appendChild(hitBox);

        // Tooltip
        wrapper.addEventListener('mousemove', (e) => showTooltip(e, comp));
        wrapper.addEventListener('mouseleave', () => tooltip.style.display = 'none');
        
        wrapper.addEventListener('pointerdown', (e) => {
            if (e.target.classList.contains('rotate-zone')) return;
            // Note: switch button has its own pointerdown that calls stopPropagation

            const now = Date.now();
            if (comp.lastClickTime && now - comp.lastClickTime < 400) {
                // Double Click Detected
                if (dragTarget && dragTarget.ghostNode) dragTarget.ghostNode.remove();
                dragTarget = null;
                e.stopPropagation(); // Prevent dragging
                openEdit(comp.id);
                return;
            }
            comp.lastClickTime = now;
            startDragging(e, comp.type, false, comp.id);
        });

        wrapper.appendChild(group);

        // Add label overlay (Unrotated, stays upright)
        if (!comp.type.startsWith('wire') && comp.type !== 'switch') {
            let displayValueText = '';
            
            if (isSimulating && simulationResults && simulationResults.success && (comp.type === 'voltmeter' || comp.type === 'ammeter')) {
                const n1 = `v_${comp.x}_${comp.y}`;
                let nx = comp.x, ny = comp.y;
                if (comp.rotation === 0) nx++;
                else if (comp.rotation === 1) ny++;
                else if (comp.rotation === 2) nx--;
                else if (comp.rotation === 3) ny--;
                const n2 = `v_${nx}_${ny}`;
                
                if (comp.type === 'voltmeter') {
                    const volt = Math.abs((simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0));
                    displayValueText = `${volt.toFixed(2)}V`;
                } else if (comp.type === 'ammeter') {
                    const curr = Math.abs(simulationResults.currents[comp.id] || 0);
                    displayValueText = `${curr.toFixed(3)}A`;
                }
            } else {
                if (comp.type !== 'voltmeter' && comp.type !== 'ammeter') {
                    const unit = { battery: 'V', resistor: 'Ω', bulb: 'Ω', capacitor: 'μF', inductor: 'mH' }[comp.type] || '';
                    displayValueText = `${comp.value}${unit}`;
                }
            }

            if (displayValueText) {
                const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.textContent = displayValueText;
                txt.setAttribute('x', 0);
                txt.setAttribute('y', 25);
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('font-size', '10px');
                txt.setAttribute('font-weight', 'bold');
                txt.setAttribute('fill', 'var(--text-primary)');
                txt.setAttribute('filter', 'drop-shadow(0 1px 2px var(--text-shadow))');
                wrapper.appendChild(txt);
            }
        }

        // Add switch toggle button in panel
        if (comp.type === 'switch') {
            const swBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            swBtn.style.cursor = 'pointer';
            
            const btnBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            btnBg.setAttribute('x', -14);
            btnBg.setAttribute('y', 12);
            btnBg.setAttribute('width', 28);
            btnBg.setAttribute('height', 14);
            btnBg.setAttribute('rx', 4);
            btnBg.setAttribute('fill', '#fff');
            
            const btnTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            btnTxt.textContent = comp.value === 1 ? 'ON' : 'OFF';
            btnTxt.setAttribute('x', 0);
            btnTxt.setAttribute('y', 22);
            btnTxt.setAttribute('text-anchor', 'middle');
            btnTxt.setAttribute('font-size', '10px');
            btnTxt.setAttribute('font-weight', 'bold');
            btnTxt.setAttribute('fill', '#1a1b1e');
            btnTxt.setAttribute('pointer-events', 'none');
            
            swBtn.appendChild(btnBg);
            swBtn.appendChild(btnTxt);
            
            swBtn.addEventListener('pointerdown', (e) => {
                e.stopPropagation(); // prevent panel dragging or editing
                comp.value = comp.value === 1 ? 0 : 1;
                if (isSimulating) {
                    runSimulation();
                }
                render();
            });
            wrapper.appendChild(swBtn);
        }
        
        circuitLayer.appendChild(wrapper);
    });
    
    // Clear particles if simulation failed or no results
    if (!simulationResults) {
        stopAnimation();
    } else {
        startAnimation();
    }
}

let animId = null;
let animTime = 0;
let simLastTime = 0;
let timeScale = 0.1;

document.getElementById('time-scale-slider').addEventListener('input', (e) => {
    timeScale = parseFloat(e.target.value);
    document.getElementById('time-scale-val').innerText = timeScale.toFixed(3) + 'x';
});

function startAnimation() {
    if (animId) return;
    simLastTime = performance.now();
    function loop(t) {
        let dt = (t - simLastTime) / 1000 * timeScale;
        simLastTime = t;
        
        // Prevent huge dt jumps (e.g., if tab inactive)
        if (dt > 0.05 * timeScale) dt = 0.05 * timeScale;
        
        // Negative or zero dt causes steady-state evaluation which destroys transient history
        if (dt <= 0) {
            animId = requestAnimationFrame(loop);
            return;
        }
        
        if (isSimulating && activeNetlist) {
            const res = simulator.solve(activeNetlist, dt);
            if (res.success) {
                simulationResults = res;
                updateDynamicUI();
                simulator3D.update(components, simulationResults);
            }
        }
        
        // Particles move continuously by integrating speed
        components.forEach(comp => {
            if (comp.type === 'wire_t') {
                if (!comp.legProgress) comp.legProgress = { left:0, right:0, top:0, bottom:0 };
                const I_12 = simulationResults ? (simulationResults.currents[comp.id + '_1'] || 0) : 0;
                const I_23 = simulationResults ? (simulationResults.currents[comp.id + '_2'] || 0) : 0;
                
                let iLeft = 0, iRight = 0, iTop = 0, iBottom = 0;
                if (comp.rotation === 0) { iLeft = I_12; iRight = I_23 - I_12; iBottom = -I_23; }
                else if (comp.rotation === 1) { iTop = I_12; iBottom = I_23 - I_12; iLeft = -I_23; }
                else if (comp.rotation === 2) { iLeft = I_12; iRight = I_23 - I_12; iTop = -I_23; }
                else { iTop = I_12; iBottom = I_23 - I_12; iRight = -I_23; }

                const updateLeg = (speed, side) => {
                    comp.legProgress[side] += speed * dt;
                    if (comp.legProgress[side] >= 1) comp.legProgress[side] %= 1;
                    if (comp.legProgress[side] < 0) comp.legProgress[side] = 1 - (Math.abs(comp.legProgress[side]) % 1);
                };

                updateLeg(iLeft * 15, 'left');
                updateLeg(iRight * 15, 'right');
                updateLeg(iTop * 15, 'top');
                updateLeg(iBottom * 15, 'bottom');
            } else {
                let i = simulationResults ? (simulationResults.currents[comp.id] || 0) : 0;
                if (!comp.hasOwnProperty('pProgress')) comp.pProgress = 0;
                const speed = i * 15;
                comp.pProgress += (speed * dt); // Include timeScale naturally via dt
                
                if (comp.pProgress >= 1) comp.pProgress %= 1;
                if (comp.pProgress < 0) comp.pProgress = 1 - (Math.abs(comp.pProgress) % 1);
            }
        });
        
        animTime += dt / timeScale; // keep for other global animations if needed
        renderParticles();
        animId = requestAnimationFrame(loop);
    }
    animId = requestAnimationFrame(loop);
}

function stopAnimation() {
    if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
    }
    const layer = document.getElementById('interaction-layer');
    layer.innerHTML = '';
}

function updateDynamicUI() {
    // Update component labels
    components.forEach(comp => {
        const txt = document.getElementById(`label-value-${comp.id}`);
        if (txt && simulationResults && simulationResults.success) {
            if (comp.type === 'voltmeter') {
                const n1 = `v_${comp.x}_${comp.y}`;
                let nx = comp.x, ny = comp.y;
                if (comp.rotation === 0) nx++;
                else if (comp.rotation === 1) ny++;
                else if (comp.rotation === 2) nx--;
                else if (comp.rotation === 3) ny--;
                const n2 = `v_${nx}_${ny}`;
                const volt = Math.abs((simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0));
                txt.textContent = `${volt.toFixed(2)}V`;
            } else if (comp.type === 'ammeter') {
                const curr = Math.abs(simulationResults.currents[comp.id] || 0);
                txt.textContent = `${curr.toFixed(3)}A`;
            } else if (comp.type === 'capacitor' || comp.type === 'inductor') {
                // If we also want to display dynamic voltage on the capacitor/inductor itself, we could.
                // But for now just leave default label as it is (unit) unless user requested otherwise.
            }
        }
    });
    // Update Results Table
    if (document.getElementById('results-panel').style.display === 'block') {
        updateResultsTable();
    }
}

function renderParticles() {
    const layer = document.getElementById('interaction-layer');
    layer.innerHTML = '';
    
    if (!simulationResults) return;

    const showParticlesCheckbox = document.getElementById('show-particles-checkbox');
    if (showParticlesCheckbox && !showParticlesCheckbox.checked) return;

    components.forEach(comp => {
        if (comp.type === 'wire_t') {
            const I_12 = simulationResults.currents[comp.id + '_1'] || 0;
            const I_23 = simulationResults.currents[comp.id + '_2'] || 0;
            
            const I_n1 = I_12;
            const I_n2 = I_23 - I_12;
            const I_n3 = -I_23;
            
            let iLeft = 0, iRight = 0, iTop = 0, iBottom = 0;
            if (comp.rotation === 0) { iLeft = I_n1; iRight = I_n2; iBottom = I_n3; }
            else if (comp.rotation === 1) { iTop = I_n1; iBottom = I_n2; iLeft = I_n3; }
            else if (comp.rotation === 2) { iLeft = I_n1; iRight = I_n2; iTop = I_n3; }
            else { iTop = I_n1; iBottom = I_n2; iRight = I_n3; }
            
            const drawLeg = (i, side) => {
                if (Math.abs(i) < 1e-6) return;
                // Use a fixed particle count for T-wire legs to avoid teleportation
                const numParticles = 2; 
                for (let p = 0; p < numParticles; p++) {
                    const normProg = (comp.legProgress[side] + p / numParticles) % 1;
                    
                    let lx = 0, ly = 0;
                    if (side === 'left') { lx = -30 + normProg * 30; }
                    else if (side === 'right') { lx = 30 - normProg * 30; }
                    else if (side === 'top') { ly = -30 + normProg * 30; }
                    else if (side === 'bottom') { ly = 30 - normProg * 30; }

                    const cx = comp.x * CELL_SIZE + CELL_SIZE / 2;
                    const cy = comp.y * CELL_SIZE + CELL_SIZE / 2;
                    
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', cx + lx);
                    circle.setAttribute('cy', cy + ly);
                    circle.setAttribute('r', 2);
                    circle.setAttribute('fill', '#fcc419');
                    circle.setAttribute('filter', 'drop-shadow(0 0 2px #fcc419)');
                    layer.appendChild(circle);
                }
            };
            
            if (comp.rotation === 0 || comp.rotation === 2) {
                drawLeg(iLeft, 'left'); drawLeg(iRight, 'right');
                if (comp.rotation === 0) drawLeg(iBottom, 'bottom'); else drawLeg(iTop, 'top');
            } else {
                drawLeg(iTop, 'top'); drawLeg(iBottom, 'bottom');
                if (comp.rotation === 1) drawLeg(iLeft, 'left'); else drawLeg(iRight, 'right');
            }
            return;
        }

        let i = simulationResults.currents[comp.id] || 0;
        
        if (comp.type === 'capacitor') {
            const leftNode = `v_${comp.x}_${comp.y}`;
            const rightNode = `v_${comp.x + 1}_${comp.y}`;
            const topNode = `h_${comp.x}_${comp.y}`;
            const bottomNode = `h_${comp.x}_${comp.y + 1}`;
            
            let vPlateNeg3 = 0, vPlatePos3 = 0;
            if (comp.rotation === 0 || comp.rotation === 2) {
                vPlateNeg3 = simulationResults.voltages[leftNode] || 0;
                vPlatePos3 = simulationResults.voltages[rightNode] || 0;
            } else {
                vPlateNeg3 = simulationResults.voltages[topNode] || 0;
                vPlatePos3 = simulationResults.voltages[bottomNode] || 0;
            }
            const plateDiff = vPlateNeg3 - vPlatePos3;

            const cx = comp.x * CELL_SIZE + CELL_SIZE / 2;
            const cy = comp.y * CELL_SIZE + CELL_SIZE / 2;
            
            const drawCapParticle = (lx, ly) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', cx + lx);
                circle.setAttribute('cy', cy + ly);
                circle.setAttribute('r', 2);
                circle.setAttribute('fill', '#fcc419');
                circle.setAttribute('filter', 'drop-shadow(0 0 2px #fcc419)');
                layer.appendChild(circle);
            };

            // 1. Draw Stored Static Charges
            // Significantly increase the number of static particles and scatter them pseudo-randomly to look like a colony
            const numStatic = Math.min(Math.round(Math.abs(plateDiff) * 8), 40);
            if (numStatic > 0) {
                const isNeg3Positive = plateDiff > 0;
                let splx = 0, sply = 0;
                for (let s = 0; s < numStatic; s++) {
                    // pseudo-random hash ensuring the same particle 's' stays exactly in the same place every frame
                    const hash1 = Math.abs(Math.sin(s * 12.9898 + comp.x * 78.233 + comp.y) * 43758.5453);
                    const hash2 = Math.abs(Math.sin(s * 78.233 + comp.x * 12.9898 + comp.y * 3) * 43758.5453);
                    const rand1 = hash1 - Math.floor(hash1);
                    const rand2 = hash2 - Math.floor(hash2);
                    
                    const rY = -14 + rand1 * 28;
                    const rX = -1.5 + rand2 * 3;
                    
                    if (comp.rotation === 0 || comp.rotation === 2) {
                        splx = (isNeg3Positive ? -5 : 5) + rX;
                        sply = rY;
                    } else {
                        sply = (isNeg3Positive ? -5 : 5) + rX;
                        splx = rY;
                    }
                    drawCapParticle(splx, sply);
                }
            }

            // 2. Draw Moving Charges (only if current is flowing)
            if (Math.abs(i) >= 1e-6) {
                const numCapParticles = 2; // Use 2 particles per wire to match visual density
                for (let p = 0; p < numCapParticles; p++) {
                    const progress = (comp.pProgress + p / numCapParticles) % 1;
                    let lx1 = 0, ly1 = 0, lx2 = 0, ly2 = 0;
                    if (comp.rotation === 0) {
                        lx1 = -30 + progress * 24; ly1 = 0; // Left wire: -30 to -6
                        lx2 = 6 + progress * 24; ly2 = 0;   // Right wire: 6 to 30
                    } else if (comp.rotation === 1) {
                        lx1 = 0; ly1 = -30 + progress * 24; // Top wire: -30 to -6
                        lx2 = 0; ly2 = 6 + progress * 24;   // Bottom wire: 6 to 30
                    } else if (comp.rotation === 2) {
                        lx1 = 30 - progress * 24; ly1 = 0;  // Right wire: 30 to 6
                        lx2 = -6 - progress * 24; ly2 = 0;  // Left wire: -6 to -30
                    } else {
                        lx1 = 0; ly1 = 30 - progress * 24;  // Bottom wire: 30 to 6
                        lx2 = 0; ly2 = -6 - progress * 24;  // Top wire: -6 to -30
                    }
                    drawCapParticle(lx1, ly1);
                    drawCapParticle(lx2, ly2);
                }
            }
            return;
        }

        if (Math.abs(i) < 1e-6) return; // Skip moving particles for non-capacitors if no current

        // Use a fixed particle count for standard components to avoid teleportation
        const numParticles = 4;

        for (let p = 0; p < numParticles; p++) {
            const progress = (comp.pProgress + p / numParticles) % 1;
            const pos = getParticlePos(comp, progress); // Normalize 0..1
            
            if (pos) {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', 2);
                circle.setAttribute('fill', '#fcc419'); // Golden light
                circle.setAttribute('filter', 'drop-shadow(0 0 2px #fcc419)');
                layer.appendChild(circle);
            }
        }
    });
}

function getParticlePos(comp, progress) {
    const cx = comp.x * CELL_SIZE + CELL_SIZE / 2;
    const cy = comp.y * CELL_SIZE + CELL_SIZE / 2;
    
    // Components are +/- 30px from center (CELL_SIZE=60)
    let lx, ly;
    
    if (comp.type === 'wire_l') {
        // L wire path Top to Right when rot=0
        if (progress < 0.5) {
            lx = 0; ly = -30 + progress * 2 * 30;
        } else {
            lx = (progress - 0.5) * 2 * 30; ly = 0;
        }
        if (comp.rotation === 1) { const tx = lx; lx = -ly; ly = tx; }
        else if (comp.rotation === 2) { lx = -lx; ly = -ly; }
        else if (comp.rotation === 3) { const tx = lx; lx = ly; ly = -tx; }
        return { x: cx + lx, y: cy + ly };
    }

    if (comp.rotation === 0) { // H: -30 to 30
        lx = -30 + progress * 60; ly = 0;
    } else if (comp.rotation === 1) { // V
        lx = 0; ly = -30 + progress * 60;
    } else if (comp.rotation === 2) { // H Rev
        lx = 30 - progress * 60; ly = 0;
    } else { // V Rev
        lx = 0; ly = 30 - progress * 60;
    }

    // Since group was rotated in render(), we need to manually rotate back or just calculate world pos
    // But it's easier to just calculate world pos based on rotation
    return { x: cx + lx, y: cy + ly };
}

function drawComponentVisual(comp) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const color = 'var(--text-primary)';
    const bulbIntensity = (simulationResults && simulationResults.currents[comp.id]) ? Math.abs(simulationResults.currents[comp.id]) : 0;
    
    // Common background
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', -30); bg.setAttribute('y', -30);
    bg.setAttribute('width', 60); bg.setAttribute('height', 60);
    
    let bgColorVar = '--bg-wire';
    if (comp.type === 'battery') bgColorVar = '--bg-battery';
    else if (comp.type === 'resistor') bgColorVar = '--bg-resistor';
    else if (comp.type === 'switch') bgColorVar = '--bg-switch';
    else if (comp.type === 'bulb') bgColorVar = '--bg-bulb';
    else if (comp.type === 'inductor') bgColorVar = '--bg-inductor';
    else if (comp.type === 'capacitor') bgColorVar = '--bg-capacitor';
    else if (comp.type === 'voltmeter') bgColorVar = '--bg-voltmeter';
    else if (comp.type === 'ammeter') bgColorVar = '--bg-ammeter';

    bg.setAttribute('fill', `var(${bgColorVar})`);
    bg.setAttribute('rx', 0);
    g.appendChild(bg);

    // Symbols
    let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', 2);
    path.setAttribute('fill', 'none');

    switch (comp.type) {
        case 'battery':
            path.setAttribute('d', 'M -30,0 L -6,0 M 6,0 L 30,0');
            path.setAttribute('stroke-linecap', 'round');
            const plates = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            plates.setAttribute('d', 'M -6,-18 L -6,18 M 6,-10 L 6,10');
            plates.setAttribute('stroke', color);
            plates.setAttribute('stroke-width', '4');
            plates.setAttribute('fill', 'none');
            plates.setAttribute('stroke-linecap', 'round');
            g.appendChild(plates);
            break;
        case 'resistor':
            path.setAttribute('d', 'M -30,0 L -15,0 M 15,0 L 30,0');
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', -15); rect.setAttribute('y', -7);
            rect.setAttribute('width', 30); rect.setAttribute('height', 14);
            rect.setAttribute('fill', 'var(--inner-fill)'); rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '2');
            g.appendChild(path); g.appendChild(rect);
            return g;
        case 'wire':
            path.setAttribute('d', 'M -30,0 L 30,0');
            break;
        case 'wire_l':
            path.setAttribute('d', 'M 0,-30 L 0,0 L 30,0');
            break;
        case 'wire_t':
            path.setAttribute('d', 'M -30,0 L 30,0 M 0,0 L 0,30');
            const tDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            tDot.setAttribute('cx', 0); tDot.setAttribute('cy', 0); tDot.setAttribute('r', 2); tDot.setAttribute('fill', color);
            g.appendChild(tDot);
            break;
        case 'bulb':
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', 0); circle.setAttribute('cy', 0); circle.setAttribute('r', 14);
            circle.setAttribute('fill', 'var(--inner-fill)');
            circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '2');
            path.setAttribute('d', 'M -9.9,-9.9 L 9.9,9.9 M -9.9,9.9 L 9.9,-9.9 M -30,0 L -14,0 M 14,0 L 30,0');
            const bulbLight = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            bulbLight.setAttribute('cx', 0); bulbLight.setAttribute('cy', 0); bulbLight.setAttribute('r', 14);
            bulbLight.setAttribute('fill', `rgba(255, 255, 0, ${Math.min(bulbIntensity * 0.5, 0.8)})`);
            g.appendChild(circle); g.appendChild(bulbLight);
            break;
        case 'capacitor':
            path.setAttribute('d', 'M -30,0 L -6,0 M 6,0 L 30,0');
            path.setAttribute('stroke-linecap', 'round');
            const cPlates = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            cPlates.setAttribute('d', 'M -6,-15 L -6,15 M 6,-15 L 6,15');
            cPlates.setAttribute('stroke', color);
            cPlates.setAttribute('stroke-width', '4');
            cPlates.setAttribute('fill', 'none');
            cPlates.setAttribute('stroke-linecap', 'round');
            g.appendChild(cPlates);
            break;
        case 'inductor':
            path.setAttribute('d', 'M -30,0 L -15,0 M 15,0 L 30,0 M -15,0 C -15,-10 -7.5,-10 -7.5,0 C -7.5,-10 0,-10 0,0 C 0,-10 7.5,-10 7.5,0 C 7.5,-10 15,-10 15,0');
            break;
        case 'voltmeter':
            path.setAttribute('d', 'M -30,0 L -14,0 M 14,0 L 30,0');
            const vCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            vCircle.setAttribute('cx', 0); vCircle.setAttribute('cy', 0); vCircle.setAttribute('r', 14);
            vCircle.setAttribute('fill', 'var(--inner-fill)'); vCircle.setAttribute('stroke', color); vCircle.setAttribute('stroke-width', '2');
            const vText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            vText.textContent = 'V'; vText.setAttribute('x', 0); vText.setAttribute('y', 0);
            vText.setAttribute('dominant-baseline', 'central');
            vText.setAttribute('text-anchor', 'middle'); vText.setAttribute('font-size', '14px');
            vText.setAttribute('font-weight', 'bold'); vText.setAttribute('fill', color);
            if (comp.rotation) vText.setAttribute('transform', `rotate(${-comp.rotation * 90})`);
            g.appendChild(vCircle); g.appendChild(vText);
            break;
        case 'ammeter':
            path.setAttribute('d', 'M -30,0 L -14,0 M 14,0 L 30,0');
            const aCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            aCircle.setAttribute('cx', 0); aCircle.setAttribute('cy', 0); aCircle.setAttribute('r', 14);
            aCircle.setAttribute('fill', 'var(--inner-fill)'); aCircle.setAttribute('stroke', color); aCircle.setAttribute('stroke-width', '2');
            const aText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            aText.textContent = 'A'; aText.setAttribute('x', 0); aText.setAttribute('y', 0);
            aText.setAttribute('dominant-baseline', 'central');
            aText.setAttribute('text-anchor', 'middle'); aText.setAttribute('font-size', '14px');
            aText.setAttribute('font-weight', 'bold'); aText.setAttribute('fill', color);
            if (comp.rotation) aText.setAttribute('transform', `rotate(${-comp.rotation * 90})`);
            g.appendChild(aCircle); g.appendChild(aText);
            break;
        case 'switch':
            const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            s1.setAttribute('cx', -10); s1.setAttribute('cy', 0); s1.setAttribute('r', 2); s1.setAttribute('fill', color);
            g.appendChild(s1);
            const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            s2.setAttribute('cx', 10); s2.setAttribute('cy', 0); s2.setAttribute('r', 2); s2.setAttribute('fill', color);
            g.appendChild(s2);

            if (comp.value === 1) {
                path.setAttribute('d', 'M -30,0 L -10,0 M -10,0 L 10,0 M 10,0 L 30,0');
            } else {
                path.setAttribute('d', 'M -30,0 L -10,0 M -10,0 L 10,-10 M 10,0 L 30,0');
            }
            break;
    }
    g.appendChild(path);
    return g;
}

function addRotationZones(group, id) {
    const size = 20;
    const offsets = [
        { x: -30, y: -30 }, // TL
        { x: 10, y: -30 },  // TR
        { x: 10, y: 10 },   // BR
        { x: -30, y: 10 }    // BL
    ];
    offsets.forEach(off => {
        const rz = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rz.setAttribute('x', off.x);
        rz.setAttribute('y', off.y);
        rz.setAttribute('width', size);
        rz.setAttribute('height', size);
        rz.classList.add('rotate-zone');
        rz.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const c = components.find(c => c.id === id);
            if (c) c.rotation = (c.rotation + 1) % 4;
            forceStopSimulation();
            render();
        });
        group.appendChild(rz);
    });
}

let activeNetlist = null;

function buildNetlist() {
    const netlist = [];

    components.forEach(c => {
        // Define port boundaries uniquely
        const left = `v_${c.x}_${c.y}`;
        const right = `v_${c.x + 1}_${c.y}`;
        const top = `h_${c.x}_${c.y}`;
        const bottom = `h_${c.x}_${c.y + 1}`;

        if (c.type === 'wire_l') {
            let n1, n2;
            if (c.rotation === 0) { n1 = top; n2 = right; }
            else if (c.rotation === 1) { n1 = right; n2 = bottom; }
            else if (c.rotation === 2) { n1 = bottom; n2 = left; }
            else { n1 = left; n2 = top; }
            netlist.push({ id: c.id, type: 'wire', nodes: [n1, n2], value: 0 });
        } else if (c.type === 'wire_t') {
            let n1, n2, n3;
            if (c.rotation === 0) { n1 = left; n2 = right; n3 = bottom; }
            else if (c.rotation === 1) { n1 = top; n2 = bottom; n3 = left; }
            else if (c.rotation === 2) { n1 = left; n2 = right; n3 = top; }
            else { n1 = top; n2 = bottom; n3 = right; }
            netlist.push({ id: c.id + '_1', type: 'wire', nodes: [n1, n2], value: 0 });
            netlist.push({ id: c.id + '_2', type: 'wire', nodes: [n2, n3], value: 0 });
        } else if (c.type === 'switch') {
            if (c.value === 1) {
                let n1, n2;
                if (c.rotation === 0) { n1 = left; n2 = right; }
                else if (c.rotation === 1) { n1 = top; n2 = bottom; }
                else if (c.rotation === 2) { n1 = right; n2 = left; }
                else { n1 = bottom; n2 = top; }
                netlist.push({ id: c.id, type: 'wire', nodes: [n1, n2], value: 0 });
            }
        } else {
            let n1, n2;
            // Straight components
            if (c.rotation === 0) { n1 = left; n2 = right; }
            else if (c.rotation === 1) { n1 = top; n2 = bottom; }
            else if (c.rotation === 2) { n1 = right; n2 = left; }
            else { n1 = bottom; n2 = top; }
            netlist.push({ id: c.id, type: c.type, nodes: [n1, n2], value: c.value });
        }
    });

    return netlist;
}

function runSimulation(fullReset = false) {
    activeNetlist = buildNetlist();
    if (fullReset) {
        simulator.reset();
        const res = simulator.solve(activeNetlist, 1e-6); // calculate initial t=0+ state
        if (res.success) {
            simulationResults = res;
        }
    }
}

function showTooltip(e, comp) {
    if (!simulationResults) return;
    
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 15) + 'px';
    tooltip.style.top = (e.clientY + 15) + 'px';

    if (comp.type === 'wire_t') {
        const I_12 = simulationResults.currents[comp.id + '_1'] || 0;
        const I_23 = simulationResults.currents[comp.id + '_2'] || 0;
        let iLeft = 0, iRight = 0, iTop = 0, iBottom = 0;
        
        if (comp.rotation === 0) { iLeft = I_12; iRight = I_23 - I_12; iBottom = -I_23; }
        else if (comp.rotation === 1) { iTop = I_12; iBottom = I_23 - I_12; iLeft = -I_23; }
        else if (comp.rotation === 2) { iLeft = I_12; iRight = I_23 - I_12; iTop = -I_23; }
        else { iTop = I_12; iBottom = I_23 - I_12; iRight = -I_23; }
        
        const texts = [];
        if (comp.rotation === 0 || comp.rotation === 2) {
            texts.push(`左: ${Math.abs(iLeft).toFixed(3)}A`);
            texts.push(`右: ${Math.abs(iRight).toFixed(3)}A`);
            if (comp.rotation === 0) texts.push(`下: ${Math.abs(iBottom).toFixed(3)}A`);
            else texts.push(`上: ${Math.abs(iTop).toFixed(3)}A`);
        } else {
            texts.push(`上: ${Math.abs(iTop).toFixed(3)}A`);
            texts.push(`下: ${Math.abs(iBottom).toFixed(3)}A`);
            if (comp.rotation === 1) texts.push(`左: ${Math.abs(iLeft).toFixed(3)}A`);
            else texts.push(`右: ${Math.abs(iRight).toFixed(3)}A`);
        }
        tooltip.innerHTML = `電圧: 0.00 V<br>電流: ${texts.join(' / ')}`;
        return;
    }

    const left = `v_${comp.x}_${comp.y}`;
    const right = `v_${comp.x + 1}_${comp.y}`;
    const top = `h_${comp.x}_${comp.y}`;
    const bottom = `h_${comp.x}_${comp.y + 1}`;

    let n1, n2;
    if (comp.type === 'wire_l') {
        if (comp.rotation === 0) { n1 = top; n2 = right; }
        else if (comp.rotation === 1) { n1 = right; n2 = bottom; }
        else if (comp.rotation === 2) { n1 = bottom; n2 = left; }
        else { n1 = left; n2 = top; }
    } else {
        if (comp.rotation === 0) { n1 = left; n2 = right; }
        else if (comp.rotation === 1) { n1 = top; n2 = bottom; }
        else if (comp.rotation === 2) { n1 = right; n2 = left; }
        else { n1 = bottom; n2 = top; }
    }
    
    const volt = Math.abs(simulationResults.voltages[n1] - simulationResults.voltages[n2]) || 0;
    const curr = Math.abs(simulationResults.currents[comp.id] || 0);

    tooltip.innerHTML = `電圧: ${volt.toFixed(2)} V<br>電流: ${curr.toFixed(3)} A`;
}

function hideTooltip() {
    tooltip.style.display = 'none';
}

// 結果パネルのドラッグ移動
const resultsPanel = document.getElementById('results-panel');
const resultsHeader = document.getElementById('results-panel-header');
let isDraggingResults = false;
let dragStartX, dragStartY, initialPanelX, initialPanelY;

if (resultsHeader && resultsPanel) {
    resultsHeader.addEventListener('mousedown', (e) => {
        if (e.target.id === 'close-results-btn') return;
        isDraggingResults = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialPanelX = resultsPanel.offsetLeft;
        initialPanelY = resultsPanel.offsetTop;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (isDraggingResults) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            resultsPanel.style.left = `${initialPanelX + dx}px`;
            resultsPanel.style.top = `${initialPanelY + dy}px`;
            resultsPanel.style.right = 'auto'; // 右端固定を解除
        }
    });

    window.addEventListener('mouseup', () => {
        isDraggingResults = false;
    });
}

init();
