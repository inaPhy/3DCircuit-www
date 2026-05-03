const simulator = new Simulator();

// Config
let GRID_SIZE_X = 11;
let GRID_SIZE_Y = 7;
let CELL_SIZE = 60;
let SVG_WIDTH = GRID_SIZE_X * CELL_SIZE;
let SVG_HEIGHT = GRID_SIZE_Y * CELL_SIZE;

// State
let components = []; // { id, type, x, y, rotation, value }
let simulationResults = null;
let editingCompId = null;
let selectedGraphCompIds = []; // Up to 4 components
let globalGraphHistory = []; // [{ voltages: {id: v, ...}, currents: {id: i, ...} }, ...]
const maxGraphHistory = 400;
let graphAccumulatedTime = 0;
const graphSampleInterval = 0.005;
let graphRangeV = 10.0;
let graphRangeI = 1.00;
let showAbsoluteValues = true; // Default to ON as requested
let showIllustrations = false; // ver2.02: イラスト表示モードのフラグ

// Component Colors for Graphs (Sync with CSS variables --bg-xxx)
const compColors = {
    battery: '#FF8C8C',    // Coral Pink
    ac_source: '#FF8C8C',  // Coral Pink
    resistor: '#fab005',   // Golden Yellow (Changed from light yellow for visibility)
    bulb: '#CCCCCC',       // Gray
    inductor: '#71FFFF',   // Cyan
    capacitor: '#98fb98',  // Pale Green
    voltmeter: '#ffd700',  // Gold
    ammeter: '#0099ff'     // Bright Blue
};

function getCompNodeNames(comp) {
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
    return { n1, n2 };
}

// Dragging state
let dragTarget = null; // { type, ghostNode, isNew }
let draggedCompId = null; 
let isSimulating = false; // Simulation running state

let appConfig = {
    showParticles: false,
    showResults: true,
    show3D: true,
    darkMode: false,
    showAbsoluteValues: true,
    showIllustrations: false,
    bulbGlowK: 30, // 電球の発光係数 k
    bulbGlowMinR: 5, // 最小発光半径
    bulbGlowMaxR: 60, // 最大発光半径
    toolbarVisibility: {} // Will be populated from settings.ini
};

// 抵抗器のカラーコード算出ヘルパー (4本帯)
function getResistorColorBands(value) {
    const colors = [
        '#000000', // 0: 黒
        '#8b4513', // 1: 茶
        '#ff0000', // 2: 赤
        '#ffa500', // 3: 橙
        '#ffff00', // 4: 黄
        '#008000', // 5: 緑
        '#0000ff', // 6: 青
        '#ee82ee', // 7: 紫
        '#808080', // 8: 灰
        '#ffffff'  // 9: 白
    ];
    
    // 0 または負の数は黒として扱う
    if (value <= 0) return [colors[0], colors[0], colors[0], '#ffd700'];

    // 指数表記を利用して分解 (例: 4700 -> 4.7e+3)
    const s = value.toExponential().split('e');
    let mantissa = parseFloat(s[0]);
    let exp = parseInt(s[1]);

    // 有効数字を2桁の整数にする (例: 4.7 -> 47, exp 3 -> 2)
    // 1.0e+0 -> 10, exp -1
    let d1 = Math.floor(mantissa);
    let d2 = Math.round((mantissa - d1) * 10);
    let multiplier = exp - 1;

    // 繰り上がり処理
    if (d2 >= 10) {
        d1++;
        d2 = 0;
        if (d1 >= 10) {
            d1 = 1;
            multiplier++;
        }
    }

    // 倍数の色 (金:-1, 銀:-2)
    let mColor;
    if (multiplier === -1) mColor = '#ffd700'; // 金
    else if (multiplier === -2) mColor = '#c0c0c0'; // 銀
    else if (multiplier >= 0 && multiplier <= 9) mColor = colors[multiplier];
    else mColor = colors[0]; // 範囲外は黒

    return [
        colors[Math.max(0, Math.min(9, d1))], 
        colors[Math.max(0, Math.min(9, d2))], 
        mColor, 
        '#ffd700' // 許容差: 金(±5%)固定
    ];
}

async function loadSettings() {
    try {
        const response = await fetch('settings.ini');
        if (!response.ok) return;
        const text = await response.text();
        const lines = text.split('\n');
        lines.forEach(line => {
            const trimLine = line.trim();
            if (!trimLine || trimLine.startsWith(';') || trimLine.startsWith('[')) return;
            const parts = trimLine.split('=');
            if (parts.length < 2) return;
            const key = parts[0].trim();
            const value = parts[1].trim().toLowerCase();
            if (key === 'showParticles') appConfig.showParticles = (value === 'true');
            if (key === 'showResults') appConfig.showResults = (value === 'true');
            if (key === 'show3D') appConfig.show3D = (value === 'true');
            if (key === 'darkMode') appConfig.darkMode = (value === 'true');
            if (key === 'showAbsoluteValues') appConfig.showAbsoluteValues = (value === 'true');
            if (key === 'showIllustrations') appConfig.showIllustrations = (value === 'true');
            if (key === 'bulb_glow_k') appConfig.bulbGlowK = parseFloat(value) || 30;
            if (key === 'bulb_glow_min_r') appConfig.bulbGlowMinR = parseFloat(value) || 5;
            if (key === 'bulb_glow_max_r') appConfig.bulbGlowMaxR = parseFloat(value) || 60;
            
            // Toolbar Visibility settings: show_battery, show_ac_source, etc.
            if (key.startsWith('show_')) {
                const type = key.replace('show_', '');
                appConfig.toolbarVisibility[type] = (value === 'true');
            }
        });
        applySettings();
    } catch (e) {
        console.warn("Could not load settings.ini, using defaults.", e);
    }
}

function applySettings() {
    const partCheck = document.getElementById('show-particles-checkbox');
    if (partCheck) partCheck.checked = appConfig.showParticles;
    
    const resCheck = document.getElementById('results-toggle-checkbox');
    if (resCheck) resCheck.checked = appConfig.showResults;

    const show3dCheck = document.getElementById('show-3d-checkbox');
    if (show3dCheck) show3dCheck.checked = appConfig.show3D;

    const darkCheck = document.getElementById('dark-mode-checkbox');
    if (darkCheck) {
        darkCheck.checked = appConfig.darkMode;
        if (appConfig.darkMode) {
            document.documentElement.classList.remove('light-mode');
        } else {
            document.documentElement.classList.add('light-mode');
        }
    }

    const absCheck = document.getElementById('abs-mode-checkbox');
    if (absCheck) {
        absCheck.checked = appConfig.showAbsoluteValues;
        showAbsoluteValues = appConfig.showAbsoluteValues;
        document.body.classList.toggle('abs-mode-active', showAbsoluteValues);
    }

    const illCheck = document.getElementById('illustration-checkbox');
    if (illCheck) {
        illCheck.checked = appConfig.showIllustrations;
        showIllustrations = appConfig.showIllustrations;
        updateToolbarIcons();
    }

    // Apply Toolbar Visibility from settings.ini
    const toolItems = document.querySelectorAll('.tool-item');
    toolItems.forEach(item => {
        const type = item.dataset.type;
        if (appConfig.toolbarVisibility[type] !== undefined) {
            item.style.display = appConfig.toolbarVisibility[type] ? 'flex' : 'none';
        }
    });
}

// DOM
const svg = document.getElementById('grid-svg');
const circuitLayer = document.getElementById('circuit-layer');
const ghostLayer = document.getElementById('ghost-layer');
const interactionLayer = document.getElementById('interaction-layer');
const messageArea = document.getElementById('error-text');
const solveBtn = document.getElementById('solve-btn');
const trashCan = document.getElementById('trash-can');
const paramModal = document.getElementById('param-modal');
const clearConfirmModal = document.getElementById('clear-confirm-modal');
const clearConfirmBackdrop = document.getElementById('clear-confirm-backdrop');
const tooltip = document.getElementById('tooltip');

// Init
function init() {
    updateCanvasSize(); // 初回サイズ計算
    setupEventListeners(); // イベントリスナーの登録
    document.documentElement.classList.add('light-mode');
    loadSettings();
    render();
}

function updateCanvasSize() {
    const workspace = document.getElementById('workspace');
    if (!workspace) return;
    
    const w = workspace.clientWidth;
    const h = workspace.clientHeight;
    
    // 1. グリッド数の決定 (スマホ縦画面なら 5x7、それ以外は 11x7)
    const nextGridX = (w < h && w < 600) ? 5 : 11;
    const nextGridY = 7; // 縦は7で固定
    
    let needsRender = false;

    // 2. グリッド縮小時のはみ出しパーツ削除処理
    if (nextGridX < GRID_SIZE_X || nextGridY < GRID_SIZE_Y) {
        const outOfBounds = components.filter(c => c.x >= nextGridX || c.y >= nextGridY);
        if (outOfBounds.length > 0) {
            // はみ出しがある場合はシミュレーションを停止して削除
            forceStopSimulation();
            components = components.filter(c => c.x < nextGridX && c.y < nextGridY);
            needsRender = true;
        }
    }

    GRID_SIZE_X = nextGridX;
    GRID_SIZE_Y = nextGridY;

    // 3. マスの大きさを決定
    // 画面内に全マスが収まるように計算
    const margin = 20; 
    CELL_SIZE = Math.floor((w - margin) / GRID_SIZE_X);
    
    // 縦方向にも収まるかチェック
    if (CELL_SIZE * GRID_SIZE_Y > h - margin) {
        CELL_SIZE = Math.floor((h - margin) / GRID_SIZE_Y);
    }
    
    // 極端なサイズにならないよう制限 (スマホでの操作性を考慮し最小値を維持)
    CELL_SIZE = Math.max(45, Math.min(120, CELL_SIZE));
    
    SVG_WIDTH = GRID_SIZE_X * CELL_SIZE;
    SVG_HEIGHT = GRID_SIZE_Y * CELL_SIZE;
    
    if (svg) {
        svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
        svg.style.width = `${SVG_WIDTH}px`; // 100%ではなく実サイズを指定して中央寄せ
        svg.style.height = `${SVG_HEIGHT}px`;
    }
    
    if (typeof simulator3D !== 'undefined' && simulator3D) {
        simulator3D.GRID_SCALE = CELL_SIZE;
        simulator3D.GRID_SIZE_X = GRID_SIZE_X; // 追加
        simulator3D.GRID_SIZE_Y = GRID_SIZE_Y; // 追加
        if (simulator3D.isActive) {
            simulator3D.update(components, simulationResults);
        }
    }
    
    renderGridBackground();
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
            e.preventDefault(); // タッチ時の既定動作（スクロール等）を抑制
            const type = item.dataset.type;
            startDragging(e, type, true);
        });
    });

    // Global listeners for dragging
    window.addEventListener('pointermove', onDragging);
    window.addEventListener('pointerup', endDragging);
    window.addEventListener('pointercancel', endDragging); // 中断時も終了処理を行う

    // Dark Mode Toggle
    const darkModeCheckbox = document.getElementById('dark-mode-checkbox');
    if (darkModeCheckbox) {
        darkModeCheckbox.addEventListener('change', (e) => {
            appConfig.darkMode = e.target.checked;
            if (e.target.checked) {
                document.documentElement.classList.remove('light-mode');
            } else {
                document.documentElement.classList.add('light-mode');
            }
            // 3Dモデルのテクスチャを更新
            if (simulator3D.isActive && simulationResults) {
                simulator3D.update(components, simulationResults);
            }
            // グラフを再描画してテーマを即座に反映
            if (selectedGraphCompIds.length > 0) updateDynamicUI(0);
        });
    }

    // Absolute Value Toggle
    const absModeCheckbox = document.getElementById('abs-mode-checkbox');
    if (absModeCheckbox) {
        absModeCheckbox.addEventListener('change', (e) => {
            showAbsoluteValues = e.target.checked;
            document.body.classList.toggle('abs-mode-active', showAbsoluteValues);
            updateResultsTable();
            updateGraphLegend();
            updateToolbarIcons();
            render();
        });
    }

    // 3D Mode Toggle
    const show3dCheckbox = document.getElementById('show-3d-checkbox');
    if (show3dCheckbox) {
        show3dCheckbox.addEventListener('change', (e) => {
            if (!isSimulating) return;
            if (e.target.checked) {
                simulator3D.show();
                simulator3D.update(components, simulationResults);
            } else {
                simulator3D.hide();
            }
        });
    }

    const compValueInput = document.getElementById('comp-value');
    const compValueSlider = document.getElementById('comp-value-slider');
    if (compValueInput && compValueSlider) {
        const bulbPresetsSelect = document.getElementById('bulb-presets-select');
        const updatePresetSelect = (val) => {
            if (!bulbPresetsSelect) return;
            const options = Array.from(bulbPresetsSelect.options).map(o => o.value);
            if (options.includes(val.toString())) {
                bulbPresetsSelect.value = val.toString();
            }
            // "custom" は削除されたため、一致しない場合は何もしない
        };

        compValueSlider.addEventListener('input', (e) => {
            compValueInput.value = e.target.value;
            updatePresetSelect(e.target.value);
        });
        compValueInput.addEventListener('input', (e) => {
            compValueSlider.value = e.target.value;
            updatePresetSelect(e.target.value);
        });
        if (bulbPresetsSelect) {
            bulbPresetsSelect.addEventListener('change', (e) => {
                compValueInput.value = e.target.value;
                compValueSlider.value = e.target.value;
            });
        }
    }

    // AC Extra fields sync
    const acFreqInput = document.getElementById('comp-freq');
    const acFreqSlider = document.getElementById('comp-freq-slider');
    if (acFreqInput && acFreqSlider) {
        acFreqSlider.addEventListener('input', (e) => { acFreqInput.value = e.target.value; });
        acFreqInput.addEventListener('input', (e) => { acFreqSlider.value = e.target.value; });
    }
    const acPhaseInput = document.getElementById('comp-phase');
    const acPhaseSlider = document.getElementById('comp-phase-slider');
    if (acPhaseInput && acPhaseSlider) {
        acPhaseSlider.addEventListener('input', (e) => { acPhaseInput.value = e.target.value; });
        acPhaseInput.addEventListener('input', (e) => { acPhaseSlider.value = e.target.value; });
    }

    // rInt sync
    const rIntInput = document.getElementById('comp-rint');
    const rIntSlider = document.getElementById('comp-rint-slider');
    if (rIntInput && rIntSlider) {
        rIntSlider.addEventListener('input', (e) => { rIntInput.value = e.target.value; });
        rIntInput.addEventListener('input', (e) => { rIntSlider.value = e.target.value; });
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

    const acToggleBtn = document.getElementById('modal-ac-toggle');
    const extraGroup = document.getElementById('input-group-extra');
    const mainNumGroup = document.getElementById('input-group-number');
    if (acToggleBtn) {
        acToggleBtn.onclick = () => {
            const comp = components.find(c => c.id === editingCompId);
            if (!comp) return;

            let targetGroup;
            const saveBtn = document.getElementById('modal-save');
            if (comp.type === 'ac_source' || comp.type === 'battery') targetGroup = extraGroup;
            else if (comp.type === 'voltmeter' || comp.type === 'ammeter') {
                targetGroup = mainNumGroup;
            }
            
            if (targetGroup) {
                const isHidden = targetGroup.style.display === 'none';
                targetGroup.style.display = isHidden ? 'block' : 'none';
                acToggleBtn.style.transform = isHidden ? 'rotateX(180deg)' : 'rotateX(0deg)';
                if (comp.type === 'voltmeter' || comp.type === 'ammeter') {
                    if (saveBtn) saveBtn.style.display = isHidden ? 'block' : 'none';
                }
            }
        };
    }

    const bulbToggleBtn = document.getElementById('modal-bulb-details-toggle');
    const bulbDetailsContent = document.getElementById('bulb-details-content');
    if (bulbToggleBtn && bulbDetailsContent) {
        bulbToggleBtn.onclick = () => {
            const isHidden = (bulbDetailsContent.style.display === 'none');
            bulbDetailsContent.style.display = isHidden ? 'block' : 'none';
            bulbToggleBtn.style.transform = isHidden ? 'rotateX(180deg)' : 'rotateX(0deg)';
        };
    }

    // Graph Panel listeners
    document.getElementById('close-voltage-graph-btn').onclick = () => {
        document.getElementById('voltage-graph-panel').style.display = 'none';
        if (document.getElementById('current-graph-panel').style.display === 'none') selectedGraphCompIds = [];
        updateResultsTable();
    };
    document.getElementById('close-current-graph-btn').onclick = () => {
        document.getElementById('current-graph-panel').style.display = 'none';
        if (document.getElementById('voltage-graph-panel').style.display === 'none') selectedGraphCompIds = [];
        updateResultsTable();
    };

    const setupDraggable = (headerId, panelId) => {
        const header = document.getElementById(headerId);
        const panel = document.getElementById(panelId);
        if (!header || !panel) return;
        let isDragging = false;
        let startX, startY, initX, initY;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'SPAN') return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            initX = panel.offsetLeft; initY = panel.offsetTop;
            header.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (isDragging) {
                panel.style.left = `${initX + (e.clientX - startX)}px`;
                panel.style.top = `${initY + (e.clientY - startY)}px`;
                panel.style.right = 'auto';
            }
        });
        header.addEventListener('pointerup', (e) => {
            isDragging = false;
            header.releasePointerCapture(e.pointerId);
        });
        header.addEventListener('pointercancel', (e) => {
            isDragging = false;
            header.releasePointerCapture(e.pointerId);
        });
    };
    setupDraggable('voltage-graph-header', 'voltage-graph-panel');
    setupDraggable('current-graph-header', 'current-graph-panel');

    // Range Sliders
    document.getElementById('graph-v-range-slider').oninput = (e) => {
        graphRangeV = parseFloat(e.target.value);
        document.getElementById('graph-v-range-val').innerText = graphRangeV.toFixed(1) + 'V';
        if (selectedGraphCompIds.length > 0) updateDynamicUI(0); // Trigger redraw
    };
    document.getElementById('graph-i-range-slider').oninput = (e) => {
        graphRangeI = parseFloat(e.target.value);
        document.getElementById('graph-i-range-val').innerText = graphRangeI.toFixed(2) + 'A';
        if (selectedGraphCompIds.length > 0) updateDynamicUI(0); // Trigger redraw
    };

    // Toolbar Settings
    const settingsBtn = document.getElementById('toolbar-settings-btn');
    const settingsPanel = document.getElementById('toolbar-settings-panel');
    const settingsBackdrop = document.getElementById('toolbar-settings-backdrop');
    const closeSettingsBtn = document.getElementById('close-toolbar-settings-btn');
    const visibilityList = document.getElementById('toolbar-visibility-list');

    if (settingsBtn && settingsPanel && settingsBackdrop) {
        settingsBtn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = settingsPanel.style.display === 'none';
            if (isHidden) {
                visibilityList.innerHTML = '';
                const items = document.querySelectorAll('.tool-item[data-type]');
                items.forEach(item => {
                    const type = item.dataset.type;
                    const span = item.querySelector('span');
                    const label = span ? span.innerText : (item.title || type);
                    const isVisible = item.style.display !== 'none';

                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.justifyContent = 'flex-start'; // 左詰め
                    row.style.gap = '12px'; // スイッチと文字の間隔
                    row.style.padding = '2px 0';

                    // トグルスイッチの構築
                    const switchLabel = document.createElement('label');
                    switchLabel.className = 'switch';
                    switchLabel.style.flexShrink = '0'; // スイッチが潰れないように
                    
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = isVisible;
                    cb.onchange = () => {
                        item.style.display = cb.checked ? 'flex' : 'none';
                    };

                    const slider = document.createElement('span');
                    slider.className = 'slider-toggle';

                    switchLabel.appendChild(cb);
                    switchLabel.appendChild(slider);

                    const lbl = document.createElement('span');
                    lbl.innerText = label;
                    lbl.style.fontSize = '13px';
                    lbl.style.cursor = 'pointer';

                    // ラベルクリックでもスイッチが切り替わるようにする
                    lbl.onclick = () => { cb.checked = !cb.checked; cb.onchange(); };

                    row.appendChild(switchLabel);
                    row.appendChild(lbl);
                    visibilityList.appendChild(row);
                });
            }
            settingsPanel.style.display = isHidden ? 'block' : 'none';
            settingsBackdrop.style.display = isHidden ? 'block' : 'none';
        };

        const closePanel = () => {
            settingsPanel.style.display = 'none';
            settingsBackdrop.style.display = 'none';
        };

        if (closeSettingsBtn) closeSettingsBtn.onclick = closePanel;
        if (settingsBackdrop) settingsBackdrop.onclick = closePanel;

        // 背景クリックで閉じる処理（既存の window リスナーを整理）
        window.addEventListener('pointerdown', (e) => {
            if (settingsPanel.style.display !== 'none' && 
                !settingsPanel.contains(e.target) && 
                !settingsBtn.contains(e.target)) {
                closePanel();
            }
        });

        settingsPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // --- File Operations ---
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const toolbarVisibility = {};
            document.querySelectorAll('.tool-item').forEach(item => {
                toolbarVisibility[item.dataset.type] = item.style.display !== 'none';
            });

            const data = {
                version: "1.1",
                components: components,
                settings: {
                    darkMode: document.getElementById('dark-mode-checkbox').checked,
                    absMode: document.getElementById('abs-mode-checkbox').checked,
                    show3d: document.getElementById('show-3d-checkbox').checked,
                    showParticles: document.getElementById('show-particles-checkbox').checked,
                    showResults: document.getElementById('results-toggle-checkbox').checked,
                    timeScale: parseFloat(document.getElementById('time-scale-slider').value),
                    toolbarVisibility: toolbarVisibility
                }
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
            a.href = url;
            a.download = `circuit_${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    const loadBtnTrigger = document.getElementById('load-btn-trigger');
    const loadFileInput = document.getElementById('load-file-input');
    if (loadBtnTrigger && loadFileInput) {
        loadBtnTrigger.addEventListener('click', () => loadFileInput.click());
        loadFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (!data.components) throw new Error("Invalid format");
                    
                    // Restore state
                    components = data.components;
                    if (data.settings) {
                        const applyToggle = (id, value) => {
                            const el = document.getElementById(id);
                            if (el && el.checked !== (!!value)) {
                                el.checked = !!value;
                                el.dispatchEvent(new Event('change'));
                            }
                        };
                        
                        applyToggle('dark-mode-checkbox', data.settings.darkMode);
                        applyToggle('abs-mode-checkbox', data.settings.absMode);
                        applyToggle('show-3d-checkbox', data.settings.show3d);
                        applyToggle('show-particles-checkbox', data.settings.showParticles);
                        applyToggle('results-toggle-checkbox', data.settings.showResults);
                        
                        if (data.settings.timeScale !== undefined) {
                            const slider = document.getElementById('time-scale-slider');
                            if (slider) {
                                slider.value = data.settings.timeScale;
                                slider.dispatchEvent(new Event('input'));
                            }
                        }

                        if (data.settings.toolbarVisibility) {
                            document.querySelectorAll('.tool-item').forEach(item => {
                                const type = item.dataset.type;
                                if (data.settings.toolbarVisibility[type] !== undefined) {
                                    item.style.display = data.settings.toolbarVisibility[type] ? 'flex' : 'none';
                                }
                            });
                        }
                    }
                    
                    render();
                    if (isSimulating) toggleSimulation(); // Stop if running
                    alert("回路と設定を読み込みました");
                } catch (err) {
                    alert("ファイルの読み込みに失敗しました: " + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = ''; // Reset
        });
    }
    // Window Resize
    window.addEventListener('resize', updateCanvasSize);

    // Canvas Interaction (Selection and Dragging existing)
    interactionLayer.addEventListener('pointerdown', (e) => {
        if (isSimulating) return; // Disable editing during simulation
        const pt = getSVGPoint(e.clientX, e.clientY);
        const gx = Math.floor(pt.x / CELL_SIZE);
        const gy = Math.floor(pt.y / CELL_SIZE);
        
        const comp = components.find(c => c.x === gx && c.y === gy);
        if (comp) {
            if (e.button === 0) { // Left click: start dragging
                startDragging(e, comp.type, false, comp.id);
            }
        }
    });

    interactionLayer.addEventListener('click', (e) => {
        if (isSimulating) return;
        const pt = getSVGPoint(e.clientX, e.clientY);
        const gx = Math.floor(pt.x / CELL_SIZE);
        const gy = Math.floor(pt.y / CELL_SIZE);
        
        const comp = components.find(c => c.x === gx && c.y === gy);
        if (comp) {
            openParamModal(comp.id);
        }
    });
}

function updateResultsTable() {
    const tbody = document.querySelector('#results-table tbody');
    if (!simulationResults || !simulationResults.success) {
        tbody.innerHTML = '';
        return;
    }

    const validComponents = components.filter(c => !c.type.startsWith('wire') && c.type !== 'switch');
    
    // 現在の行数を調整
    while (tbody.rows.length < validComponents.length) {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = '<td></td><td></td><td></td>';
        tbody.appendChild(tr);
    }
    while (tbody.rows.length > validComponents.length) {
        tbody.deleteRow(-1);
    }

    validComponents.forEach((c, idx) => {
        const tr = tbody.rows[idx];
        const { n1, n2 } = getCompNodeNames(c);
        let volt = (simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0);
        let curr = simulationResults.currents[c.id] || 0;
        
        // 電池・交流電源の場合は電流の符号を反転（供給方向を正とする）
        if (c.type === 'battery' || c.type === 'ac_source') {
            curr = -curr;
        } 
        // 抵抗・電球・コンデンサ・コイルで絶対値モードがONの場合
        else if (showAbsoluteValues && (c.type === 'resistor' || c.type === 'bulb' || c.type === 'capacitor' || c.type === 'inductor')) {
            volt = Math.abs(volt);
            curr = Math.abs(curr);
        }

        let labelName = getLabel(c.type);
        if (c.type === 'bulb') {
            const ratings = {
                '5': "1.5V-0.3A",
                '8.33': "2.5V-0.3A",
                '12.67': "3.8V-0.3A",
                '42': "6.3V-0.15A",
                '109': "12V-0.11A"
            };
            const ratingStr = ratings[c.value.toString()];
            if (ratingStr) labelName = ratingStr;
        }
        const label = `${labelName} (${c.x},${c.y})`;
        if (tr.cells[0].innerText !== label) tr.cells[0].innerText = label;
        tr.cells[1].innerText = volt.toFixed(2);
        tr.cells[2].innerText = curr.toFixed(3);

        // Highlight selected row with specific trace color and style
        const traceIndex = selectedGraphCompIds.indexOf(c.id);
        const markerCell = tr.cells[0];
        if (traceIndex !== -1) {
            tr.classList.add('selected-row');
            const color = compColors[c.type] || '#888';
            
            // Count same types before this one for different line styles
            let sameTypeCount = 0;
            for (let i = 0; i < traceIndex; i++) {
                const prevComp = components.find(comp => comp.id === selectedGraphCompIds[i]);
                if (prevComp && prevComp.type === c.type) sameTypeCount++;
            }
            
            // Reset marker classes and styles
            markerCell.classList.remove('res-marker-solid', 'res-marker-dashed', 'res-marker-dotted', 'res-marker-dashdot');
            markerCell.style.borderLeft = '';
            markerCell.style.backgroundImage = '';
            markerCell.style.setProperty('--marker-color', color);
            
            if (sameTypeCount === 0) markerCell.classList.add('res-marker-solid');
            else if (sameTypeCount === 1) markerCell.classList.add('res-marker-dashed');
            else if (sameTypeCount === 2) markerCell.classList.add('res-marker-dotted');
            else markerCell.classList.add('res-marker-dashdot');
        } else {
            tr.classList.remove('selected-row');
            markerCell.classList.remove('res-marker-solid', 'res-marker-dashed', 'res-marker-dotted', 'res-marker-dashdot');
            markerCell.style.borderLeft = '';
            markerCell.style.backgroundImage = '';
        }

        tr.onclick = () => {
            const idx = selectedGraphCompIds.indexOf(c.id);
            if (idx !== -1) {
                selectedGraphCompIds.splice(idx, 1);
            } else if (selectedGraphCompIds.length < 4) {
                selectedGraphCompIds.push(c.id);
            }
            
            const hasSelection = selectedGraphCompIds.length > 0;
            document.getElementById('voltage-graph-panel').style.display = hasSelection ? 'block' : 'none';
            document.getElementById('current-graph-panel').style.display = hasSelection ? 'block' : 'none';
            
            updateResultsTable();
            updateDynamicUI(0); // Refresh graph display
        };

        tr.onmouseenter = () => {
            document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
            const group = document.getElementById(`comp-group-${c.id}`);
            if (group && isSimulating) {
                group.parentNode.appendChild(group);
                const hl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                hl.setAttribute('x', -35); hl.setAttribute('y', -35);
                hl.setAttribute('width', 70); hl.setAttribute('height', 70);
                hl.setAttribute('fill', 'none'); hl.setAttribute('stroke', '#a5d8ff');
                hl.setAttribute('stroke-width', '4'); hl.setAttribute('rx', '8');
                hl.classList.add('comp-highlight');
                group.appendChild(hl);  
            }
            if (simulator3D) simulator3D.highlightComponent(c.id);
        };
        tr.onmouseleave = () => {
            document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
            if (simulator3D) simulator3D.unhighlightComponent();
        };
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

    const show3dToggle = document.getElementById('show-3d-toggle');
    if (show3dToggle) show3dToggle.style.display = isSimulating ? 'flex' : 'none';

    // Default or Stop grid uses light pink if stopping while running
    renderGridBackground();

    if (isSimulating) {
        simulator.reset();
        activeNetlist = buildNetlist();
        const res = simulator.solve(activeNetlist, 1e-6);
        if (res.success) {
            simulationResults = res;
            if (messageArea) messageArea.innerText = '開始'; // 短くする
            
            // Show results panel based on setting
            const resCheckbox = document.getElementById('results-toggle-checkbox');
            document.getElementById('results-panel').style.display = (resCheckbox && resCheckbox.checked) ? 'block' : 'none';
            updateResultsTable();
            
            const show3dCheckbox = document.getElementById('show-3d-checkbox');
            if (!show3dCheckbox || show3dCheckbox.checked) {
                simulator3D.show();
                simulator3D.update(components, simulationResults);
            }
            
            render();
            startAnimation();
        } else {
            simulationResults = null;
            if (messageArea) {
                messageArea.innerText = res.message;
                messageArea.style.color = "var(--error-text)";
            }
            render();
            forceStopSimulation();
        }
    } else {
        simulator3D.hide();
        simulationResults = null;
        if (messageArea) messageArea.innerText = '';
        document.getElementById('results-panel').style.display = 'none';
        
        // グラフも閉じる
        document.getElementById('voltage-graph-panel').style.display = 'none';
        document.getElementById('current-graph-panel').style.display = 'none';
        selectedGraphCompIds = [];
        globalGraphHistory = [];
        
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
        txt.setAttribute('y', CELL_SIZE * 0.42);
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('font-size', `${Math.max(10, CELL_SIZE * 0.16)}px`);
        txt.setAttribute('font-weight', 'bold');
        txt.setAttribute('fill', 'var(--text-primary)');
        txt.setAttribute('filter', 'drop-shadow(0 1px 2px var(--text-shadow))');
        ghostWrapper.appendChild(txt);
    }
    
    // Add switch button to ghost
    if (type === 'switch') {
        const swBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const btnBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        btnBg.setAttribute('x', -CELL_SIZE * 0.23);
        btnBg.setAttribute('y', CELL_SIZE * 0.2);
        btnBg.setAttribute('width', CELL_SIZE * 0.46);
        btnBg.setAttribute('height', CELL_SIZE * 0.23);
        btnBg.setAttribute('rx', 4);
        btnBg.setAttribute('fill', '#fff');
        
        const btnTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        btnTxt.textContent = val === 1 ? 'ON' : 'OFF';
        btnTxt.setAttribute('x', 0);
        btnTxt.setAttribute('y', CELL_SIZE * 0.36);
        btnTxt.setAttribute('text-anchor', 'middle');
        btnTxt.setAttribute('font-size', `${Math.max(9, CELL_SIZE * 0.15)}px`);
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
    const rect = svg.getBoundingClientRect();
    // SVG内の座標系(0〜SVG_WIDTH)に変換
    const x = (clientX - rect.left) * (SVG_WIDTH / rect.width);
    const y = (clientY - rect.top) * (SVG_HEIGHT / rect.height);
    return { x, y };
}

// Logic
function addComponent(type, x, y) {
    // Prevent overlapping same cell (mostly for simplicity)
    if (components.find(c => c.x === x && c.y === y)) return;

    const id = Date.now().toString();
    const defaultValue = {
        battery: 1.5,
        ac_source: 1.5,
        resistor: 10,
        bulb: 5,
        capacitor: 10000,
        inductor: 1000,
        wire: 0,
        wire_l: 0,
        wire_t: 0,
        switch: 0,
        voltmeter: 1e7,
        ammeter: 1e-3
    }[type];

    const initialComp = { id, type, x, y, rotation: 0, value: defaultValue };
    if (type === 'battery' || type === 'ac_source') {
        initialComp.rInt = 0.001;
    }
    if (type === 'ac_source') {
        initialComp.freq = 1.0;
        initialComp.phase = 90.0;
    }
    components.push(initialComp);
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
        
        // Reset extra groups
        const extraPanel = document.getElementById('input-group-extra');
        if (extraPanel) extraPanel.style.display = 'none';
        
        const isMeter = (comp.type === 'voltmeter' || comp.type === 'ammeter');
        const saveBtn = document.getElementById('modal-save');
        const acToggleBtn = document.getElementById('modal-ac-toggle');
        
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
            const unit = { battery: 'V', ac_source: 'V', resistor: 'Ω', bulb: 'Ω', capacitor: 'μF', inductor: 'mH', voltmeter: 'Ω', ammeter: 'Ω' }[comp.type] || '';
            const valLabel = { battery: '起電力', ac_source: '振幅(V)', resistor: '抵抗値', bulb: '抵抗値', capacitor: '電気容量', inductor: '自己インダクタンス', voltmeter: '内部抵抗', ammeter: '内部抵抗' }[comp.type] || '値';
            document.getElementById('comp-value-label').innerText = valLabel;
            document.getElementById('comp-unit').innerText = unit;

            // 電球用のプリセットプルダウン制御
            const bulbPresetsContainer = document.getElementById('bulb-presets-container');
            const bulbPresetsSelect = document.getElementById('bulb-presets-select');
            const bulbDetailsContent = document.getElementById('bulb-details-content');
            const bulbToggleBtn = document.getElementById('modal-bulb-details-toggle');
            
            if (bulbPresetsContainer && bulbPresetsSelect) {
                if (comp.type === 'bulb') {
                    bulbPresetsContainer.style.display = 'block';
                    if (bulbDetailsContent) bulbDetailsContent.style.display = 'none';
                    if (bulbToggleBtn) {
                        bulbToggleBtn.style.display = 'block';
                        bulbToggleBtn.style.transform = 'rotate(0deg)';
                    }
                    // 現在の値に合わせてプルダウンを初期化
                    const valStr = comp.value.toString();
                    const options = Array.from(bulbPresetsSelect.options).map(o => o.value);
                    if (options.includes(valStr)) {
                        bulbPresetsSelect.value = valStr;
                    }
                } else {
                    bulbPresetsContainer.style.display = 'none';
                    if (bulbDetailsContent) bulbDetailsContent.style.display = 'block';
                    if (bulbToggleBtn) bulbToggleBtn.style.display = 'none';
                }
            }

            // スライダーの設定
            const slider = document.getElementById('comp-value-slider');
            if (slider) {
                slider.style.display = isMeter ? 'none' : 'block';
                
                if (isMeter) {
                    document.getElementById('input-group-number').style.display = 'none';
                    if (saveBtn) saveBtn.style.display = 'none';
                } else {
                    if (saveBtn) saveBtn.style.display = 'block';
                }
                
                if (!isMeter) {
                    let min = 0, max = 100, step = 1;
                    if (comp.type === 'battery' || comp.type === 'ac_source') { min = 0.1; max = 50; step = 0.1; }
                    else if (comp.type === 'capacitor') { min = 1000; max = 100000; step = 1000; }
                    else if (comp.type === 'inductor') { min = 100; max = 10000; step = 100; }
                    else if (comp.type === 'resistor') { min = 1; max = 100; step = 1; }
                    else if (comp.type === 'bulb') { min = 1; max = 120; step = 1; }
                    
                    slider.min = min;
                    slider.max = max;
                    slider.step = step;
                    slider.value = comp.value;
                }
            }

            const acFields = document.getElementById('extra-ac-only');
            const rIntFields = document.getElementById('extra-rint-only');
            const isBattery = (comp.type === 'battery');
            const isAC = (comp.type === 'ac_source');

            if (isBattery || isAC) {
                if (acToggleBtn) {
                    acToggleBtn.style.display = 'block';
                    acToggleBtn.style.transform = 'rotateX(0deg)';
                }
                if (extraPanel) extraPanel.style.display = 'none';
                if (acFields) acFields.style.display = isAC ? 'block' : 'none';
                if (rIntFields) rIntFields.style.display = 'block';
                
                // Initialize rInt values
                const rInt = (comp.rInt !== undefined) ? comp.rInt : 0.001;
                document.getElementById('comp-rint').value = rInt;
                document.getElementById('comp-rint-slider').value = rInt;

                if (isAC) {
                    document.getElementById('comp-freq').value = comp.freq || 1.0;
                    document.getElementById('comp-freq-slider').value = comp.freq || 1.0;
                    document.getElementById('comp-phase').value = (comp.phase !== undefined) ? comp.phase : 90.0;
                    document.getElementById('comp-phase-slider').value = (comp.phase !== undefined) ? comp.phase : 90.0;
                }
            } else if (!isMeter) {
                if (acToggleBtn) acToggleBtn.style.display = 'none';
                if (extraPanel) extraPanel.style.display = 'none';
            }
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
            if (comp.type === 'battery' || comp.type === 'ac_source') {
                comp.rInt = parseFloat(document.getElementById('comp-rint').value) || 0.001;
                if (comp.type === 'ac_source') {
                    comp.freq = parseFloat(document.getElementById('comp-freq').value) || 1.0;
                    comp.phase = parseFloat(document.getElementById('comp-phase').value);
                    if (isNaN(comp.phase)) comp.phase = 90.0;
                }
            }
        }
    }
    paramModal.style.display = 'none';
    if (isSimulating) {
        activeNetlist = buildNetlist();
    }
    render();
}

function getLabel(type) {
    return { battery: '電池', ac_source: '交流電源', resistor: '抵抗', bulb: '電球', capacitor: 'コンデンサー', inductor: 'コイル', wire: '導線ー', wire_l: '導線L', wire_t: '導線T', switch: 'スイッチ', voltmeter: '電圧計', ammeter: '電流計' }[type];
}

function getShortLabel(type) {
    return { battery: 'DC', ac_source: 'AC', resistor: 'R', bulb: 'B', capacitor: 'C', inductor: 'L', voltmeter: 'Vm', ammeter: 'Am' }[type] || type;
}

// Rendering
function render() {
    circuitLayer.innerHTML = '';
    interactionLayer.innerHTML = '';
    ghostLayer.innerHTML = ''; // 予期せず残った残像を掃除

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
        const hr = CELL_SIZE * 0.35;
        hitBox.setAttribute('x', -hr);
        hitBox.setAttribute('y', -hr);
        hitBox.setAttribute('width', hr * 2);
        hitBox.setAttribute('height', hr * 2);
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
            
            if (isSimulating) return; // シミュレーション中は移動不可
            
            startDragging(e, comp.type, false, comp.id);
        });

        wrapper.appendChild(group);

        // Add label overlay (Unrotated, stays upright)
        if (!comp.type.startsWith('wire') && comp.type !== 'switch') {
            let displayValueText = '';
            
            if (isSimulating && simulationResults && simulationResults.success && (comp.type === 'voltmeter' || comp.type === 'ammeter')) {
                const { n1, n2 } = getCompNodeNames(comp);
                
                if (comp.type === 'voltmeter') {
                    const volt = Math.abs((simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0));
                    displayValueText = `${volt.toFixed(2)}V`;
                } else if (comp.type === 'ammeter') {
                    const curr = Math.abs(simulationResults.currents[comp.id] || 0);
                    displayValueText = `${curr.toFixed(3)}A`;
                }
            } else {
                const unit = { battery: 'V', ac_source: 'V', resistor: 'Ω', bulb: 'Ω', capacitor: 'μF', inductor: 'mH', voltmeter: 'V', ammeter: 'A' }[comp.type] || '';
                if (comp.type === 'voltmeter' || comp.type === 'ammeter') {
                    displayValueText = `0.00${unit}`;
                } else {
                    if (comp.type === 'bulb') {
                        const ratings = {
                            '5': "1.5V-0.3A",
                            '8.33': "2.5V-0.3A",
                            '12.67': "3.8V-0.3A",
                            '42': "6.3V-0.15A",
                            '109': "12V-0.11A"
                        };
                        displayValueText = ratings[comp.value.toString()] || `${comp.value}${unit}`;
                    } else {
                        displayValueText = `${comp.value}${unit}`;
                    }
                }
            }

            if (displayValueText) {
                const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.id = `label-value-${comp.id}`;
                txt.textContent = displayValueText;
                txt.setAttribute('x', 0);
                txt.setAttribute('y', CELL_SIZE * 0.42); // マスのサイズに応じて位置を調整
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('font-size', `${Math.max(10, CELL_SIZE * 0.16)}px`); // 文字サイズも動的に変更
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
            btnBg.setAttribute('x', -CELL_SIZE * 0.23);
            btnBg.setAttribute('y', CELL_SIZE * 0.2);
            btnBg.setAttribute('width', CELL_SIZE * 0.46);
            btnBg.setAttribute('height', CELL_SIZE * 0.23);
            btnBg.setAttribute('rx', 4);
            btnBg.setAttribute('fill', '#fff');
            
            const btnTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            btnTxt.textContent = comp.value === 1 ? 'ON' : 'OFF';
            btnTxt.setAttribute('x', 0);
            btnTxt.setAttribute('y', CELL_SIZE * 0.36);
            btnTxt.setAttribute('text-anchor', 'middle');
            btnTxt.setAttribute('font-size', `${Math.max(9, CELL_SIZE * 0.15)}px`);
            btnTxt.setAttribute('font-weight', 'bold');
            btnTxt.setAttribute('fill', '#1a1b1e');
            btnTxt.setAttribute('pointer-events', 'none');
            
            swBtn.appendChild(btnBg);
            swBtn.appendChild(btnTxt);
            
            swBtn.addEventListener('pointerdown', (e) => {
                e.stopPropagation(); // prevent panel dragging or editing
                comp.value = comp.value === 1 ? 0 : 1;
                if (isSimulating) {
                    activeNetlist = buildNetlist();
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
                updateDynamicUI(dt);
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
        updateBulbVisuals(); // 2D電球のリアルタイム明滅を更新
        if (simulator3D.isActive) {
            simulator3D.updateParticles(components, simulationResults);
        }
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

function updateDynamicUI(currentDt) {
    // Update component labels
    components.forEach(comp => {
        const txt = document.getElementById(`label-value-${comp.id}`);
        if (txt && simulationResults && simulationResults.success) {
            if (comp.type === 'voltmeter') {
                const { n1, n2 } = getCompNodeNames(comp);
                const volt = (simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0);
                txt.textContent = `${volt.toFixed(2)}V`;
            } else if (comp.type === 'ammeter') {
                const curr = simulationResults.currents[comp.id] || 0;
                txt.textContent = `${curr.toFixed(3)}A`;
            }
        }
    });
    // Update Results Table
    if (document.getElementById('results-panel').style.display === 'block') {
        updateResultsTable();
    }

    // Record Graph Data based on simulation time
    if (simulationResults && simulationResults.success) {
        graphAccumulatedTime += currentDt;
        if (graphAccumulatedTime >= graphSampleInterval) {
            const entry = { voltages: {}, currents: {} };
            const validComponents = components.filter(c => !c.type.startsWith('wire') && c.type !== 'switch');
            
            validComponents.forEach(comp => {
                const { n1, n2 } = getCompNodeNames(comp);
                const v = (simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0);
                let i = simulationResults.currents[comp.id] || 0;
                if (comp.type === 'battery' || comp.type === 'ac_source') {
                    i = -i;
                }
                entry.voltages[comp.id] = v;
                entry.currents[comp.id] = i;
            });

            globalGraphHistory.push(entry);
            if (globalGraphHistory.length > maxGraphHistory) globalGraphHistory.shift();


            
            document.getElementById('graph-v-range-val').innerText = graphRangeV.toFixed(1) + 'V';
            document.getElementById('graph-i-range-val').innerText = graphRangeI.toFixed(2) + 'A';
            
            drawGraph('voltage-graph-canvas', 'v', graphRangeV);
            drawGraph('current-graph-canvas', 'i', graphRangeI);
            
            updateGraphLegend();
            graphAccumulatedTime = 0;
        }
    }
}

function updateBulbVisuals() {
    if (!simulationResults || !simulationResults.currents) return;

    // 全ての発光円を更新
    const glows = document.querySelectorAll('.bulb-glow');
    glows.forEach(glow => {
        const bId = glow.getAttribute('data-comp-id');
        const iVal = simulationResults.currents[bId] || 0;
        
        // 抵抗値 R を取得 (components配列から検索)
        const comp = components.find(c => c.id === bId);
        const R = comp ? (comp.value || 10) : 10; // デフォルト10Ω
        
        const power = iVal * iVal * R; // P = I^2 * R
        const intensity = Math.sqrt(power); // Pの平方根
        
        // 半径 r = k * sqrt(P)
        const k = (typeof appConfig !== 'undefined' && appConfig.bulbGlowK) ? appConfig.bulbGlowK : 30;
        let radius = intensity * k;

        // 上限と下限の適用
        const minR = (typeof appConfig !== 'undefined' && appConfig.bulbGlowMinR) ? appConfig.bulbGlowMinR : 5;
        const maxR = (typeof appConfig !== 'undefined' && appConfig.bulbGlowMaxR) ? appConfig.bulbGlowMaxR : 60;
        
        if (radius > maxR) radius = maxR;
        
        glow.setAttribute('r', radius);
        // 下限を下回る場合は隠す
        glow.style.display = radius >= minR ? 'block' : 'none';
    });

    // 全てのフィラメントを更新
    const filaments = document.querySelectorAll('.bulb-filament');
    filaments.forEach(fil => {
        const bId = fil.getAttribute('data-comp-id');
        const iVal = simulationResults.currents[bId] || 0;
        
        const comp = components.find(c => c.id === bId);
        const R = comp ? (comp.value || 10) : 10;
        const power = iVal * iVal * R;
        const intensity = Math.min(Math.sqrt(power), 1.0);

        const r = Math.round(73 + (255 - 73) * intensity);
        const gValue = Math.round(80 + (255 - 80) * intensity);
        const b = Math.round(87 + (255 - 87) * intensity);
        fil.setAttribute('stroke', `rgb(${r},${gValue},${b})`);
    });
}

function updateGraphLegend() {
    const vLegend = document.getElementById('voltage-graph-legend');
    const iLegend = document.getElementById('current-graph-legend');
    if (!vLegend || !iLegend) return;

    vLegend.innerHTML = '';
    iLegend.innerHTML = '';

    const lastEntry = globalGraphHistory.length > 0 ? globalGraphHistory[globalGraphHistory.length - 1] : null;

    selectedGraphCompIds.forEach((compId, idx) => {
        const comp = components.find(c => c.id === compId);
        if (!comp) return;
        const shortLabel = getShortLabel(comp.type);
        const label = `${shortLabel} (${comp.x},${comp.y})`;
        const color = compColors[comp.type] || '#888';

        // Count same types for dashed style in legend
        let sameTypeCount = 0;
        for (let i = 0; i < idx; i++) {
            const prevComp = components.find(c => c.id === selectedGraphCompIds[i]);
            if (prevComp && prevComp.type === comp.type) sameTypeCount++;
        }
        
        const createItem = (c, count, value) => {
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.gap = '5px';
            div.style.fontSize = '11px';
            div.style.fontFamily = "'Roboto Mono', monospace";
            div.style.color = 'var(--text-secondary)';
            
            let iconStyle = `width:30px; height:3px;`;
            if (count === 0) {
                iconStyle += `background-color: ${color};`;
            } else if (count === 1) {
                // Dashed [8, 4]
                iconStyle += `background-image: linear-gradient(to right, ${color} 0, ${color} 8px, transparent 8px, transparent 12px); background-size: 12px 3px; background-repeat: repeat-x;`;
            } else if (count === 2) {
                // Dotted [2, 3]
                iconStyle += `background-image: linear-gradient(to right, ${color} 0, ${color} 2px, transparent 2px, transparent 5px); background-size: 5px 3px; background-repeat: repeat-x;`;
            } else if (count >= 3) {
                // Dash-dot [12, 3, 3, 3]
                iconStyle += `background-image: linear-gradient(to right, ${color} 0, ${color} 12px, transparent 12px, transparent 15px, ${color} 15px, ${color} 18px, transparent 18px, transparent 21px); background-size: 21px 3px; background-repeat: repeat-x;`;
            }
            
            div.innerHTML = `<div style="${iconStyle}"></div>
                             <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${label}: <b style="color:var(--text-primary);">${value}</b></span>`;
            return div;
        };

        let vNum = lastEntry ? (lastEntry.voltages[compId] || 0) : null;
        let iNum = lastEntry ? (lastEntry.currents[compId] || 0) : null;

        if (vNum !== null && iNum !== null) {
            // 抵抗・電球・コンデンサ・コイルで絶対値モードがONの場合
            if (showAbsoluteValues && (comp.type === 'resistor' || comp.type === 'bulb' || comp.type === 'capacitor' || comp.type === 'inductor')) {
                vNum = Math.abs(vNum);
                iNum = Math.abs(iNum);
            }
        }

        const vVal = vNum !== null ? vNum.toFixed(2) + 'V' : '--';
        const iVal = iNum !== null ? iNum.toFixed(3) + 'A' : '--';

        vLegend.appendChild(createItem(color, sameTypeCount, vVal));
        iLegend.appendChild(createItem(color, sameTypeCount, iVal));
    });
}

function drawGraph(canvasId, prop, maxVal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.setLineDash([]); // Reset dash for grid lines

    // Grid lines & Labels
    const isDark = appConfig.darkMode;
    ctx.lineWidth = 1;
    ctx.font = '12px Roboto Mono, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const unit = prop === 'v' ? 'V' : 'A';
    const lines = [0.1, 0.3, 0.5, 0.7, 0.9];
    const vals = [maxVal, maxVal * 0.5, 0, -maxVal * 0.5, -maxVal];

    lines.forEach((ratio, i) => {
        const y = h * ratio;
        ctx.strokeStyle = (ratio === 0.5) ? 
            (isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)') : 
            (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)');
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(w, y);
        ctx.stroke();

        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
        const label = vals[i].toFixed(prop === 'v' ? 1 : 2) + unit;
        ctx.fillText(label, 5, y - 8);
    });

    // Draw all traces
    selectedGraphCompIds.forEach((compId, traceIdx) => {
        if (globalGraphHistory.length < 2) return;

        const comp = components.find(c => c.id === compId);
        if (!comp) return;

        ctx.beginPath();
        const color = compColors[comp.type] || '#888';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        
        // Line style for same-type duplicates
        let sameTypeCount = 0;
        for (let i = 0; i < traceIdx; i++) {
            const prevComp = components.find(c => c.id === selectedGraphCompIds[i]);
            if (prevComp && prevComp.type === comp.type) sameTypeCount++;
        }
        
        if (sameTypeCount === 1) ctx.setLineDash([8, 4]);           // Dashed
        else if (sameTypeCount === 2) ctx.setLineDash([2, 3]);      // Dotted
        else if (sameTypeCount >= 3) ctx.setLineDash([12, 3, 3, 3]); // Dash-dot
        else ctx.setLineDash([]);                                  // Solid
        
        const dataKey = (prop === 'v') ? 'voltages' : 'currents';
        
        for (let idx = 0; idx < globalGraphHistory.length; idx++) {
            const x = (idx / (maxGraphHistory - 1)) * w;
            let val = globalGraphHistory[idx][dataKey][compId];
            if (val === undefined) continue;

            // Apply absolute value if toggle is on for passive components
            if (showAbsoluteValues && (comp.type === 'resistor' || comp.type === 'bulb' || comp.type === 'capacitor' || comp.type === 'inductor')) {
                val = Math.abs(val);
            }

            const y = h/2 - (val / maxVal) * (h * 0.4); 
            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });
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
                // if (Math.abs(i) < 1e-6) return; // コメントアウトまたは削除
                // Use a fixed particle count for T-wire legs to avoid teleportation
                const numParticles = 2; 
                for (let p = 0; p < numParticles; p++) {
                    const normProg = (comp.legProgress[side] + p / numParticles) % 1;
                    
                    const r = Math.max(1.2, CELL_SIZE * 0.035);
                    const half = CELL_SIZE / 2;
                    
                    let lx = 0, ly = 0;
                    if (side === 'left') { lx = -half + normProg * half; }
                    else if (side === 'right') { lx = half - normProg * half; }
                    else if (side === 'top') { ly = -half + normProg * half; }
                    else if (side === 'bottom') { ly = half - normProg * half; }

                    const cx = comp.x * CELL_SIZE + half;
                    const cy = comp.y * CELL_SIZE + half;
                    
                    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    circle.setAttribute('cx', cx + lx);
                    circle.setAttribute('cy', cy + ly);
                    circle.setAttribute('r', r);
                    circle.setAttribute('fill', '#fcc419');
                    circle.setAttribute('filter', `drop-shadow(0 0 ${r}px #fcc419)`);
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

            const r = Math.max(1.2, CELL_SIZE * 0.035);
            const half = CELL_SIZE / 2;
            const cx = comp.x * CELL_SIZE + half;
            const cy = comp.y * CELL_SIZE + half;
            
            const drawCapParticle = (lx, ly) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', cx + lx);
                circle.setAttribute('cy', cy + ly);
                circle.setAttribute('r', r);
                circle.setAttribute('fill', '#fcc419');
                circle.setAttribute('filter', `drop-shadow(0 0 ${r}px #fcc419)`);
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

            // 2. Draw Moving Charges (always visible, will stay static if i is 0)
            const numCapParticles = 2; // Use 2 particles per wire to match visual density
            for (let p = 0; p < numCapParticles; p++) {
                const progress = (comp.pProgress + p / numCapParticles) % 1;
                const half = CELL_SIZE / 2;
                const gap = CELL_SIZE * 0.1; // 6px relative to 60
                const travel = half - gap;   // 24px relative to 60
                
                let lx1 = 0, ly1 = 0, lx2 = 0, ly2 = 0;
                if (comp.rotation === 0) {
                    lx1 = -half + progress * travel; ly1 = 0;
                    lx2 = gap + progress * travel; ly2 = 0;
                } else if (comp.rotation === 1) {
                    lx1 = 0; ly1 = -half + progress * travel;
                    lx2 = 0; ly2 = gap + progress * travel;
                } else if (comp.rotation === 2) {
                    lx1 = half - progress * travel; ly1 = 0;
                    lx2 = -gap - progress * travel; ly2 = 0;
                } else {
                    lx1 = 0; ly1 = half - progress * travel;
                    lx2 = 0; ly2 = -gap - progress * travel;
                }
                drawCapParticle(lx1, ly1);
                drawCapParticle(lx2, ly2);
            }
            return;
        }

        // if (Math.abs(i) < 1e-6) return; // Skip moving particles for non-capacitors if no current (removed to allow static display)

        // Use a fixed particle count for standard components to avoid teleportation
        const numParticles = 4;

        for (let p = 0; p < numParticles; p++) {
            const progress = (comp.pProgress + p / numParticles) % 1;
            const pos = getParticlePos(comp, progress); // Normalize 0..1
            
            if (pos) {
                const r = Math.max(1.2, CELL_SIZE * 0.035);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', r);
                circle.setAttribute('fill', '#fcc419'); // Golden light
                circle.setAttribute('filter', `drop-shadow(0 0 ${r}px #fcc419)`);
                layer.appendChild(circle);
            }
        }
    });
}

function getParticlePos(comp, progress) {
    const half = CELL_SIZE / 2;
    const cx = comp.x * CELL_SIZE + half;
    const cy = comp.y * CELL_SIZE + half;
    
    let lx, ly;
    
    if (comp.type === 'wire_l') {
        if (progress < 0.5) {
            lx = 0; ly = -half + progress * 2 * half;
        } else {
            lx = (progress - 0.5) * 2 * half; ly = 0;
        }
        if (comp.rotation === 1) { const tx = lx; lx = -ly; ly = tx; }
        else if (comp.rotation === 2) { lx = -lx; ly = -ly; }
        else if (comp.rotation === 3) { const tx = lx; lx = ly; ly = -tx; }
        return { x: cx + lx, y: cy + ly };
    }

    if (comp.rotation === 0) { // H
        lx = -half + progress * CELL_SIZE; ly = 0;
    } else if (comp.rotation === 1) { // V
        lx = 0; ly = -half + progress * CELL_SIZE;
    } else if (comp.rotation === 2) { // H Rev
        lx = half - progress * CELL_SIZE; ly = 0;
    } else { // V Rev
        lx = 0; ly = half - progress * CELL_SIZE;
    }
    return { x: cx + lx, y: cy + ly };
}

function drawComponentVisual(comp) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    
    // 現在のCELL_SIZEに合わせてパーツをスケーリング (基準サイズを60とする)
    const scale = CELL_SIZE / 60;
    g.setAttribute('transform', `scale(${scale})`);
    
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
    else if (comp.type === 'ac_source') bgColorVar = '--bg-ac_source';

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
            if (showIllustrations) {
                // リアルな電池の描画 (実物風)
                const batId = comp.id || 'ghost';
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                
                // 本体のグラデーション (赤)
                const gradBody = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradBody.setAttribute('id', `grad-battery-body-${batId}`);
                gradBody.setAttribute('x1', '0%'); gradBody.setAttribute('y1', '0%');
                gradBody.setAttribute('x2', '0%'); gradBody.setAttribute('y2', '100%');
                gradBody.innerHTML = `
                    <stop offset="0%" style="stop-color:#ff5c5c;stop-opacity:1" />
                    <stop offset="30%" style="stop-color:#e03131;stop-opacity:1" />
                    <stop offset="70%" style="stop-color:#c92a2a;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#a52828;stop-opacity:1" />
                `;
                
                // 金属端子のグラデーション
                const gradMetal = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradMetal.setAttribute('id', `grad-battery-metal-${batId}`);
                gradMetal.setAttribute('x1', '0%'); gradMetal.setAttribute('y1', '0%');
                gradMetal.setAttribute('x2', '0%'); gradMetal.setAttribute('y2', '100%');
                gradMetal.innerHTML = `
                    <stop offset="0%" style="stop-color:#f8f9fa;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#adb5bd;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#495057;stop-opacity:1" />
                `;
                
                defs.appendChild(gradBody);
                defs.appendChild(gradMetal);
                g.appendChild(defs);

                // プラス端子（左・金属）: -28+3 = -25
                const cap = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                cap.setAttribute('x', -25); cap.setAttribute('y', -8);
                cap.setAttribute('width', 6); cap.setAttribute('height', 16);
                cap.setAttribute('rx', 1);
                cap.setAttribute('fill', `url(#grad-battery-metal-${batId})`);
                
                // 本体: -24+3 = -21
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', -21); body.setAttribute('y', -16);
                body.setAttribute('width', 46); body.setAttribute('height', 32);
                body.setAttribute('rx', 2);
                body.setAttribute('fill', `url(#grad-battery-body-${batId})`);
                
                // ハイライト (光の反射)
                const highlight = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                highlight.setAttribute('x', -21); highlight.setAttribute('y', -12);
                highlight.setAttribute('width', 46); highlight.setAttribute('height', 4);
                highlight.setAttribute('fill', 'rgba(255,255,255,0.2)');
                
                // 文字盤
                const textPlus = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                textPlus.setAttribute('x', -11); textPlus.setAttribute('y', 5);
                textPlus.setAttribute('text-anchor', 'middle'); textPlus.setAttribute('fill', 'white');
                textPlus.setAttribute('style', 'font: bold 16px Arial');
                textPlus.textContent = '+';

                // 稲妻マーク (Pathを右に3ずらす)
                const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                bolt.setAttribute('d', 'M 8,-8 L 14,-1 L 10,-1 L 15,8 L 9,1 L 13,1 Z');
                bolt.setAttribute('fill', 'rgba(255,255,255,0.8)');
                
                // 導線との接続点（左右5pxずつで均等化）
                path.setAttribute('d', 'M -30,0 L -25,0 M 25,0 L 30,0');
                g.appendChild(path);
                
                g.appendChild(cap);
                g.appendChild(body);
                g.appendChild(highlight);
                g.appendChild(textPlus);
                g.appendChild(bolt);
                return g;
            } else {
                // 従来の図記号
                path.setAttribute('d', 'M -30,0 L -6,0 M 6,0 L 30,0');
                path.setAttribute('stroke-linecap', 'round');
                const plates = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                plates.setAttribute('d', 'M -6,-18 L -6,18 M 6,-10 L 6,10');
                plates.setAttribute('stroke', color);
                plates.setAttribute('stroke-width', '4');
                plates.setAttribute('fill', 'none');
                plates.setAttribute('stroke-linecap', 'round');
                g.appendChild(plates);
                g.appendChild(path);
            }
            break;
        case 'ac_source':
            path.setAttribute('d', 'M -30,0 L -18,0 M 18,0 L 30,0');
            const acCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            acCircle.setAttribute('cx', 0); acCircle.setAttribute('cy', 0); acCircle.setAttribute('r', 18);
            acCircle.setAttribute('fill', 'var(--inner-fill)'); 
            acCircle.setAttribute('stroke', color); acCircle.setAttribute('stroke-width', '3');
            const wave = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            wave.setAttribute('d', 'M -10,0 C -10,-6 -5,-6 0,0 C 5,6 10,6 10,0');
            wave.setAttribute('stroke', color); wave.setAttribute('stroke-width', '2'); wave.setAttribute('fill', 'none');
            g.appendChild(acCircle); g.appendChild(wave);
            g.appendChild(path);
            break;
        case 'resistor':
            if (showIllustrations) {
                // リアルな抵抗器の描画
                const resId = comp.id || 'ghost';
                const resValue = (comp.value !== undefined) ? comp.value : 1000;
                
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                const gradBody = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradBody.setAttribute('id', `grad-res-body-${resId}`);
                gradBody.setAttribute('x1', '0%'); gradBody.setAttribute('y1', '0%');
                gradBody.setAttribute('x2', '0%'); gradBody.setAttribute('y2', '100%');
                gradBody.innerHTML = `
                    <stop offset="0%" style="stop-color:#fdf5e6;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#f5e1a4;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#e6d08a;stop-opacity:1" />
                `;
                defs.appendChild(gradBody);
                g.appendChild(defs);

                // 導線（リード線）: テーマに合わせて色を変更
                path.setAttribute('d', 'M -30,0 L 30,0');
                path.setAttribute('stroke', color);
                path.setAttribute('stroke-width', '2');
                g.appendChild(path);

                // 本体 (ひょうたん型)
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', -16); body.setAttribute('y', -7);
                body.setAttribute('width', 32); body.setAttribute('height', 14);
                body.setAttribute('rx', 5);
                body.setAttribute('fill', `url(#grad-res-body-${resId})`);
                g.appendChild(body);

                // カラーバンド (抵抗値に基づいて動的に算出)
                const resColors = getResistorColorBands(resValue);
                const bandPositions = [-10, -5, 0, 8];
                resColors.forEach((c, i) => {
                    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    r.setAttribute('x', bandPositions[i]); r.setAttribute('y', -7);
                    r.setAttribute('width', 2.5); r.setAttribute('height', 14);
                    r.setAttribute('fill', c);
                    g.appendChild(r);
                });
                addPassivePolarity(g, color);
                return g;
            } else {
                path.setAttribute('d', 'M -30,0 L -15,0 M 15,0 L 30,0');
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', -15); rect.setAttribute('y', -7);
                rect.setAttribute('width', 30); rect.setAttribute('height', 14);
                rect.setAttribute('fill', 'var(--inner-fill)'); rect.setAttribute('stroke', color); rect.setAttribute('stroke-width', '2');
                g.appendChild(rect);
                g.appendChild(path);
                addPassivePolarity(g, color);
                return g;
            }
        case 'wire':
            path.setAttribute('d', 'M -30,0 L 30,0');
            g.appendChild(path);
            break;
        case 'wire_l':
            path.setAttribute('d', 'M 0,-30 L 0,0 L 30,0');
            g.appendChild(path);
            break;
        case 'wire_t':
            path.setAttribute('d', 'M -30,0 L 30,0 M 0,0 L 0,30');
            const tDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            tDot.setAttribute('cx', 0); tDot.setAttribute('cy', 0); tDot.setAttribute('r', 2); tDot.setAttribute('fill', color);
            g.appendChild(path);
            g.appendChild(tDot);
            break;
        case 'bulb':
            if (showIllustrations) {
                const bId = comp.id || 'ghost';
                const intensity = Math.min(bulbIntensity * 2, 1); // 発光強度
                const isLit = intensity > 0.01;
                
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                
                // ガラスのグラデーション (常に消灯状態の見た目)
                const gradGlass = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
                gradGlass.setAttribute('id', `grad-bulb-glass-${bId}`);
                gradGlass.setAttribute('cx', '30%'); gradGlass.setAttribute('cy', '30%');
                gradGlass.setAttribute('r', '50%');
                gradGlass.innerHTML = `
                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.8" />
                    <stop offset="100%" style="stop-color:#dee2e6;stop-opacity:0.2" />
                `;
                
                // 金属口金のグラデーション
                const gradBase = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradBase.setAttribute('id', `grad-bulb-base-${bId}`);
                gradBase.setAttribute('x1', '0%'); gradBase.setAttribute('y1', '0%');
                gradBase.setAttribute('x2', '100%'); gradBase.setAttribute('y2', '0%');
                gradBase.innerHTML = `
                    <stop offset="0%" style="stop-color:#868e96;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#ced4da;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#495057;stop-opacity:1" />
                `;
                
                defs.appendChild(gradGlass);
                defs.appendChild(gradBase);
                g.appendChild(defs);

                // 導線 (リード線: 左は底面、右は側面へ)
                path.setAttribute('d', 'M -30,0 L -15,0 L -15,20.5 L -5,20.5 M 30,0 L 15,0 L 15,10 L 9,10');
                g.appendChild(path);

                // 口金 (ソケット・ネジ部分)
                const baseGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                
                // 口金本体
                const base = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                base.setAttribute('x', -9); base.setAttribute('y', 1); // -4 -> 1 下げた
                base.setAttribute('width', 18); base.setAttribute('height', 18);
                base.setAttribute('rx', 2);
                base.setAttribute('fill', `url(#grad-bulb-base-${bId})`);
                baseGroup.appendChild(base);

                // ネジ模様 (スレッド)
                for (let i = 0; i < 4; i++) {
                    const thread = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    const ty = 4 + i * 4; // 位置を下げた
                    thread.setAttribute('d', `M -9,${ty} Q 0,${ty + 1} 9,${ty}`);
                    thread.setAttribute('fill', 'none');
                    thread.setAttribute('stroke', 'rgba(0,0,0,0.2)');
                    thread.setAttribute('stroke-width', '1');
                    baseGroup.appendChild(thread);
                }
                
                // 先端の接触点
                const tip = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                tip.setAttribute('x', -5); tip.setAttribute('y', 19); // 14 -> 19
                tip.setAttribute('width', 10); tip.setAttribute('height', 3);
                tip.setAttribute('fill', '#495057');
                baseGroup.appendChild(tip);

                g.appendChild(baseGroup);

                // ガラス球 (色は固定)
                const glass = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                glass.setAttribute('cx', 0); glass.setAttribute('cy', -10);
                glass.setAttribute('r', 15);
                glass.setAttribute('fill', `url(#grad-bulb-glass-${bId})`);
                glass.setAttribute('stroke', 'rgba(173, 181, 189, 0.5)'); // 常に枠線あり
                glass.setAttribute('stroke-width', '1');
                g.appendChild(glass);

                // フィラメント (位置を下げ、上端を中心より少し上に配置)
                const filament = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                filament.setAttribute('d', 'M -5,-6 C -5,-13 5,-13 5,-6');
                filament.setAttribute('fill', 'none');
                filament.setAttribute('class', 'bulb-filament'); // クラス追加
                filament.setAttribute('data-comp-id', bId); // ID追加
                const r = Math.round(73 + (255 - 73) * intensity);
                const gValue = Math.round(80 + (255 - 80) * intensity);
                const b = Math.round(87 + (255 - 87) * intensity);
                filament.setAttribute('stroke', `rgb(${r},${gValue},${b})`);
                filament.setAttribute('stroke-width', '2');
                g.appendChild(filament);

                // 発光用のグラデーション (透明度は最大輝度で固定)
                const gradGlow = document.createElementNS('http://www.w3.org/2000/svg', 'radialGradient');
                gradGlow.setAttribute('id', `grad-bulb-glow-${bId}`);
                gradGlow.setAttribute('cx', '50%'); gradGlow.setAttribute('cy', '50%');
                gradGlow.setAttribute('r', '50%');
                gradGlow.innerHTML = `
                    <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.9" />
                    <stop offset="33.3%" style="stop-color:#ffffff;stop-opacity:0.9" />
                    <stop offset="100%" style="stop-color:#ffff00;stop-opacity:0" />
                `;
                defs.appendChild(gradGlow);
                g.appendChild(defs);

                // 新しい発光エフェクト (常時生成し、半径0〜45で明滅を表現)
                const brightGlow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                brightGlow.setAttribute('cx', 0); brightGlow.setAttribute('cy', -10);
                brightGlow.setAttribute('class', 'bulb-glow');
                brightGlow.setAttribute('data-comp-id', bId);
                brightGlow.setAttribute('r', intensity * 45); 
                brightGlow.setAttribute('fill', `url(#grad-bulb-glow-${bId})`);
                brightGlow.setAttribute('pointer-events', 'none');
                brightGlow.style.display = intensity > 0.001 ? 'block' : 'none';
                g.appendChild(brightGlow);

                addPassivePolarity(g, color);
                return g;
            } else {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', 0); circle.setAttribute('cy', 0); circle.setAttribute('r', 14);
                circle.setAttribute('fill', 'var(--inner-fill)');
                circle.setAttribute('stroke', color); circle.setAttribute('stroke-width', '2');
                path.setAttribute('d', 'M -9.9,-9.9 L 9.9,9.9 M -9.9,9.9 L 9.9,-9.9 M -30,0 L -14,0 M 14,0 L 30,0');
                g.appendChild(circle);
                g.appendChild(path);
                addPassivePolarity(g, color);
                break;
            }
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
            g.appendChild(path);
            addPassivePolarity(g, color);
            break;
        case 'inductor':
            path.setAttribute('d', 'M -30,0 L -15,0 M 15,0 L 30,0 M -15,0 C -15,-10 -7.5,-10 -7.5,0 C -7.5,-10 0,-10 0,0 C 0,-10 7.5,-10 7.5,0 C 7.5,-10 15,-10 15,0');
            g.appendChild(path);
            addPassivePolarity(g, color);
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
            g.appendChild(path); // Wires on top of circle
            
            // Polarity terminals (Front, slightly inside to fit in panel)
            const vPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            vPos.setAttribute('cx', -26); vPos.setAttribute('cy', 0); vPos.setAttribute('r', 4);
            vPos.setAttribute('fill', '#ff0000'); vPos.setAttribute('stroke', color); vPos.setAttribute('stroke-width', '1');
            const vNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            vNeg.setAttribute('cx', 26); vNeg.setAttribute('cy', 0); vNeg.setAttribute('r', 4);
            vNeg.setAttribute('fill', '#777777'); vNeg.setAttribute('stroke', color); vNeg.setAttribute('stroke-width', '1');
            g.appendChild(vPos); g.appendChild(vNeg);
            return g;
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
            g.appendChild(path); // Wires on top of circle
            
            // Polarity terminals (Front, slightly inside to fit in panel)
            const aPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            aPos.setAttribute('cx', -26); aPos.setAttribute('cy', 0); aPos.setAttribute('r', 4);
            aPos.setAttribute('fill', '#ff0000'); aPos.setAttribute('stroke', color); aPos.setAttribute('stroke-width', '1');
            const aNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            aNeg.setAttribute('cx', 26); aNeg.setAttribute('cy', 0); aNeg.setAttribute('r', 4);
            aNeg.setAttribute('fill', '#777777'); aNeg.setAttribute('stroke', color); aNeg.setAttribute('stroke-width', '1');
            g.appendChild(aPos); g.appendChild(aNeg);
            return g;
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
            g.appendChild(path);
            break;
    }
    return g;
}

function addPassivePolarity(g, color) {
    if (showAbsoluteValues) return;
    
    const pos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    pos.setAttribute('cx', -26); pos.setAttribute('cy', 0); pos.setAttribute('r', 4);
    pos.setAttribute('fill', '#ff0000'); pos.setAttribute('stroke', color); pos.setAttribute('stroke-width', '1');
    pos.classList.add('passive-polarity');
    
    const neg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    neg.setAttribute('cx', 26); neg.setAttribute('cy', 0); neg.setAttribute('r', 4);
    neg.setAttribute('fill', '#777777'); neg.setAttribute('stroke', color); neg.setAttribute('stroke-width', '1');
    neg.classList.add('passive-polarity');
    
    g.appendChild(pos);
    g.appendChild(neg);
}

function addRotationZones(group, id) {
    if (isSimulating) return; // シミュレーション中は回転UIを表示しない

    const half = CELL_SIZE / 2;
    const size = Math.max(16, CELL_SIZE * 0.3); // マスの約30%の大きさを回転エリアとする
    const offsets = [
        { x: -half, y: -half },             // TL
        { x: half - size, y: -half },       // TR
        { x: half - size, y: half - size }, // BR
        { x: -half, y: half - size }        // BL
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
            if (c.rotation === 0) { n1 = left; n2 = right; }
            else if (c.rotation === 1) { n1 = top; n2 = bottom; }
            else if (c.rotation === 2) { n1 = right; n2 = left; }
            else { n1 = bottom; n2 = top; }
            
            const netItem = { id: c.id, type: c.type, nodes: [n1, n2], value: c.value };
            if (c.type === 'battery' || c.type === 'ac_source') {
                netItem.rInt = c.rInt;
                if (c.type === 'ac_source') {
                    netItem.freq = c.freq;
                    netItem.phase = c.phase;
                }
            }
            netlist.push(netItem);
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

    const { n1, n2 } = getCompNodeNames(comp);
    
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
    resultsHeader.addEventListener('pointerdown', (e) => {
        if (e.target.id === 'close-results-btn') return;
        isDraggingResults = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialPanelX = resultsPanel.offsetLeft;
        initialPanelY = resultsPanel.offsetTop;
        resultsHeader.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    resultsHeader.addEventListener('pointermove', (e) => {
        if (isDraggingResults) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            resultsPanel.style.left = `${initialPanelX + dx}px`;
            resultsPanel.style.top = `${initialPanelY + dy}px`;
            resultsPanel.style.right = 'auto';
        }
    });

    resultsHeader.addEventListener('pointerup', (e) => {
        isDraggingResults = false;
        resultsHeader.releasePointerCapture(e.pointerId);
    });
    
    resultsHeader.addEventListener('pointercancel', (e) => {
        isDraggingResults = false;
        resultsHeader.releasePointerCapture(e.pointerId);
    });
}

// ゴミ箱の長押しによる全消去機能
let trashLongPressTimer;
if (trashCan && clearConfirmModal && clearConfirmBackdrop) {
    const startLongPress = () => {
        trashLongPressTimer = setTimeout(() => {
            clearConfirmModal.style.display = 'block';
            clearConfirmBackdrop.style.display = 'block';
        }, 800); // 800ms長押しで発動
    };

    const cancelLongPress = () => {
        clearTimeout(trashLongPressTimer);
    };

    trashCan.addEventListener('pointerdown', startLongPress);
    trashCan.addEventListener('pointerup', cancelLongPress);
    trashCan.addEventListener('pointerleave', cancelLongPress);
    trashCan.addEventListener('pointermove', (e) => {
        // 大きく動いたらキャンセル
        if (Math.abs(e.movementX) > 5 || Math.abs(e.movementY) > 5) cancelLongPress();
    });

    // 「はい」ボタン
    document.getElementById('clear-yes-btn').onclick = () => {
        components = [];
        simulationResults = null;
        globalGraphHistory = [];
        selectedGraphCompIds = [];
        
        // 画面更新
        render();
        updateDynamicUI(0);
        
        // 3Dシミュレーターの更新
        if (typeof simulator3D !== 'undefined' && simulator3D && simulator3D.isActive) {
            simulator3D.update(components, simulationResults);
        }
        
        // ダイアログを閉じる
        clearConfirmModal.style.display = 'none';
        clearConfirmBackdrop.style.display = 'none';
        
        // メッセージ表示
        if (messageArea) {
            messageArea.innerText = "すべてのパーツを消去しました";
            messageArea.style.color = "var(--accent-primary)";
            setTimeout(() => { if (messageArea.innerText === "すべてのパーツを消去しました") messageArea.innerText = ""; }, 3000);
        }
    };

    // 「いいえ」ボタン
    document.getElementById('clear-no-btn').onclick = () => {
        clearConfirmModal.style.display = 'none';
        clearConfirmBackdrop.style.display = 'none';
    };

    // 背景クリックでも閉じる
    clearConfirmBackdrop.onclick = () => {
        clearConfirmModal.style.display = 'none';
        clearConfirmBackdrop.style.display = 'none';
    };
}

// ツールバーアイコンを更新する関数
function updateToolbarIcons() {
    const batteryIconBox = document.querySelector('.tool-item[data-type="battery"] .icon-box');
    if (batteryIconBox) {
        if (showIllustrations) {
            batteryIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <linearGradient id="grad-icon-body" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#ff5c5c;stop-opacity:1" />
                            <stop offset="30%" style="stop-color:#e03131;stop-opacity:1" />
                            <stop offset="70%" style="stop-color:#c92a2a;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#a52828;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad-icon-metal" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#f8f9fa;stop-opacity:1" />
                            <stop offset="50%" style="stop-color:#adb5bd;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#495057;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M -30,0 L -22,0 M 22,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <rect x="-22" y="-8" width="6" height="16" rx="1" fill="url(#grad-icon-metal)" />
                    <rect x="-18" y="-14" width="40" height="28" rx="2" fill="url(#grad-icon-body)" />
                    <rect x="-18" y="-11" width="40" height="3" fill="rgba(255,255,255,0.2)" />
                    <text x="-8" y="5" text-anchor="middle" fill="white" style="font: bold 12px Arial; stroke:none;">+</text>
                    <path d="M 8,-6 L 13,-1 L 10,-1 L 14,6 L 9,1 L 12,1 Z" fill="rgba(255,255,255,0.9)" style="stroke:none;" />
                </svg>
            `;
        } else {
            batteryIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -6,0 M 6,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
                    <path d="M -6,-18 L -6,18 M 6,-10 L 6,10" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" />
                </svg>
            `;
        }
    }

    const resIconBox = document.querySelector('.tool-item[data-type="resistor"] .icon-box');
    if (resIconBox) {
        if (showIllustrations) {
            resIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <linearGradient id="grad-icon-res" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#fdf5e6;stop-opacity:1" />
                            <stop offset="50%" style="stop-color:#f5e1a4;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#e6d08a;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M -30,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <rect x="-16" y="-7" width="32" height="14" rx="5" fill="url(#grad-icon-res)" />
                    <rect x="-10" y="-7" width="2.5" height="14" fill="#8b4513" />
                    <rect x="-5" y="-7" width="2.5" height="14" fill="#000000" />
                    <rect x="0" y="-7" width="2.5" height="14" fill="#ff0000" />
                    <rect x="8" y="-7" width="2.5" height="14" fill="#ffd700" />
                    <!-- 極性マーク (電球に倣ったデザイン) -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        } else {
            resIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -15,0 M 15,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <rect x="-15" y="-7" width="30" height="14" fill="var(--inner-fill, white)" stroke="currentColor" stroke-width="2" />
                    <!-- 極性マーク (電球に倣ったデザイン) -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        }
    }

    const bulbIconBox = document.querySelector('.tool-item[data-type="bulb"] .icon-box');
    if (bulbIconBox) {
        if (showIllustrations) {
            bulbIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <radialGradient id="grad-icon-bulb-glass" cx="30%" cy="30%" r="50%">
                            <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.8" />
                            <stop offset="100%" style="stop-color:#dee2e6;stop-opacity:0.3" />
                        </radialGradient>
                        <linearGradient id="grad-icon-bulb-base" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#868e96;stop-opacity:1" />
                            <stop offset="50%" style="stop-color:#ced4da;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#495057;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M -30,0 L -15,0 L -15,16 L -5,16 M 30,0 L 15,0 L 15,7 L 9,7" stroke="currentColor" stroke-width="2" fill="none" />
                    <rect x="-9" y="1" width="18" height="15" rx="2" fill="url(#grad-icon-bulb-base)" />
                    <!-- ネジ模様 -->
                    <path d="M -9,4 Q 0,5 9,4" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
                    <path d="M -9,8 Q 0,9 9,8" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
                    <path d="M -9,12 Q 0,13 9,12" fill="none" stroke="rgba(0,0,0,0.2)" stroke-width="1" />
                    <rect x="-5" y="16" width="10" height="2" fill="#495057" />
                    
                    <circle cx="0" cy="-10" r="14" fill="url(#grad-icon-bulb-glass)" stroke="rgba(173, 181, 189, 0.5)" stroke-width="1" />
                    <path d="M -5,-10 C -5,-16 5,-16 5,-10" fill="none" stroke="#495057" stroke-width="2" />
                    <!-- 極性マーク -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        } else {
            bulbIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <circle cx="0" cy="0" r="14" fill="var(--inner-fill)" stroke="currentColor" stroke-width="2" />
                    <path d="M -9.9,-9.9 L 9.9,9.9 M -9.9,9.9 L 9.9,-9.9 M -30,0 L -14,0 M 14,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <!-- 極性マーク -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        }
    }
}

// 下部ツールバーのイラスト表示ボタン
const illCheck = document.getElementById('illustration-checkbox');
if (illCheck) {
    illCheck.onchange = () => {
        showIllustrations = illCheck.checked;
        updateToolbarIcons();
        render();
        if (typeof simulator3D !== 'undefined' && simulator3D.isActive) {
            simulator3D.update(components, simulationResults);
        }
    };
}

init();
