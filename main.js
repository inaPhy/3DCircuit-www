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
let editingCompType = null;
let editingCompRotation = 0;
let selectedGraphCompIds = []; // Up to 4 components
let globalGraphHistory = []; // [{ t: シミュレーション時刻(s), voltages: {id: v, ...}, currents: {id: i, ...} }, ...]
// 横軸の幅は「画面上で流れる実際の時間」で一定にする。
// シミュレーション時間の幅 = 速度スライダーの倍率 × GRAPH_REAL_TIME_WINDOW（例: 0.1x → 2 s, 1.0x → 20 s）
const GRAPH_REAL_TIME_WINDOW = 20;
const graphSampleInterval = 0.005; // 記録の最小間隔（シミュレーション時間の秒）
const maxGraphHistoryTime = GRAPH_REAL_TIME_WINDOW * 1.0; // 速度スライダー最大(1.0x)時の幅。これより古い記録は捨てる
let graphTimeWindow = 2;
let graphSimTime = 0; // シミュレーション開始からの経過時間（s）
let graphAccumulatedTime = 0;
let graphRangeV = 10.0;
let graphRangeI = 1.00;
let showAbsoluteValues = true; // Default to ON as requested
let showIllustrations = false; // ver2.02: イラスト表示モードのフラグ
let isElectronMode = false; // 電子モード（負電荷）のフラグ
let modalLastOpened = 0; // モーダルが開かれた時刻を記録

const SUPPORTED_COMPONENT_TYPES = new Set([
    'battery', 'ac_source', 'resistor', 'bulb', 'capacitor', 'inductor',
    'voltmeter', 'ammeter', 'wire', 'wire_l', 'wire_t', 'wire_cross', 'switch'
]);
const SAVE_GRID_SIZE_X = 11;
const SAVE_GRID_SIZE_Y = 7;
const MAX_SAVED_COMPONENTS = SAVE_GRID_SIZE_X * SAVE_GRID_SIZE_Y;

function serializeComponent(comp) {
    const saved = {
        id: comp.id,
        type: comp.type,
        x: comp.x,
        y: comp.y,
        rotation: comp.rotation,
        value: comp.value
    };
    ['range', 'rInt', 'freq', 'phase', 'unit'].forEach(key => {
        if (comp[key] !== undefined) saved[key] = comp[key];
    });
    return saved;
}

function validateCircuitFile(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('保存データがオブジェクトではありません。');
    }
    if (!Array.isArray(data.components)) {
        throw new Error('components が配列ではありません。');
    }
    if (data.components.length > MAX_SAVED_COMPONENTS) {
        throw new Error(`部品数が上限（${MAX_SAVED_COMPONENTS}個）を超えています。`);
    }

    const ids = new Set();
    const occupiedCells = new Set();
    const normalizedComponents = data.components.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error(`${index + 1}番目の部品データが不正です。`);
        }
        if (!SUPPORTED_COMPONENT_TYPES.has(raw.type)) {
            throw new Error(`${index + 1}番目の部品種類が未対応です。`);
        }

        const id = (typeof raw.id === 'string' || typeof raw.id === 'number') ? String(raw.id) : '';
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) {
            throw new Error(`${index + 1}番目の部品IDが不正または重複しています。`);
        }
        ids.add(id);

        if (!Number.isInteger(raw.x) || raw.x < 0 || raw.x >= SAVE_GRID_SIZE_X ||
            !Number.isInteger(raw.y) || raw.y < 0 || raw.y >= SAVE_GRID_SIZE_Y) {
            throw new Error(`${index + 1}番目の部品座標が範囲外です。`);
        }
        const cellKey = `${raw.x},${raw.y}`;
        if (occupiedCells.has(cellKey)) {
            throw new Error(`${index + 1}番目の部品が別の部品と重なっています。`);
        }
        occupiedCells.add(cellKey);

        if (!Number.isInteger(raw.rotation) || raw.rotation < 0 || raw.rotation > 3) {
            throw new Error(`${index + 1}番目の回転値が不正です。`);
        }
        if (!Number.isFinite(raw.value) || raw.value < 0) {
            throw new Error(`${index + 1}番目の部品値が不正です。`);
        }
        if (raw.type === 'switch' && raw.value !== 0 && raw.value !== 1) {
            throw new Error(`${index + 1}番目のスイッチ状態が不正です。`);
        }

        const comp = {
            id,
            type: raw.type,
            x: raw.x,
            y: raw.y,
            rotation: raw.rotation,
            value: raw.type.startsWith('wire') ? 0 : raw.value
        };
        ['range', 'rInt', 'freq', 'phase'].forEach(key => {
            if (raw[key] === undefined) return;
            if (!Number.isFinite(raw[key]) || raw[key] < 0) {
                throw new Error(`${index + 1}番目の ${key} が不正です。`);
            }
            comp[key] = raw[key];
        });
        if (raw.unit !== undefined) {
            const unitConfig = SELECTABLE_UNITS[raw.type];
            if (!unitConfig || !unitConfig.options.includes(raw.unit)) {
                throw new Error(`${index + 1}番目の単位が不正です。`);
            }
            comp.unit = raw.unit;
        }
        return comp;
    });

    let settings = null;
    if (data.settings !== undefined) {
        if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
            throw new Error('settings の形式が不正です。');
        }
        settings = {};
        [
            'darkMode', 'absMode', 'show3d', 'showParticles', 'showResults',
            'isElectronMode', 'showIllustrations'
        ].forEach(key => {
            if (data.settings[key] === undefined) return;
            if (typeof data.settings[key] !== 'boolean') {
                throw new Error(`settings.${key} は true または false で指定してください。`);
            }
            settings[key] = data.settings[key];
        });
        if (data.settings.timeScale !== undefined) {
            if (!Number.isFinite(data.settings.timeScale) || data.settings.timeScale < 0 || data.settings.timeScale > 1) {
                throw new Error('settings.timeScale が範囲外です。');
            }
            settings.timeScale = data.settings.timeScale;
        }
        if (data.settings.toolbarVisibility !== undefined) {
            if (!data.settings.toolbarVisibility || typeof data.settings.toolbarVisibility !== 'object' ||
                Array.isArray(data.settings.toolbarVisibility)) {
                throw new Error('settings.toolbarVisibility の形式が不正です。');
            }
            settings.toolbarVisibility = {};
            SUPPORTED_COMPONENT_TYPES.forEach(type => {
                const visible = data.settings.toolbarVisibility[type];
                if (visible === undefined) return;
                if (typeof visible !== 'boolean') {
                    throw new Error(`toolbarVisibility.${type} は true または false で指定してください。`);
                }
                settings.toolbarVisibility[type] = visible;
            });
        }
    }
    return { components: normalizedComponents, settings };
}


// 保存ファイル・回路リンク共通: 現在の回路と表示設定をまとめる
function buildCircuitData() {
    const toolbarVisibility = {};
    document.querySelectorAll('.tool-item').forEach(item => {
        if (!item.dataset.type || !SUPPORTED_COMPONENT_TYPES.has(item.dataset.type)) return;
        toolbarVisibility[item.dataset.type] = item.style.display !== 'none';
    });
    const checked = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    return {
        version: window.APP_VERSION ? window.APP_VERSION.storageFormat : "1.3",
        appVersion: window.APP_VERSION ? window.APP_VERSION.number : undefined,
        components: components.map(serializeComponent),
        settings: {
            darkMode: checked('dark-mode-checkbox'),
            absMode: checked('abs-mode-checkbox'),
            show3d: checked('show-3d-checkbox'),
            showParticles: checked('show-particles-checkbox'),
            showResults: checked('results-toggle-checkbox'),
            isElectronMode: checked('electron-mode-checkbox'),
            timeScale: parseFloat(document.getElementById('time-scale-slider').value),
            showIllustrations: checked('illustration-checkbox'),
            toolbarVisibility: toolbarVisibility
        }
    };
}

// 検証済みの回路データ（validateCircuitFile の戻り値）を画面に反映する
function applyCircuitData(data) {
    if (isSimulating) toggleSimulation(); // 動作中なら停止
    // 今のマス目（スマホ縦画面は横5マス）からはみ出す部品は、画面を狭めたときと同じく削除する
    components = data.components.filter(c => c.x < GRID_SIZE_X && c.y < GRID_SIZE_Y);
    const removedCount = data.components.length - components.length;
    if (data.settings) {
        const applyToggle = (id, value) => {
            if (value === undefined) return;
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
        applyToggle('illustration-checkbox', data.settings.showIllustrations);
        applyToggle('electron-mode-checkbox', data.settings.isElectronMode);

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
    if (removedCount > 0) {
        // 描画が終わってから知らせる
        setTimeout(() => alert(`画面に入りきらない部品が${removedCount}個あったため削除しました。\n横向きの画面で開くと、すべての部品が表示されます。`), 50);
    }
}

// --- 回路リンク ---
// アドレス末尾の #c=... に、保存ファイルと同じ内容（回路＋表示設定）を圧縮して入れる。
// settings.ini は変更せず、リンクを開いたときだけ反映される。読み込み時は保存ファイルと同じ検証を通す。
const CIRCUIT_LINK_KEY = 'c';

function bytesToBase64Url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function transformBytes(bytes, stream) {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(out);
}

// 先頭1文字で形式を区別: z = deflate 圧縮, j = 無圧縮
async function encodeCircuitLink(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    if (typeof CompressionStream !== 'undefined') {
        try {
            return 'z' + bytesToBase64Url(await transformBytes(bytes, new CompressionStream('deflate-raw')));
        } catch (e) { /* 無圧縮にフォールバック */ }
    }
    return 'j' + bytesToBase64Url(bytes);
}

async function decodeCircuitLink(text) {
    const kind = text[0];
    if (kind !== 'z' && kind !== 'j') throw new Error('リンクの形式が不明です。');
    if (kind === 'z' && typeof DecompressionStream === 'undefined') {
        throw new Error('このブラウザは圧縮リンクに対応していません。');
    }
    let bytes;
    try {
        bytes = base64UrlToBytes(text.slice(1));
        if (kind === 'z') bytes = await transformBytes(bytes, new DecompressionStream('deflate-raw'));
    } catch (e) {
        throw new Error('リンクが途中で切れているか、壊れています。');
    }
    if (bytes.length > 200000) throw new Error('リンクのデータが大きすぎます。');
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        throw new Error('リンクが途中で切れているか、壊れています。');
    }
}

async function buildCircuitLink() {
    const encoded = await encodeCircuitLink(buildCircuitData());
    const url = new URL(window.location.href);
    url.hash = `${CIRCUIT_LINK_KEY}=${encoded}`;
    return url.toString();
}

async function loadCircuitFromLink() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const encoded = params.get(CIRCUIT_LINK_KEY);
    if (!encoded) return;
    try {
        applyCircuitData(validateCircuitFile(await decodeCircuitLink(encoded)));
    } catch (err) {
        console.warn('Circuit link could not be loaded.', err);
        alert('リンクから回路を読み込めませんでした: ' + err.message);
    }
}

async function copyCircuitLink(button) {
    let link;
    try {
        link = await buildCircuitLink();
    } catch (err) {
        alert('リンクを作成できませんでした: ' + err.message);
        return;
    }
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(link);
            copied = true;
        } catch (e) { /* 下の方法へ */ }
    }
    if (!copied) {
        window.prompt('このリンクをコピーしてください', link);
        return;
    }
    if (button) {
        const original = button.dataset.label || button.textContent;
        button.dataset.label = original;
        button.textContent = 'コピーしました ✓';
        clearTimeout(button._resetTimer);
        button._resetTimer = setTimeout(() => { button.textContent = original; }, 2000);
    }
    audio.playClick();
}

// パネルの重なり順管理
let topZIndex = 2000;
const bringToFront = (panel) => {
    topZIndex++;
    panel.style.zIndex = topZIndex;
};

// 結果表示エリアから取り出して、ドラッグで自由に動かせる状態にする
function undockPanel(panel) {
    if (panel.classList.contains('floating')) return;
    const rect = panel.getBoundingClientRect();
    panel.classList.add('floating');
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.width = `${rect.width}px`;
}

// 閉じたパネルは次に開くとき結果表示エリアに戻す
function redockPanel(panel) {
    panel.classList.remove('floating');
    ['left', 'top', 'right', 'width'].forEach(prop => { panel.style[prop] = ''; });
}

function updateFooterHeightVar() {
    const footer = document.getElementById('footer');
    if (footer) document.documentElement.style.setProperty('--footer-h', `${footer.offsetHeight}px`);
    const toolbar = document.getElementById('toolbar');
    if (toolbar) document.documentElement.style.setProperty('--toolbar-h', `${toolbar.getBoundingClientRect().bottom}px`);
}
window.addEventListener('resize', updateFooterHeightVar);
window.addEventListener('DOMContentLoaded', () => {
    updateFooterHeightVar();
    document.querySelectorAll('#results-dock > .results-panel').forEach(panel => {
        new MutationObserver(() => {
            if (!panel.classList.contains('show') && panel.classList.contains('floating')) redockPanel(panel);
        }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
    // パネルの幅が変わったらグラフを描き直す
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => { if (typeof redrawGraphs === 'function') redrawGraphs(); });
        ['voltage-graph-canvas', 'current-graph-canvas'].forEach(id => {
            const el = document.getElementById(id);
            if (el) ro.observe(el);
        });
    }
});

// サウンド管理
class AudioManager {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
    playClick(freq = 800, duration = 0.05, type = 'sine') {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.1, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playWhoosh(duration = 0.3) {
        if (!this.enabled || !this.ctx) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);
        noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        noise.start(); noise.stop(this.ctx.currentTime + duration);
    }
    playTrashAll() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.6; 
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + duration);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);
        noise.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
        noise.start(); noise.stop(this.ctx.currentTime + duration);
    }
    playGlocken3() {
        if (!this.enabled || !this.ctx) return;
        const freqs = [659.25, 880.00, 1318.51]; // E6, A6, E7 (高めの電子音)
        freqs.forEach((f, i) => {
            const time = this.ctx.currentTime + i * 0.07; // 非常に速い間隔
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square'; // 電子音らしい矩形波
            osc.frequency.setValueAtTime(f, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.05, time + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1); // 短い余韻
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(time); osc.stop(time + 0.1);
        });
    }
    playGlocken3Off() {
        if (!this.enabled || !this.ctx) return;
        const freqs = [1318.51, 880.00, 659.25]; // E7, A6, E6 (下がる電子音)
        freqs.forEach((f, i) => {
            const time = this.ctx.currentTime + i * 0.07;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(f, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.04, time + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(time); osc.stop(time + 0.1);
        });
    }
    playChime() {
        if (!this.enabled || !this.ctx) return;
        const freqs = [329.63, 440.00]; // E4, A4 (Rising chime)
        freqs.forEach((f, i) => {
            const time = this.ctx.currentTime + i * 0.05;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.05, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(time); osc.stop(time + 0.3);
        });
    }
    playChimeOff() {
        if (!this.enabled || !this.ctx) return;
        const freqs = [440.00, 329.63]; // A4, E4 (Falling chime)
        freqs.forEach((f, i) => {
            const time = this.ctx.currentTime + i * 0.05;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.04, time + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(time); osc.stop(time + 0.3);
        });
    }
    playGearChime() {
        if (!this.enabled || !this.ctx) return;
        const freqs = [329.63, 440.00]; // E4, A4 (メカニカルな和音)
        freqs.forEach((f, i) => {
            const time = this.ctx.currentTime + i * 0.05;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square'; // 矩形波に変更
            osc.frequency.setValueAtTime(f, time);
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(0.03, time + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(time); osc.stop(time + 0.3);
        });
    }
    playPop() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.08;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playPopHigh() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.07; // さらにキレを良く
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1000, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playPopLow() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.1; // わずかに長めに
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playSwitchKachi() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.05;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle'; // 金属的な響きに近いトライアングル波
        osc.frequency.setValueAtTime(1500, this.ctx.currentTime);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.06, this.ctx.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
    playSwitchKachiOff() {
        if (!this.enabled || !this.ctx) return;
        const duration = 0.05;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime); // 少し低めの金属音
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + duration);
    }
}
const audio = new AudioManager();
// ユーザーのクリック（タップ）のたびにAudioContextの状態を確認・再開（iOS対策）
window.addEventListener('pointerdown', () => audio.init());

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

// 3Dcircuit-ARと共通の、学校教材で使いやすい代表値。
const COMPONENT_VALUE_PRESETS = {
    battery: [1.5, 3, 4.5, 6],
    ac_source: [1.5, 3, 5, 12],
    resistor: [5, 10, 15, 20, 30, 40, 50, 100],
    capacitor: [1, 2, 5, 10, 100],
    inductor: [1, 2, 5, 10, 100]
};

// 単位を選べる部品。legacy は unit を持たない旧データ（Ver 2.86 以前）の単位。
const SELECTABLE_UNITS = {
    capacitor: { options: ['F', 'mF', 'μF', 'nF'], defaultUnit: 'F', legacy: 'μF' },
    inductor: { options: ['H', 'mH', 'μH', 'nH'], defaultUnit: 'H', legacy: 'mH' }
};
const UNIT_PREFIX_FACTORS = { '': 1, 'm': 1e-3, 'μ': 1e-6, 'n': 1e-9 };
const FIXED_UNITS = { battery: 'V', ac_source: 'V', resistor: 'Ω', bulb: 'Ω' };

function getCompUnit(comp) {
    const config = SELECTABLE_UNITS[comp.type];
    if (!config) return FIXED_UNITS[comp.type] || '';
    return config.options.includes(comp.unit) ? comp.unit : config.legacy;
}

// シミュレーター用に F・H 単位へ換算した値
function getCompSiValue(comp) {
    const config = SELECTABLE_UNITS[comp.type];
    if (!config) return comp.value;
    const unit = getCompUnit(comp);
    const prefix = unit.slice(0, -1);
    return comp.value * (UNIT_PREFIX_FACTORS[prefix] ?? 1);
}

function getEditorUnit(type) {
    const select = document.getElementById('comp-unit-select');
    if (SELECTABLE_UNITS[type] && select) return select.value;
    return FIXED_UNITS[type] || '';
}

function updateValuePresetHighlight(value) {
    const numericValue = Number(value);
    document.querySelectorAll('#comp-value-presets button').forEach(button => {
        const presetValue = Number(button.dataset.value);
        button.classList.toggle('active', Number.isFinite(numericValue) && Math.abs(presetValue - numericValue) < 1e-9);
    });
}

function setComponentEditorValue(value, syncColorCode = true) {
    const input = document.getElementById('comp-value');
    const slider = document.getElementById('comp-value-slider');
    if (input) input.value = value;
    if (slider) slider.value = value;
    updateValuePresetHighlight(value);
    if (syncColorCode) syncResistorColorCodeFromValue(value);
}

function renderValuePresets(type, currentValue, unit = getEditorUnit(type)) {
    const container = document.getElementById('comp-value-presets');
    if (!container) return;
    const presets = COMPONENT_VALUE_PRESETS[type];
    container.innerHTML = '';
    container.dataset.type = type;
    if (!presets) {
        container.style.display = 'none';
        return;
    }

    presets.forEach(value => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = value;
        button.textContent = `${value} ${unit}`;
        button.addEventListener('click', () => {
            setComponentEditorValue(value);
            audio.playClick();
        });
        container.appendChild(button);
    });
    container.style.display = type === 'resistor' ? 'grid' : 'flex';
    updateValuePresetHighlight(currentValue);
}

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

// シミュレーション時のGND底上げ用のオフセット
let simulationGroundOffset = 0;

/**
 * 回路の定常状態（DC）を解析して、最小電位をGNDオフセットとして設定する
 */
function updateGroundOffset(netlist) {
    if (!netlist || netlist.length === 0) {
        simulationGroundOffset = 0;
        return;
    }
    // 一時的なシミュレータを使用してDC解析を実行
    const tempSim = new Simulator();
    const res = tempSim.solve(netlist, 0); // dt=0
    if (res.success) {
        let minV = Infinity;
        for (let id in res.voltages) {
            if (res.voltages[id] < minV) minV = res.voltages[id];
        }
        simulationGroundOffset = (minV === Infinity) ? 0 : minV;
    } else {
        simulationGroundOffset = 0;
    }
}

/**
 * シミュレーション結果の電位にオフセットを適用する
 */
function applyGroundOffset(res) {
    if (!res || !res.success || !res.voltages) return res;
    const shiftedVoltages = {};
    for (let id in res.voltages) {
        shiftedVoltages[id] = res.voltages[id] - simulationGroundOffset;
    }
    return { ...res, voltages: shiftedVoltages };
}

const RESISTOR_DIGIT_COLORS = [
    { name: '黒', color: '#000000', digit: 0 },
    { name: '茶', color: '#8b4513', digit: 1 },
    { name: '赤', color: '#ff0000', digit: 2 },
    { name: '橙', color: '#ffa500', digit: 3 },
    { name: '黄', color: '#ffff00', digit: 4 },
    { name: '緑', color: '#008000', digit: 5 },
    { name: '青', color: '#0000ff', digit: 6 },
    { name: '紫', color: '#ee82ee', digit: 7 },
    { name: '灰', color: '#808080', digit: 8 },
    { name: '白', color: '#ffffff', digit: 9 }
];

const RESISTOR_MULTIPLIER_COLORS = [
    { name: '銀', color: '#c0c0c0', exponent: -2 },
    { name: '金', color: '#ffd700', exponent: -1 },
    ...RESISTOR_DIGIT_COLORS.map(item => ({ name: item.name, color: item.color, exponent: item.digit }))
];

const RESISTOR_TOLERANCE_COLORS = [
    { name: '茶 1%', color: '#8b4513' },
    { name: '赤 2%', color: '#ff0000' },
    { name: '緑 0.5%', color: '#008000' },
    { name: '青 0.25%', color: '#0000ff' },
    { name: '紫 0.1%', color: '#ee82ee' },
    { name: '灰 0.05%', color: '#808080' },
    { name: '金 5%', color: '#ffd700' },
    { name: '銀 10%', color: '#c0c0c0' }
];

function getResistorColorBands(value, toleranceColor = '#ffd700') {
    const colors = RESISTOR_DIGIT_COLORS.map(item => item.color);
    
    // 0 または負の数は黒として扱う
    if (value <= 0) return [colors[0], colors[0], colors[0], toleranceColor];

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
        toleranceColor
    ];
}

function setResistorBandOptions(select, options, excludedDigits = []) {
    select.innerHTML = '';
    options.forEach(optionData => {
        if (optionData.digit !== undefined && excludedDigits.includes(optionData.digit)) return;
        const option = document.createElement('option');
        option.value = optionData.color;
        option.textContent = optionData.name;
        select.appendChild(option);
    });
}

function updateResistorBandSwatches() {
    [1, 2, 3, 4].forEach(index => {
        const select = document.getElementById(`resistor-band-${index}`);
        const swatch = document.querySelector(`.resistor-color-swatch[data-band="${index}"]`);
        if (select && swatch) swatch.style.backgroundColor = select.value;
    });
}

function getSelectedResistorColorBands() {
    return [1, 2, 3, 4].map(index => document.getElementById(`resistor-band-${index}`)?.value).filter(Boolean);
}

function getResistanceFromColorBands(bands) {
    if (!Array.isArray(bands) || bands.length < 3) return NaN;
    const first = RESISTOR_DIGIT_COLORS.find(item => item.color === bands[0]);
    const second = RESISTOR_DIGIT_COLORS.find(item => item.color === bands[1]);
    const multiplier = RESISTOR_MULTIPLIER_COLORS.find(item => item.color === bands[2]);
    if (!first || !second || !multiplier) return NaN;
    return (first.digit * 10 + second.digit) * Math.pow(10, multiplier.exponent);
}

function syncResistorColorCodeFromValue(value, toleranceColor) {
    const container = document.getElementById('resistor-color-code');
    if (!container || container.style.display === 'none') return;
    const currentTolerance = toleranceColor || document.getElementById('resistor-band-4')?.value || '#ffd700';
    const bands = getResistorColorBands(Number(value), currentTolerance);
    bands.forEach((color, index) => {
        const select = document.getElementById(`resistor-band-${index + 1}`);
        if (select && Array.from(select.options).some(option => option.value === color)) select.value = color;
    });
    updateResistorBandSwatches();
}

function renderResistorColorCode(comp) {
    const container = document.getElementById('resistor-color-code');
    if (!container) return;
    if (!comp || comp.type !== 'resistor') {
        container.style.display = 'none';
        return;
    }

    setResistorBandOptions(document.getElementById('resistor-band-1'), RESISTOR_DIGIT_COLORS, [0]);
    setResistorBandOptions(document.getElementById('resistor-band-2'), RESISTOR_DIGIT_COLORS);
    setResistorBandOptions(document.getElementById('resistor-band-3'), RESISTOR_MULTIPLIER_COLORS);
    setResistorBandOptions(document.getElementById('resistor-band-4'), RESISTOR_TOLERANCE_COLORS);
    container.style.display = 'block';

    const savedBands = Array.isArray(comp.resistorColorBands) ? comp.resistorColorBands : null;
    const savedValue = getResistanceFromColorBands(savedBands);
    const usesSavedBands = Number.isFinite(savedValue) && Math.abs(savedValue - Number(comp.value)) < 1e-9;
    const tolerance = savedBands?.[3] || '#ffd700';
    const bands = usesSavedBands ? savedBands : getResistorColorBands(Number(comp.value), tolerance);
    bands.forEach((color, index) => {
        const select = document.getElementById(`resistor-band-${index + 1}`);
        if (select && Array.from(select.options).some(option => option.value === color)) select.value = color;
    });
    updateResistorBandSwatches();
}

function applyResistorColorCode() {
    const bands = getSelectedResistorColorBands();
    const value = getResistanceFromColorBands(bands);
    if (!Number.isFinite(value)) return;
    const normalizedValue = Number(value.toPrecision(12));
    setComponentEditorValue(normalizedValue, false);
    updateResistorBandSwatches();
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
            if (key === 'showIllustrations' || key === 'illustMode') appConfig.showIllustrations = (value === 'true');
            if (key === 'electronmode') appConfig.electronMode = (value === 'true');
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

    const electronCheck = document.getElementById('electron-mode-checkbox');
    if (electronCheck && appConfig.hasOwnProperty('electronMode')) {
        electronCheck.checked = appConfig.electronMode;
        isElectronMode = appConfig.electronMode;
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
    // settings.ini を反映してから、リンクに回路が入っていれば上書きする
    loadSettings().then(loadCircuitFromLink);
    window.addEventListener('hashchange', loadCircuitFromLink);
    registerServiceWorker();
    render();
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(error => {
            console.warn('Service Worker registration failed.', error);
        });
    });
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
                audio.playChime(); // ON
            } else {
                document.documentElement.classList.add('light-mode');
                audio.playChimeOff(); // OFF
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
            // ABSボタンのみON/OFFの音を入れ替え
            if (showAbsoluteValues) audio.playChimeOff(); // ON(ABS)で下がる音
            else audio.playChime(); // OFF(±)で上がる音
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
                audio.playChime();
                simulator3D.show();
                simulator3D.update(components, simulationResults);
            } else {
                audio.playChimeOff();
                simulator3D.hide();
            }
        });
    }

    // Wire Type Selector
    document.querySelectorAll('.wire-type-option').forEach(opt => {
        opt.addEventListener('click', () => {
            editingCompType = opt.dataset.type;
            editingCompRotation = parseInt(opt.dataset.rotation || 0);
            document.querySelectorAll('.wire-type-option').forEach(o => {
                const isMatch = (o === opt);
                o.style.borderColor = isMatch ? 'var(--accent-primary)' : 'transparent';
                o.style.backgroundColor = isMatch ? 'rgba(255,255,255,0.1)' : 'transparent';
                o.style.boxShadow = isMatch ? '0 0 10px var(--accent-primary)' : 'none';
            });
            document.getElementById('modal-title').innerText = `${getLabel(editingCompType)} の設定`;
            audio.playClick();
        });
    });

    const compValueInput = document.getElementById('comp-value');
    const compValueSlider = document.getElementById('comp-value-slider');
    const compUnitSelect = document.getElementById('comp-unit-select');
    if (compUnitSelect) {
        compUnitSelect.addEventListener('change', () => {
            const presets = document.getElementById('comp-value-presets');
            const type = presets ? presets.dataset.type : null;
            if (type) renderValuePresets(type, compValueInput ? compValueInput.value : undefined);
        });
    }
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
            updateValuePresetHighlight(e.target.value);
            syncResistorColorCodeFromValue(e.target.value);
        });
        compValueInput.addEventListener('input', (e) => {
            compValueSlider.value = e.target.value;
            updatePresetSelect(e.target.value);
            updateValuePresetHighlight(e.target.value);
            syncResistorColorCodeFromValue(e.target.value);
        });
        if (bulbPresetsSelect) {
            bulbPresetsSelect.addEventListener('change', (e) => {
                compValueInput.value = e.target.value;
                compValueSlider.value = e.target.value;
            });
        }
    }

    [1, 2, 3, 4].forEach(index => {
        const select = document.getElementById(`resistor-band-${index}`);
        if (select) select.addEventListener('change', applyResistorColorCode);
    });

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
                panel.classList.add('show');
                updateResultsTable();
                audio.playChime(); 
            } else {
                panel.classList.remove('show');
                audio.playChimeOff();
                document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
            }
        });
    }
    document.getElementById('close-results-btn').addEventListener('click', () => {
        document.getElementById('results-panel').classList.remove('show');
        const resCheckbox = document.getElementById('results-toggle-checkbox');
        if (resCheckbox) resCheckbox.checked = false;
        document.querySelectorAll('.comp-highlight').forEach(el => el.remove());
    });

    // Modal
    document.getElementById('modal-cancel').onclick = () => {
        paramModal.style.display = 'none';
    };
    paramModal.onclick = (e) => { 
        if (Date.now() - modalLastOpened < 500) return; // タッチ/ダブルタップ時の誤動作防止
        if (e.target === paramModal && paramModal.style.display !== 'none') {
            paramModal.style.display = 'none'; 
        }
    };
    document.getElementById('modal-delete').onclick = () => {
        removeComponent(editingCompId);
        paramModal.style.display = 'none';
    };
    document.getElementById('modal-save').onclick = saveParams;
    paramModal.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return;
        if (!event.target.matches('input[type="number"]')) return;
        event.preventDefault();
        saveParams();
    });

    const acToggleBtn = document.getElementById('modal-ac-toggle');
    const extraGroup = document.getElementById('input-group-extra');
    const mainNumGroup = document.getElementById('input-group-number');
    if (acToggleBtn) {
        acToggleBtn.onclick = () => {
            const comp = components.find(c => c.id === editingCompId);
            if (!comp) return;

            const extraPanel = document.getElementById('input-group-extra');
            if (extraPanel) {
                const isHidden = extraPanel.style.display === 'none';
                extraPanel.style.display = isHidden ? 'block' : 'none';
                acToggleBtn.style.transform = isHidden ? 'rotateX(180deg)' : 'rotateX(0deg)';
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

    const meterToggleBtn = document.getElementById('modal-meter-details-toggle');
    const meterDetailsContent = document.getElementById('meter-details-content');
    if (meterToggleBtn && meterDetailsContent) {
        meterToggleBtn.onclick = () => {
            const isHidden = (meterDetailsContent.style.display === 'none');
            meterDetailsContent.style.display = isHidden ? 'block' : 'none';
            meterToggleBtn.style.transform = isHidden ? 'rotateX(180deg)' : 'rotateX(0deg)';
        };
    }

    // 縦長画面ではグラフを1つだけ表示するので、閉じるときは両方閉じる
    const isPortraitLayout = () => window.matchMedia('(orientation: portrait)').matches;
    const closeGraphPanel = (panelId, otherId) => {
        document.getElementById(panelId).classList.remove('show');
        if (isPortraitLayout()) document.getElementById(otherId).classList.remove('show');
        if (!document.getElementById(otherId).classList.contains('show')) selectedGraphCompIds = [];
        updateResultsTable();
    };
    document.getElementById('close-voltage-graph-btn').onclick = () => closeGraphPanel('voltage-graph-panel', 'current-graph-panel');
    document.getElementById('close-current-graph-btn').onclick = () => closeGraphPanel('current-graph-panel', 'voltage-graph-panel');

    // 縦長画面の電圧・電流切替
    const setGraphMode = (mode) => {
        const dock = document.getElementById('results-dock');
        if (!dock) return;
        dock.classList.toggle('graph-mode-v', mode === 'v');
        dock.classList.toggle('graph-mode-i', mode === 'i');
        document.querySelectorAll('.graph-mode-toggle button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.graphMode === mode);
            btn.setAttribute('aria-pressed', btn.dataset.graphMode === mode ? 'true' : 'false');
        });
        redrawGraphs();
    };
    document.querySelectorAll('.graph-mode-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
            setGraphMode(btn.dataset.graphMode);
            audio.playClick();
        });
    });
    setGraphMode('i');


    const setupDraggable = (headerId, panelId) => {
        const header = document.getElementById(headerId);
        const panel = document.getElementById(panelId);
        if (!header || !panel) return;

        // パネルをクリックしたら最前面へ
        panel.addEventListener('pointerdown', () => bringToFront(panel));

        let isDragging = false;
        let startX, startY, initX, initY;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'SPAN' || e.target.closest('button')) return;
            isDragging = true;
            undockPanel(panel);
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initX = rect.left; initY = rect.top;
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
        redrawGraphs();
    };
    document.getElementById('graph-i-range-slider').oninput = (e) => {
        graphRangeI = parseFloat(e.target.value);
        document.getElementById('graph-i-range-val').innerText = graphRangeI.toFixed(2) + 'A';
        redrawGraphs();
    };

    // Toolbar Settings
    const settingsBtn = document.getElementById('toolbar-settings-btn');
    const settingsPanel = document.getElementById('toolbar-settings-panel');
    const settingsBackdrop = document.getElementById('toolbar-settings-backdrop');
    const closeSettingsBtn = document.getElementById('close-toolbar-settings-btn');
    const visibilityList = document.getElementById('toolbar-visibility-list');

    if (settingsBtn && settingsPanel && settingsBackdrop) {
        settingsPanel.addEventListener('pointerdown', () => bringToFront(settingsPanel));

        // サウンドスイッチの連動
        const soundCheckbox = document.getElementById('sound-enable-checkbox');
        if (soundCheckbox) {
            soundCheckbox.onchange = (e) => { 
                audio.enabled = e.target.checked; 
                if (audio.enabled) audio.playChime();
                else audio.playChimeOff();
            };
        }

        const electronModeCheckbox = document.getElementById('electron-mode-checkbox');
        if (electronModeCheckbox) {
            electronModeCheckbox.onchange = (e) => {
                isElectronMode = e.target.checked;
                if (isElectronMode) audio.playChime();
                else audio.playChimeOff();
            };
        }

        settingsBtn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = !settingsPanel.classList.contains('show');
            settingsPanel.classList.toggle('show', isHidden);
            settingsBackdrop.style.display = isHidden ? 'block' : 'none';
            if (isHidden) {
                audio.playGearChime(); // 矩形波の出現音
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
            settingsPanel.classList.toggle('show', isHidden);
            settingsBackdrop.style.display = isHidden ? 'block' : 'none';
        };

        const closePanel = () => {
            settingsPanel.classList.remove('show');
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
        saveBtn.addEventListener('click', async () => {
            const data = buildCircuitData();
            const json = JSON.stringify(data, null, 2);

            // File System Access API が使える場合（PC版Chrome/Edgeなど）
            if ('showSaveFilePicker' in window) {
                try {
                    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
                    const handle = await window.showSaveFilePicker({
                        suggestedName: `circuit_${timestamp}.json`,
                        startIn: 'downloads',
                        types: [{
                            description: 'JSON Circuit File',
                            accept: {'application/json': ['.json']},
                        }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(json);
                    await writable.close();
                    if (messageArea) {
                        messageArea.innerText = "保存しました";
                        messageArea.style.color = "var(--accent-primary)";
                        setTimeout(() => { if (messageArea.innerText === "保存しました") messageArea.innerText = ""; }, 2000);
                    }
                    return;
                } catch (err) {
                    if (err.name === 'AbortError') return;
                    console.error("SavePicker Error:", err);
                    // エラー時やキャンセル時は従来の方法へフォールバック
                }
            }

            // 従来の方法（フォールバック）: 自動ダウンロード
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_');
            a.href = url;
            a.download = `circuit_${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
    }

    const copyLinkBtn = document.getElementById('copy-link-btn');
    if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => copyCircuitLink(copyLinkBtn));

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
                    const parsedData = JSON.parse(event.target.result);
                    applyCircuitData(validateCircuitFile(parsedData));
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
            openEdit(comp.id);
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
        const label = `${labelName} (${c.x},${c.y})`;
        if (tr.cells[0].innerText !== label) tr.cells[0].innerText = label;
        tr.cells[1].innerText = volt.toFixed(2);
        tr.cells[2].innerText = curr.toFixed(2);

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
            document.getElementById('voltage-graph-panel').classList.toggle('show', hasSelection);
            document.getElementById('current-graph-panel').classList.toggle('show', hasSelection);
            
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
    
    if (isSimulating) {
        audio.playGlocken3(); // 鉄琴の3連音
    } else {
        audio.playGlocken3Off(); // 下がる3連音
    }

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
        components.forEach(comp => {
            comp.pProgress = 0;
            if (comp.legProgress) {
                comp.legProgress = { left: 0, right: 0, top: 0, bottom: 0 };
            }
        });
        simulator.reset();
        activeNetlist = buildNetlist();
        updateGroundOffset(activeNetlist); // GND基準を初期化
        const res = applyGroundOffset(simulator.solve(activeNetlist, 1e-6));
        if (res.success) {
            simulationResults = res;
            if (messageArea) messageArea.innerText = '開始'; // 短くする
            
            // Show results panel based on setting
            const resCheckbox = document.getElementById('results-toggle-checkbox');
            document.getElementById('results-panel').classList.toggle('show', !!(resCheckbox && resCheckbox.checked));
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
        document.getElementById('results-panel').classList.remove('show');
        
        // グラフも閉じる
        document.getElementById('voltage-graph-panel').classList.remove('show');
        document.getElementById('current-graph-panel').classList.remove('show');
        selectedGraphCompIds = [];
        resetGraphHistory();
        
        stopAnimation();
        simulator.reset(); // Clear explicit charge/history
        render(); // clears glow
    }
}

function startDragging(e, type, isNew, compId = null) {
    // Determine rotation
    let rot = 0;
    let val = undefined;
    let ghostUnit = SELECTABLE_UNITS[type] ? SELECTABLE_UNITS[type].defaultUnit : (FIXED_UNITS[type] || '');
    if (compId) {
        const actual = components.find(c => c.id === compId);
        if (actual) {
            rot = actual.rotation;
            val = actual.value;
            ghostUnit = getCompUnit(actual);
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
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.textContent = `${val !== undefined ? val : ''}${ghostUnit}`;
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
                        audio.playPopLow(); // 少し低いポップ音
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
        capacitor: 1,
        inductor: 1,
        wire: 0,
        wire_l: 0,
        wire_t: 0,
        wire_cross: 0,
        switch: 0,
        voltmeter: 1e7,
        ammeter: 1e-3
    }[type];

    const initialComp = { id, type, x, y, rotation: 0, value: defaultValue };
    if (SELECTABLE_UNITS[type]) initialComp.unit = SELECTABLE_UNITS[type].defaultUnit;
    if (type === 'voltmeter') initialComp.range = 300;
    else if (type === 'ammeter') initialComp.range = 5;
    
    if (type === 'battery' || type === 'ac_source') {
        initialComp.rInt = 0.001;
    }
    initialComp.freq = 1.0;
    initialComp.phase = 90.0;
    initialComp.rInt = 0.001; // default rInt for sources
    
    components.push(initialComp);
    audio.playPopLow(); // 少し低いポップ音
    render();
}

function removeComponent(id) {
    components = components.filter(c => c.id !== id);
    forceStopSimulation();
    audio.playWhoosh(0.12); // 削除音を復活
    render();
}

function rotateComponent(id) {
    const comp = components.find(c => c.id === id);
    if (comp) {
        comp.rotation = (comp.rotation + 1) % 4;
        audio.playPop(); // 回転音を単発ポップ音に変更
        render();
    }
}

function openEdit(id) {
    modalLastOpened = Date.now();
    const comp = components.find(c => c.id === id);
    if (comp) {
        editingCompId = id;
        document.getElementById('modal-title').innerText = `${getLabel(comp.type)} の設定`;
        
        // すべての入力グループを一旦非表示にリセット
        const groups = [
            'input-group-number', 'input-group-switch', 'input-group-extra', 
            'bulb-presets-container', 'meter-range-container', 'meter-details-content', 
            'bulb-details-content', 'modal-ac-toggle', 'modal-bulb-details-toggle', 
            'modal-meter-details-toggle', 'input-group-wire-type', 'resistor-color-code'
        ];
        const extraPanel = document.getElementById('input-group-extra');
        groups.forEach(gid => {
            const el = document.getElementById(gid);
            if (el) el.style.display = 'none';
        });

        const isMeter = (comp.type === 'voltmeter' || comp.type === 'ammeter');
        const saveBtn = document.getElementById('modal-save');
        const acToggleBtn = document.getElementById('modal-ac-toggle');
        const bulbToggleBtn = document.getElementById('modal-bulb-details-toggle');
        const meterToggleBtn = document.getElementById('modal-meter-details-toggle');
        
        if (comp.type === 'switch') {
            document.getElementById('input-group-switch').style.display = 'block';
            document.getElementById('comp-switch-val').value = comp.value;
            if (saveBtn) saveBtn.style.display = 'block';
        } else if (comp.type.startsWith('wire')) {
            editingCompType = comp.type;
            editingCompRotation = comp.rotation || 0;
            
            // ハイライト表示用に回転角を正規化（0=0, 1=90, 2=180, 3=270）
            let displayRotation = editingCompRotation;
            if (comp.type === 'wire') {
                displayRotation = editingCompRotation % 2; // 180->0, 270->90
            } else if (comp.type === 'wire_cross') {
                displayRotation = 0; // 十字は常に0
            }

            const wireTypeGroup = document.getElementById('input-group-wire-type');
            if (wireTypeGroup) {
                wireTypeGroup.style.display = 'block';
                document.querySelectorAll('.wire-type-option').forEach(opt => {
                    const isMatch = (opt.dataset.type === comp.type && parseInt(opt.dataset.rotation) === displayRotation);
                    opt.style.borderColor = isMatch ? 'var(--accent-primary)' : 'transparent';
                    opt.style.backgroundColor = isMatch ? 'rgba(255,255,255,0.1)' : 'transparent';
                    opt.style.boxShadow = isMatch ? '0 0 10px var(--accent-primary)' : 'none';
                });
            }
            if (saveBtn) saveBtn.style.display = 'block';
        } else {
            document.getElementById('input-group-number').style.display = 'block';
            document.getElementById('comp-value').value = comp.value;
            const unit = (comp.type === 'voltmeter' || comp.type === 'ammeter') ? 'Ω' : getCompUnit(comp);
            const valLabel = { battery: '起電力', ac_source: '振幅(V)', resistor: '抵抗値', bulb: '抵抗値', capacitor: '電気容量', inductor: '自己インダクタンス', voltmeter: '内部抵抗', ammeter: '内部抵抗' }[comp.type] || '値';
            document.getElementById('comp-value-label').innerText = valLabel;
            document.getElementById('comp-unit').innerText = unit;
            const unitSelect = document.getElementById('comp-unit-select');
            const unitConfig = SELECTABLE_UNITS[comp.type];
            if (unitSelect) {
                unitSelect.innerHTML = '';
                if (unitConfig) {
                    unitConfig.options.forEach(option => {
                        const opt = document.createElement('option');
                        opt.value = option;
                        opt.textContent = option;
                        unitSelect.appendChild(opt);
                    });
                    unitSelect.value = unit;
                }
                unitSelect.style.display = unitConfig ? '' : 'none';
                document.getElementById('comp-unit').style.display = unitConfig ? 'none' : '';
            }

            // 電球用のプリセットプルダウン制御
            const bulbPresetsContainer = document.getElementById('bulb-presets-container');
            const bulbPresetsSelect = document.getElementById('bulb-presets-select');
            const bulbDetailsContent = document.getElementById('bulb-details-content');
            
            if (bulbPresetsContainer && bulbPresetsSelect) {
                if (comp.type === 'bulb') {
                    bulbPresetsContainer.style.display = 'block';
                    if (bulbDetailsContent) bulbDetailsContent.style.display = 'none';

                    // 現在の値に合わせてプルダウンを初期化
                    const valStr = comp.value.toString();
                    const options = Array.from(bulbPresetsSelect.options).map(o => o.value);
                    if (options.includes(valStr)) {
                        bulbPresetsSelect.value = valStr;
                    }
                } else {
                    bulbPresetsContainer.style.display = 'none';
                    if (bulbDetailsContent) bulbDetailsContent.style.display = 'block';

                }
            }

            // スライダーの設定
            const slider = document.getElementById('comp-value-slider');
            if (slider) {
                slider.style.display = isMeter ? 'none' : 'block';
                
                if (isMeter) {
                    document.getElementById('input-group-number').style.display = 'block';
                    const bulbDetailsContent = document.getElementById('bulb-details-content');
                    if (bulbDetailsContent) bulbDetailsContent.style.display = 'none';
                    if (saveBtn) saveBtn.style.display = 'block';
                    
                    const rangeContainer = document.getElementById('meter-range-container');
                    const vRangeDiv = document.getElementById('voltmeter-ranges');
                    const aRangeDiv = document.getElementById('ammeter-ranges');
                    if (rangeContainer) {
                        rangeContainer.style.display = 'block';
                        const isV = (comp.type === 'voltmeter');
                        vRangeDiv.style.display = isV ? 'flex' : 'none';
                        aRangeDiv.style.display = isV ? 'none' : 'flex';
                        
                        const currentRange = parseFloat(comp.range || (isV ? 300 : 5));
                        const name = isV ? 'v-range' : 'a-range';
                        const radios = document.getElementsByName(name);
                        for (const r of radios) {
                            if (parseFloat(r.value) === currentRange) {
                                r.checked = true;
                            }
                        }
                    }

                    const meterDetailsContent = document.getElementById('meter-details-content');
                    if (meterDetailsContent) {
                        meterDetailsContent.style.display = 'none';
                        document.getElementById('meter-rint').value = comp.value;
                    }
                } else {
                    if (saveBtn) saveBtn.style.display = 'block';
                    const rangeContainer = document.getElementById('meter-range-container');
                    if (rangeContainer) rangeContainer.style.display = 'none';
                }
                
                if (!isMeter) {
                    let min = 0, max = 100, step = 1;
                    if (comp.type === 'battery' || comp.type === 'ac_source') { min = 0.1; max = 50; step = 0.1; }
                    else if (comp.type === 'capacitor' || comp.type === 'inductor') { min = 1; max = 1000; step = 1; }
                    else if (comp.type === 'resistor') { min = 1; max = 1000; step = 1; }
                    else if (comp.type === 'bulb') { min = 1; max = 120; step = 1; }
                    
                    slider.min = min;
                    slider.max = max;
                    slider.step = step;
                    slider.value = comp.value;
                }
            }
            renderValuePresets(comp.type, comp.value);
            renderResistorColorCode(comp);

            const acFields = document.getElementById('extra-ac-only');
            const rIntFields = document.getElementById('extra-rint-only');
            const isBattery = (comp.type === 'battery');
            const isAC = (comp.type === 'ac_source');

            // 全トグルボタンを一旦隠す
            if (acToggleBtn) acToggleBtn.style.display = 'none';
            if (bulbToggleBtn) bulbToggleBtn.style.display = 'none';
            if (meterToggleBtn) meterToggleBtn.style.display = 'none';

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
            } else if (comp.type === 'bulb') {
                if (bulbToggleBtn) {
                    bulbToggleBtn.style.display = 'block';
                    bulbToggleBtn.style.transform = 'rotateX(0deg)';
                }
            } else if (isMeter) {
                if (meterToggleBtn) {
                    meterToggleBtn.style.display = 'block';
                    meterToggleBtn.style.transform = 'rotateX(0deg)';
                }
            }
            
            if (extraPanel && !isBattery && !isAC) extraPanel.style.display = 'none';
        }
        const bgType = comp.type.startsWith('wire') ? 'wire' : comp.type;
        document.querySelector('#param-modal .modal-content').style.backgroundColor = `var(--bg-${bgType}, var(--panel-bg))`;
        paramModal.style.display = 'flex';
        audio.playPopHigh(); // 高めのポップ音
    }
}

function saveParams() {
    const comp = components.find(c => c.id === editingCompId);
    let topologyChanged = false; // 導線の形状や回転が変更されたか

    if (comp) {
        if (comp.type === 'switch') {
            comp.value = parseInt(document.getElementById('comp-switch-val').value);
        } else if (comp.type.startsWith('wire')) {
            if (comp.type !== editingCompType || comp.rotation !== editingCompRotation) {
                topologyChanged = true;
            }
            comp.type = editingCompType;
            comp.rotation = editingCompRotation;
            comp.value = 0; // Wires have 0 value
        } else if (comp.type === 'voltmeter') {
            const radios = document.getElementsByName('v-range');
            for (const r of radios) {
                if (r.checked) comp.range = parseFloat(r.value);
            }
            comp.value = parseFloat(document.getElementById('meter-rint').value) || 0;
        } else if (comp.type === 'ammeter') {
            const radios = document.getElementsByName('a-range');
            for (const r of radios) {
                if (r.checked) comp.range = parseFloat(r.value);
            }
            comp.value = parseFloat(document.getElementById('meter-rint').value) || 0;
        } else {
            comp.value = Math.max(0, parseFloat(document.getElementById('comp-value').value) || 0);
            if (SELECTABLE_UNITS[comp.type]) comp.unit = getEditorUnit(comp.type);
            if (comp.type === 'resistor') {
                const bands = getSelectedResistorColorBands();
                if (bands.length === 4) comp.resistorColorBands = bands;
            }
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
        if (topologyChanged) {
            toggleSimulation(); // 導線の形状が変わった場合はシミュレーションを停止
        } else {
            activeNetlist = buildNetlist(); // それ以外は解析を継続
        }
    }
    render();
}

function getLabel(type) {
    return { battery: '電池', ac_source: '交流電源', resistor: '抵抗', bulb: '電球', capacitor: 'コンデンサー', inductor: 'コイル', wire: '導線ー', wire_l: '導線L', wire_t: '導線T', wire_cross: '導線＋', switch: 'スイッチ', voltmeter: '電圧計', ammeter: '電流計' }[type];
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
        wrapper.addEventListener('mouseleave', hideTooltip);
        
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
                    const rawVolt = (simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0);
                    const absVolt = Math.abs(rawVolt);
                    const maxV = comp.range || 300;
                    displayValueText = (absVolt > maxV) ? "XXX" : `${rawVolt.toFixed(2)}V`;
                } else if (comp.type === 'ammeter') {
                    const rawCurr = simulationResults.currents[comp.id] || 0;
                    const absCurr = Math.abs(rawCurr);
                    const maxA = comp.range || 5;
                    displayValueText = (absCurr > maxA) ? "XXX" : `${rawCurr.toFixed(2)}A`;
                }
            } else {
                const unit = { voltmeter: 'V', ammeter: 'A' }[comp.type] || getCompUnit(comp);
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
                if (comp.value === 1) audio.playSwitchKachi(); // ON: 高い「カチッ」
                else audio.playSwitchKachiOff(); // OFF: 低い「カチッ」
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

const timeScaleSlider = document.getElementById('time-scale-slider');
const timeScaleVal = document.getElementById('time-scale-val');

function updateTimeScaleDisplay() {
    const val = parseFloat(timeScaleSlider.value);
    timeScale = val;
    // 停止(0x)のときは直前の幅を保つ
    if (val > 0) {
        graphTimeWindow = val * GRAPH_REAL_TIME_WINDOW;
        redrawGraphs();
    }
    if (timeScaleVal) {
        timeScaleVal.innerText = val.toFixed(2) + 'x';
        const min = parseFloat(timeScaleSlider.min);
        const max = parseFloat(timeScaleSlider.max);
        const percent = (val - min) / (max - min);
        // つまみの幅(34px)の半分(17px)を基準に、可動範囲内で計算
        timeScaleVal.style.left = `calc(17px + ${percent} * (100% - 34px))`;
    }
}

timeScaleSlider.addEventListener('input', updateTimeScaleDisplay);
updateTimeScaleDisplay();

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
            const res = applyGroundOffset(simulator.solve(activeNetlist, dt));
            if (res.success) {
                simulationResults = res;
                updateDynamicUI(dt);
                simulator3D.update(components, simulationResults);
            }
        }
        
        // Particles move continuously by integrating speed
        components.forEach(comp => {
            if (comp.type === 'wire_cross') {
                if (!comp.legProgress) comp.legProgress = { left:0, right:0, top:0, bottom:0 };
                const iLeft = simulationResults ? (simulationResults.currents[comp.id + '_L'] || 0) : 0;
                const iRight = simulationResults ? (simulationResults.currents[comp.id + '_R'] || 0) : 0;
                const iTop = simulationResults ? (simulationResults.currents[comp.id + '_T'] || 0) : 0;
                const iBottom = simulationResults ? (simulationResults.currents[comp.id + '_B'] || 0) : 0;

                const updateLeg = (speed, side) => {
                    const actualSpeed = isElectronMode ? -speed : speed;
                    comp.legProgress[side] += actualSpeed * dt;
                    if (comp.legProgress[side] >= 1) comp.legProgress[side] %= 1;
                    if (comp.legProgress[side] < 0) comp.legProgress[side] = 1 - (Math.abs(comp.legProgress[side]) % 1);
                };

                updateLeg(iLeft * 30, 'left');
                updateLeg(iRight * 30, 'right');
                updateLeg(iTop * 30, 'top');
                updateLeg(iBottom * 30, 'bottom');
            } else if (comp.type === 'wire_t') {
                if (!comp.legProgress) comp.legProgress = { left:0, right:0, top:0, bottom:0 };
                const i1 = simulationResults ? (simulationResults.currents[comp.id + '_1'] || 0) : 0;
                const i2 = simulationResults ? (simulationResults.currents[comp.id + '_2'] || 0) : 0;
                const i3 = simulationResults ? (simulationResults.currents[comp.id + '_3'] || 0) : 0;
                
                let iLeft = 0, iRight = 0, iTop = 0, iBottom = 0;
                if (comp.rotation === 0) { iLeft = i1; iRight = i2; iBottom = i3; }
                else if (comp.rotation === 1) { iTop = i1; iBottom = i2; iLeft = i3; }
                else if (comp.rotation === 2) { iLeft = i1; iRight = i2; iTop = i3; }
                else { iTop = i1; iBottom = i2; iRight = i3; }

                const updateLeg = (speed, side) => {
                    const actualSpeed = isElectronMode ? -speed : speed;
                    comp.legProgress[side] += actualSpeed * dt;
                    if (comp.legProgress[side] >= 1) comp.legProgress[side] %= 1;
                    if (comp.legProgress[side] < 0) comp.legProgress[side] = 1 - (Math.abs(comp.legProgress[side]) % 1);
                };

                updateLeg(iLeft * 30, 'left');
                updateLeg(iRight * 30, 'right');
                updateLeg(iTop * 30, 'top');
                updateLeg(iBottom * 30, 'bottom');
            } else if (comp.type === 'wire_l') {
                if (!comp.legProgress) comp.legProgress = { left:0, right:0, top:0, bottom:0 };
                const updateLeg = (speed, side) => {
                    const actualSpeed = isElectronMode ? -speed : speed;
                    comp.legProgress[side] += actualSpeed * dt;
                    if (comp.legProgress[side] >= 1) comp.legProgress[side] %= 1;
                    if (comp.legProgress[side] < 0) comp.legProgress[side] = 1 - (Math.abs(comp.legProgress[side]) % 1);
                };
                if (comp.rotation === 0) {
                    updateLeg((simulationResults.currents[comp.id + '_T'] || 0) * 30, 'top');
                    updateLeg((simulationResults.currents[comp.id + '_R'] || 0) * 30, 'right');
                } else if (comp.rotation === 1) {
                    updateLeg((simulationResults.currents[comp.id + '_R'] || 0) * 30, 'right');
                    updateLeg((simulationResults.currents[comp.id + '_B'] || 0) * 30, 'bottom');
                } else if (comp.rotation === 2) {
                    updateLeg((simulationResults.currents[comp.id + '_B'] || 0) * 30, 'bottom');
                    updateLeg((simulationResults.currents[comp.id + '_L'] || 0) * 30, 'left');
                } else {
                    updateLeg((simulationResults.currents[comp.id + '_L'] || 0) * 30, 'left');
                    updateLeg((simulationResults.currents[comp.id + '_T'] || 0) * 30, 'top');
                }
            } else {
                let i = simulationResults ? (simulationResults.currents[comp.id] || 0) : 0;
                if (!comp.hasOwnProperty('pProgress')) comp.pProgress = 0;
                const speed = i * 15;
                const actualSpeed = isElectronMode ? -speed : speed;
                comp.pProgress += (actualSpeed * dt); // Include timeScale naturally via dt
                
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
        const needle = document.getElementById(`needle-${comp.id}`);
        
        if ((txt || needle) && simulationResults && simulationResults.success) {
            if (comp.type === 'voltmeter') {
                const { n1, n2 } = getCompNodeNames(comp);
                const rawVolt = (simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0);
                const absVolt = Math.abs(rawVolt);
                const maxV = comp.range || 300;
                
                if (txt) txt.textContent = (absVolt > maxV) ? "XXX" : `${rawVolt.toFixed(2)}V`;
                if (needle) {
                    const ratio = Math.max(Math.min(rawVolt / maxV, 1.1), -0.1);
                    const angle = -50 + ratio * 100;
                    needle.setAttribute('transform', `translate(0, 5) rotate(${angle})`);
                }
            } else if (comp.type === 'ammeter') {
                const rawCurr = simulationResults.currents[comp.id] || 0;
                const absCurr = Math.abs(rawCurr);
                const maxA = comp.range || 5;
                
                if (txt) txt.textContent = (absCurr > maxA) ? "XXX" : `${rawCurr.toFixed(2)}A`;
                if (needle) {
                    const ratio = Math.max(Math.min(rawCurr / maxA, 1.1), -0.1);
                    const angle = -50 + ratio * 100;
                    needle.setAttribute('transform', `translate(0, 6) rotate(${angle})`);
                }
            }
        }
    });
    // Update Results Table
    if (document.getElementById('results-panel').classList.contains('show')) {
        updateResultsTable();
    }

    // Record Graph Data based on simulation time
    if (simulationResults && simulationResults.success) {
        graphSimTime += currentDt;
        graphAccumulatedTime += currentDt;
        if (graphAccumulatedTime >= graphSampleInterval) {
            const entry = { t: graphSimTime, voltages: {}, currents: {} };
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
            const oldestTime = graphSimTime - maxGraphHistoryTime;
            let dropCount = 0;
            while (dropCount < globalGraphHistory.length - 1 && globalGraphHistory[dropCount + 1].t <= oldestTime) dropCount++;
            if (dropCount > 0) globalGraphHistory.splice(0, dropCount);


            
            document.getElementById('graph-v-range-val').innerText = graphRangeV.toFixed(1) + 'V';
            document.getElementById('graph-i-range-val').innerText = graphRangeI.toFixed(2) + 'A';
            
            redrawGraphs();
            
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
        const iVal = iNum !== null ? iNum.toFixed(2) + 'A' : '--';

        vLegend.appendChild(createItem(color, sameTypeCount, vVal));
        iLegend.appendChild(createItem(color, sameTypeCount, iVal));
    });
}

function resetGraphHistory() {
    globalGraphHistory = [];
    graphSimTime = 0;
    graphAccumulatedTime = 0;
}

function redrawGraphs() {
    drawGraph('voltage-graph-canvas', 'v', graphRangeV);
    drawGraph('current-graph-canvas', 'i', graphRangeI);
}

// 横軸の目盛り間隔（1, 2, 5 × 10^n）を、表示幅に4〜5本入るように選ぶ
function getNiceTimeStep(windowSec) {
    const rough = windowSec / 4;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / pow;
    const nice = n >= 5 ? 5 : n >= 2 ? 2 : 1;
    return nice * pow;
}

function formatTimeLabel(t, step) {
    const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
    return `${t.toFixed(decimals)}s`;
}

function drawGraph(canvasId, prop, maxVal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 高解像度（Retina）対応
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // 表示サイズに合わせて描画バッファを調整
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
    }
    
    const w = canvas.width;
    const h = canvas.height;

    ctx.save(); // 状態を保存
    ctx.scale(dpr, dpr);
    const sw = rect.width;
    const sh = rect.height;

    ctx.clearRect(0, 0, sw, sh);
    ctx.setLineDash([]); 

    // Grid lines & Labels
    const isDark = appConfig.darkMode;
    ctx.lineWidth = 1;
    ctx.font = '500 10px "Roboto Mono", monospace'; // 少し小さめでウェイトを上げる
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const unit = prop === 'v' ? 'V' : 'A';
    const lines = [0.1, 0.3, 0.5, 0.7, 0.9];
    const vals = [maxVal, maxVal * 0.5, 0, -maxVal * 0.5, -maxVal];

    lines.forEach((ratio, i) => {
        const y = sh * ratio;
        
        // グリッド線
        ctx.strokeStyle = (ratio === 0.5) ? 
            (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)') : 
            (isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.03)');
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(sw, y);
        ctx.stroke();

        // ラベル（数値）
        const label = vals[i].toFixed(prop === 'v' ? 1 : 2) + unit;
        
        // 数値の視認性を上げるための微細な背景
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = isDark ? 'rgba(30, 30, 30, 0.5)' : 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(2, y - 10, labelWidth + 4, 12);
        
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
        ctx.fillText(label, 4, y - 4);
    });

    // 横軸（時間）: 開始直後は左端が 0 s、表示幅を超えたら右端が現在時刻になるようスクロール
    const tEnd = Math.max(graphTimeWindow, graphSimTime);
    const tStart = tEnd - graphTimeWindow;
    const timeToX = (t) => ((t - tStart) / graphTimeWindow) * sw;
    const timeStep = getNiceTimeStep(graphTimeWindow);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let k = Math.ceil(tStart / timeStep - 1e-9); k * timeStep <= tEnd + 1e-9; k++) {
        const t = k * timeStep;
        const x = timeToX(t);
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x, sh);
        ctx.stroke();

        const label = formatTimeLabel(t, timeStep);
        const labelWidth = ctx.measureText(label).width;
        const lx = Math.min(Math.max(x, labelWidth / 2 + 2), sw - labelWidth / 2 - 2);
        ctx.fillStyle = isDark ? 'rgba(30, 30, 30, 0.5)' : 'rgba(255, 255, 255, 0.6)';
        ctx.fillRect(lx - labelWidth / 2 - 2, sh - 13, labelWidth + 4, 12);
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)';
        ctx.fillText(label, lx, sh - 2);
    }

    // 表示範囲内の記録だけを、横幅の画素数程度に間引いて描く
    let firstIdx = 0;
    while (firstIdx < globalGraphHistory.length - 1 && globalGraphHistory[firstIdx + 1].t < tStart) firstIdx++;
    const visibleCount = globalGraphHistory.length - firstIdx;
    const stride = Math.max(1, Math.floor(visibleCount / Math.max(1, sw)));

    // Draw all traces
    selectedGraphCompIds.forEach((compId, traceIdx) => {
        if (globalGraphHistory.length < 2) return;

        const comp = components.find(c => c.id === compId);
        if (!comp) return;

        ctx.beginPath();
        const color = compColors[comp.type] || '#888';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5; // 少し細くしてシャープに
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // 点線の設定などは維持
        let sameTypeCount = 0;
        for (let i = 0; i < traceIdx; i++) {
            const prevComp = components.find(c => c.id === selectedGraphCompIds[i]);
            if (prevComp && prevComp.type === comp.type) sameTypeCount++;
        }
        
        if (sameTypeCount === 1) ctx.setLineDash([8, 4]);
        else if (sameTypeCount === 2) ctx.setLineDash([2, 3]);
        else if (sameTypeCount >= 3) ctx.setLineDash([12, 3, 3, 3]);
        else ctx.setLineDash([]);
        
        const dataKey = (prop === 'v') ? 'voltages' : 'currents';
        
        let started = false;
        for (let idx = firstIdx; idx < globalGraphHistory.length; idx += (idx + stride < globalGraphHistory.length - 1 ? stride : 1)) {
            const x = timeToX(globalGraphHistory[idx].t);
            let val = globalGraphHistory[idx][dataKey][compId];
            if (val === undefined) continue;

            if (showAbsoluteValues && (comp.type === 'resistor' || comp.type === 'bulb' || comp.type === 'capacitor' || comp.type === 'inductor')) {
                val = Math.abs(val);
            }

            const y = sh/2 - (val / maxVal) * (sh * 0.4); 
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    });
    ctx.restore(); // 状態を復元
}

function renderParticles() {
    const layer = document.getElementById('interaction-layer');
    layer.innerHTML = '';
    
    if (!simulationResults) return;

    const scale = CELL_SIZE / 60; // 基本サイズ60に対するスケール

    const showParticlesCheckbox = document.getElementById('show-particles-checkbox');
    if (showParticlesCheckbox && !showParticlesCheckbox.checked) return;

    components.forEach(comp => {
        if (comp.type === 'wire_cross') {
            const iLeft = simulationResults.currents[comp.id + '_L'] || 0;
            const iRight = simulationResults.currents[comp.id + '_R'] || 0;
            const iTop = simulationResults.currents[comp.id + '_T'] || 0;
            const iBottom = simulationResults.currents[comp.id + '_B'] || 0;
            
            const drawLeg = (i, side) => {
                const numParticles = 2; 
                for (let p = 0; p < numParticles; p++) {
                    const normProg = (comp.legProgress[side] + p / numParticles) % 1;
                    const r = Math.max(1.5, CELL_SIZE * 0.045);
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
                    const color = isElectronMode ? '#5c5cff' : '#ff1493';
                    circle.setAttribute('fill', color);
                    circle.setAttribute('opacity', '1');
                    circle.setAttribute('filter', `drop-shadow(0 0 ${r}px ${color})`);
                    layer.appendChild(circle);
                }
            };
            drawLeg(iLeft, 'left');
            drawLeg(iRight, 'right');
            drawLeg(iTop, 'top');
            drawLeg(iBottom, 'bottom');
            return;
        } else if (comp.type === 'wire_t') {
            const i1 = simulationResults.currents[comp.id + '_1'] || 0;
            const i2 = simulationResults.currents[comp.id + '_2'] || 0;
            const i3 = simulationResults.currents[comp.id + '_3'] || 0;
            
            const drawLeg = (i, side) => {
                const numParticles = 2; 
                for (let p = 0; p < numParticles; p++) {
                    const normProg = (comp.legProgress[side] + p / numParticles) % 1;
                    const r = Math.max(1.5, CELL_SIZE * 0.045);
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
                    const color = isElectronMode ? '#5c5cff' : '#ff1493';
                    circle.setAttribute('fill', color);
                    circle.setAttribute('opacity', '1');
                    circle.setAttribute('filter', `drop-shadow(0 0 ${r}px ${color})`);
                    layer.appendChild(circle);
                }
            };
            if (comp.rotation === 0) { drawLeg(i1, 'left'); drawLeg(i2, 'right'); drawLeg(i3, 'bottom'); }
            else if (comp.rotation === 1) { drawLeg(i1, 'top'); drawLeg(i2, 'bottom'); drawLeg(i3, 'left'); }
            else if (comp.rotation === 2) { drawLeg(i1, 'left'); drawLeg(i2, 'right'); drawLeg(i3, 'top'); }
            else { drawLeg(i1, 'top'); drawLeg(i2, 'bottom'); drawLeg(i3, 'right'); }
            return;
        } else if (comp.type === 'wire_l') {
            const drawLeg = (side) => {
                const numParticles = 2; 
                for (let p = 0; p < numParticles; p++) {
                    const normProg = (comp.legProgress[side] + p / numParticles) % 1;
                    const r = Math.max(1.5, CELL_SIZE * 0.045);
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
                    const color = isElectronMode ? '#5c5cff' : '#ff1493';
                    circle.setAttribute('fill', color);
                    circle.setAttribute('opacity', '1');
                    circle.setAttribute('filter', `drop-shadow(0 0 ${r}px ${color})`);
                    layer.appendChild(circle);
                }
            };
            if (comp.rotation === 0) { drawLeg('top'); drawLeg('right'); }
            else if (comp.rotation === 1) { drawLeg('right'); drawLeg('bottom'); }
            else if (comp.rotation === 2) { drawLeg('bottom'); drawLeg('left'); }
            else { drawLeg('left'); drawLeg('top'); }
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

            const r = Math.max(1.5, CELL_SIZE * 0.045);
            const half = CELL_SIZE / 2;
            const cx = comp.x * CELL_SIZE + half;
            const cy = comp.y * CELL_SIZE + half;
            
            const drawCapParticle = (lx, ly, color = '#ff1493', opacity = 1) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', cx + lx);
                circle.setAttribute('cy', cy + ly);
                circle.setAttribute('r', r);
                circle.setAttribute('fill', color);
                circle.setAttribute('opacity', opacity);
                circle.setAttribute('filter', `drop-shadow(0 0 ${r}px ${color})`);
                layer.appendChild(circle);
            };

            // 1. Draw Stored Static Charges
            const rawNum = Math.abs(plateDiff) * 8;
            const numStatic = Math.min(Math.ceil(rawNum), 40);
            if (numStatic > 0) {
                const isNeg3Positive = plateDiff > 0;
                let splx = 0, sply = 0, snlx = 0, snly = 0;
                for (let s = 0; s < numStatic; s++) {
                    const hash1 = Math.abs(Math.sin(s * 12.9898 + comp.x * 78.233 + comp.y) * 43758.5453);
                    const hash2 = Math.abs(Math.sin(s * 78.233 + comp.x * 12.9898 + comp.y * 3) * 43758.5453);
                    const rand1 = hash1 - Math.floor(hash1);
                    const rand2 = hash2 - Math.floor(hash2);
                    
                    // すべての値に scale を適用
                    const rY = (-17 + rand1 * 34) * scale;
                    const rX = (-2 + rand2 * 4) * scale;
                    const posPlateOffset = (isNeg3Positive ? -5.5 : 5.5) * scale;
                    const negPlateOffset = (isNeg3Positive ? 5.5 : -5.5) * scale;
                    
                    if (comp.rotation === 0 || comp.rotation === 2) {
                        splx = posPlateOffset + rX; sply = rY;
                        snlx = negPlateOffset + rX; snly = rY;
                    } else {
                        sply = posPlateOffset + rX; splx = rY;
                        snly = negPlateOffset + rX; snlx = rY;
                    }

                    // 少数部分を使って滑らかにフェードインさせる
                    const opacity = Math.min(Math.max(rawNum - s, 0), 1);

                    // 正極側の電荷（濃いピンク）
                    drawCapParticle(splx, sply, '#ff1493', opacity);
                    // 負極側の電荷（青紫色）
                    drawCapParticle(snlx, snly, '#5c5cff', opacity);
                }
            }

            // 2. Draw Moving Charges
            const numCapParticles = 2;
            for (let p = 0; p < numCapParticles; p++) {
                const progress = (comp.pProgress + p / numCapParticles) % 1;
                const half = CELL_SIZE / 2;
                const gap = 6 * scale; // 60px基準で6px
                const travel = half - gap;
                
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
                const mColor = isElectronMode ? '#5c5cff' : '#ff1493';
                drawCapParticle(lx1, ly1, mColor);
                drawCapParticle(lx2, ly2, mColor);
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
                const r = Math.max(1.5, CELL_SIZE * 0.045);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', pos.x);
                circle.setAttribute('cy', pos.y);
                circle.setAttribute('r', r);
                const color = isElectronMode ? '#5c5cff' : '#ff1493';
                circle.setAttribute('fill', color);
                circle.setAttribute('opacity', '1');
                circle.setAttribute('filter', `drop-shadow(0 0 ${r}px ${color})`);
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
            if (showIllustrations) {
                const acId = comp.id || 'ghost';
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                
                // 筐体のグラデーション
                const gradBody = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradBody.setAttribute('id', `grad-ac-body-${acId}`);
                gradBody.setAttribute('x1', '0%'); gradBody.setAttribute('y1', '0%');
                gradBody.setAttribute('x2', '0%'); gradBody.setAttribute('y2', '100%');
                gradBody.innerHTML = `
                    <stop offset="0%" style="stop-color:#4a5568;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#2d3748;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#1a202c;stop-opacity:1" />
                `;
                
                // ディスプレイのグラデーション
                const gradScreen = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradScreen.setAttribute('id', `grad-ac-screen-${acId}`);
                gradScreen.setAttribute('x1', '0%'); gradScreen.setAttribute('y1', '0%');
                gradScreen.setAttribute('x2', '0%'); gradScreen.setAttribute('y2', '100%');
                gradScreen.innerHTML = `
                    <stop offset="0%" style="stop-color:#0f172a;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
                `;
                
                defs.appendChild(gradBody);
                defs.appendChild(gradScreen);
                g.appendChild(defs);

                // 本体筐体
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', -24); body.setAttribute('y', -18);
                body.setAttribute('width', 48); body.setAttribute('height', 36);
                body.setAttribute('rx', 3);
                body.setAttribute('fill', `url(#grad-ac-body-${acId})`);
                body.setAttribute('stroke', 'none');
                g.appendChild(body);
                
                // 液晶ディスプレイ
                const screen = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                screen.setAttribute('x', -18); screen.setAttribute('y', -12);
                screen.setAttribute('width', 36); screen.setAttribute('height', 16);
                screen.setAttribute('rx', 1);
                screen.setAttribute('fill', `url(#grad-ac-screen-${acId})`);
                screen.setAttribute('stroke', '#334155');
                g.appendChild(screen);
                
                // サイン波 (ディスプレイ内)
                const screenWave = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                screenWave.setAttribute('d', 'M -14,-4 C -14,-10 -7,-10 -7,-4 C -7,2 0,2 0,-4 C 0,-10 7,-10 7,-4 C 7,2 14,2 14,-4');
                screenWave.setAttribute('stroke', '#38bdf8'); // 鮮やかなシアン
                screenWave.setAttribute('stroke-width', '1.5');
                screenWave.setAttribute('fill', 'none');
                screenWave.setAttribute('stroke-linecap', 'round');
                g.appendChild(screenWave);
                
                // 操作ノブ (2個)
                [-10, 10].forEach(kx => {
                    const knob = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    knob.setAttribute('cx', kx); knob.setAttribute('cy', 10); knob.setAttribute('r', 4);
                    knob.setAttribute('fill', '#94a3b8');
                    knob.setAttribute('stroke', '#475569');
                    knob.setAttribute('stroke-width', '1');
                    g.appendChild(knob);
                    
                    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    marker.setAttribute('x1', kx); marker.setAttribute('y1', 10);
                    marker.setAttribute('x2', kx + 2); marker.setAttribute('y2', 10 - 2);
                    marker.setAttribute('stroke', '#1e293b');
                    marker.setAttribute('stroke-width', '1');
                    g.appendChild(marker);
                });

                path.setAttribute('d', 'M -30,0 L -24,0 M 24,0 L 30,0');
                g.appendChild(path);
            } else {
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
            }
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
                const toleranceColor = Array.isArray(comp.resistorColorBands) ? comp.resistorColorBands[3] : undefined;
                const resColors = getResistorColorBands(resValue, toleranceColor);
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
        case 'wire_cross':
            path.setAttribute('d', 'M -30,0 L 30,0 M 0,-30 L 0,30');
            const crossDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            crossDot.setAttribute('cx', 0); crossDot.setAttribute('cy', 0); crossDot.setAttribute('r', 3.5); crossDot.setAttribute('fill', color);
            g.appendChild(path);
            g.appendChild(crossDot);
            break;
        case 'wire_t':
            path.setAttribute('d', 'M -30,0 L 30,0 M 0,0 L 0,30');
            const tDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            tDot.setAttribute('cx', 0); tDot.setAttribute('cy', 0); tDot.setAttribute('r', 3.5); tDot.setAttribute('fill', color);
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
        case 'capacitor': {
                if (showIllustrations) {
                    const gradId = `grad-cap-metal-${comp.id}`;
                    if (!document.getElementById(gradId)) {
                        const defs = document.getElementById('grid-svg').querySelector('defs') || 
                                     document.getElementById('grid-svg').appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
                        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                        grad.setAttribute('id', gradId);
                        grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
                        grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
                        const stops = [
                            { offset: '0%', color: '#ced4da' },
                            { offset: '50%', color: '#e2e8f0' },
                            { offset: '100%', color: '#adb5bd' }
                        ];
                        stops.forEach(s => {
                            const stop = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                            stop.setAttribute('offset', s.offset);
                            stop.setAttribute('stop-color', s.color);
                            grad.appendChild(stop);
                        });
                        defs.appendChild(grad);
                    }

                    // Plate 1
                    const plate1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    plate1.setAttribute('x', -8); plate1.setAttribute('y', -18);
                    plate1.setAttribute('width', '5'); plate1.setAttribute('height', '36');
                    plate1.setAttribute('fill', `url(#${gradId})`);
                    plate1.setAttribute('stroke', '#cbd5e1');
                    plate1.setAttribute('stroke-width', '1');
                    plate1.setAttribute('rx', '1');
                    
                    // Plate 2
                    const plate2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    plate2.setAttribute('x', 3); plate2.setAttribute('y', -18);
                    plate2.setAttribute('width', '5'); plate2.setAttribute('height', '36');
                    plate2.setAttribute('fill', `url(#${gradId})`);
                    plate2.setAttribute('stroke', '#cbd5e1');
                    plate2.setAttribute('stroke-width', '1');
                    plate2.setAttribute('rx', '1');
                    
                    path.setAttribute('d', 'M -30,0 L -8,0 M 8,0 L 30,0');
                    path.setAttribute('stroke-linecap', 'round');
                    
                    g.appendChild(plate1);
                    g.appendChild(plate2);
                    g.appendChild(path);
                } else {
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
                }
                addPassivePolarity(g, color);
            }
            break;
        case 'inductor': {
            if (showIllustrations) {
                const indId = comp.id || 'ghost';
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                
                // 芯材（コア）のグラデーション: 円柱状のハイライトを追加
                const gradCore = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradCore.setAttribute('id', `grad-ind-core-${indId}`);
                gradCore.setAttribute('x1', '0%'); gradCore.setAttribute('y1', '0%');
                gradCore.setAttribute('x2', '0%'); gradCore.setAttribute('y2', '100%');
                gradCore.innerHTML = `
                    <stop offset="0%" style="stop-color:#94a3b8;stop-opacity:1" />
                    <stop offset="25%" style="stop-color:#f1f5f9;stop-opacity:1" />
                    <stop offset="45%" style="stop-color:#ffffff;stop-opacity:1" />
                    <stop offset="65%" style="stop-color:#e2e8f0;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#64748b;stop-opacity:1" />
                `;
                
                // 巻き線のグラデーション: 濃いブロンズ/カッパー
                const gradWire = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                gradWire.setAttribute('id', `grad-ind-wire-${indId}`);
                gradWire.setAttribute('x1', '0%'); gradWire.setAttribute('y1', '0%');
                gradWire.setAttribute('x2', '0%'); gradWire.setAttribute('y2', '100%');
                gradWire.innerHTML = `
                    <stop offset="0%" style="stop-color:#78350f;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#451a03;stop-opacity:1" />
                `;
                
                defs.appendChild(gradCore);
                defs.appendChild(gradWire);
                g.appendChild(defs);

                const loopCount = 6;
                const step = 5; // ステップを短くして横幅を圧縮
                const coreH = 14;
                const startX = -(step * (loopCount - 1)) / 2;

                // 1. 背面の巻き線 (上下反転に対応: M x,-H/2 L x,H/2)
                for (let i = 0; i < loopCount; i++) {
                    const x = startX + i * step;
                    const backWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    backWire.setAttribute('d', `M ${x},${-coreH/2} L ${x},${coreH/2}`);
                    backWire.setAttribute('stroke', '#451a03'); 
                    backWire.setAttribute('stroke-width', '2');
                    backWire.setAttribute('fill', 'none');
                    g.appendChild(backWire);
                }

                // 2. 芯材 (本体円柱)
                const core = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                core.setAttribute('x', startX - step/2 - 2); core.setAttribute('y', -coreH/2);
                core.setAttribute('width', (step * (loopCount - 1)) + step + 4); core.setAttribute('height', coreH);
                core.setAttribute('rx', 2);
                // 枠線を排除
                core.setAttribute('fill', `url(#grad-ind-core-${indId})`);
                core.setAttribute('stroke', 'none');
                g.appendChild(core);

                // 3. 前面の巻き線 (上下反転: 右斜め下への傾斜)
                // 左端の開始線: リード(y=0)から右斜め下(y=H/2)へ
                const startWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                startWire.setAttribute('d', `M ${startX - step/2},0 L ${startX},${coreH/2}`);
                startWire.setAttribute('stroke', `url(#grad-ind-wire-${indId})`);
                startWire.setAttribute('stroke-width', '2.2');
                startWire.setAttribute('fill', 'none');
                startWire.setAttribute('stroke-linecap', 'round');
                g.appendChild(startWire);

                for (let i = 0; i < loopCount; i++) {
                    const x = startX + i * step;
                    
                    // 中間のメイン巻き線: 上(y=-H/2)から右斜め下(y=H/2)へ
                    if (i < loopCount - 1) {
                        const frontWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        frontWire.setAttribute('d', `M ${x},${-coreH/2} L ${x + step},${coreH/2}`);
                        frontWire.setAttribute('stroke', `url(#grad-ind-wire-${indId})`);
                        frontWire.setAttribute('stroke-width', '2.2');
                        frontWire.setAttribute('fill', 'none');
                        frontWire.setAttribute('stroke-linecap', 'round');
                        g.appendChild(frontWire);
                    } else {
                        // 右端の終了線: 上(y=-H/2)から右斜め下(リード y=0)へ
                        const endWire = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        endWire.setAttribute('d', `M ${x},${-coreH/2} L ${x + step/2},0`);
                        endWire.setAttribute('stroke', `url(#grad-ind-wire-${indId})`);
                        endWire.setAttribute('stroke-width', '2.2');
                        endWire.setAttribute('fill', 'none');
                        endWire.setAttribute('stroke-linecap', 'round');
                        g.appendChild(endWire);
                    }
                }

                // リード線
                path.setAttribute('d', `M -30,0 L ${startX - step/2},0 M ${startX + (loopCount-1)*step + step/2},0 L 30,0`);
                g.appendChild(path);
            } else {
                path.setAttribute('d', 'M -30,0 L -15,0 M 15,0 L 30,0 M -15,0 C -15,-10 -7.5,-10 -7.5,0 C -7.5,-10 0,-10 0,0 C 0,-10 7.5,-10 7.5,0 C 7.5,-10 15,-10 15,0');
                g.appendChild(path);
            }
            addPassivePolarity(g, color);
            break;
        }
        case 'voltmeter':
            if (showIllustrations) {
                const { n1, n2 } = getCompNodeNames(comp);
                const val = (simulationResults && simulationResults.voltages) ? ((simulationResults.voltages[n1] || 0) - (simulationResults.voltages[n2] || 0)) : 0;
                
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', -18); body.setAttribute('y', -18);
                body.setAttribute('width', 36); body.setAttribute('height', 36);
                body.setAttribute('rx', 4);
                body.setAttribute('fill', '#1e3a8a');
                
                const plate = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                plate.setAttribute('d', 'M -15,3 A 15,15 0 0 1 15,3 L 15,6 L -15,6 Z');
                plate.setAttribute('fill', '#f8f9fa');
                plate.setAttribute('transform', 'translate(0, -3)');
                
                const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                needle.id = `needle-${comp.id}`;
                const maxV = comp.range || 300;
                const ratio = Math.max(Math.min(val / maxV, 1.1), -0.1); // ストッパーを考慮しつつ少し外側まで許容
                const angle = -50 + ratio * 100;
                needle.setAttribute('x1', 0); needle.setAttribute('y1', 0);
                needle.setAttribute('x2', 0); needle.setAttribute('y2', -16);
                needle.setAttribute('stroke', '#e03131');
                needle.setAttribute('stroke-width', '1.5');
                needle.setAttribute('transform', `translate(0, 5) rotate(${angle})`);
                
                // 文字盤の目盛 (3分割)
                const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                for (let i = 0; i <= 3; i++) {
                    const tickAngle = (-50 + i * (100 / 3)) * Math.PI / 180;
                    const tLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    const rInner = 14, rOuter = 16.5;
                    tLine.setAttribute('x1', Math.sin(tickAngle) * rInner);
                    tLine.setAttribute('y1', -Math.cos(tickAngle) * rInner + 5);
                    tLine.setAttribute('x2', Math.sin(tickAngle) * rOuter);
                    tLine.setAttribute('y2', -Math.cos(tickAngle) * rOuter + 5);
                    tLine.setAttribute('stroke', '#333');
                    tLine.setAttribute('stroke-width', '1');
                    ticks.appendChild(tLine);
                }
                
                const lab = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                lab.textContent = 'V'; lab.setAttribute('x', 0); lab.setAttribute('y', 13);
                lab.setAttribute('text-anchor', 'middle'); lab.setAttribute('fill', 'white');
                lab.setAttribute('style', 'font: bold 10px Arial');

                path.setAttribute('d', 'M -30,0 L -18,0 M 18,0 L 30,0');
                g.appendChild(body); g.appendChild(plate); g.appendChild(ticks); g.appendChild(needle); g.appendChild(lab);
                g.appendChild(path);
                
                const tPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                tPos.setAttribute('cx', -11); tPos.setAttribute('cy', 13); tPos.setAttribute('r', 3);
                tPos.setAttribute('fill', '#ff4444');
                const tNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                tNeg.setAttribute('cx', 11); tNeg.setAttribute('cy', 13); tNeg.setAttribute('r', 3);
                tNeg.setAttribute('fill', '#333333');
                g.appendChild(tPos); g.appendChild(tNeg);
                return g;
            } else {
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
                g.appendChild(vCircle); g.appendChild(vText); g.appendChild(path);
                
                // 電圧計・電流計の端子はモードに関わらず常に表示するためクラスを付与しない
                const vPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                vPos.setAttribute('cx', -26); vPos.setAttribute('cy', 0); vPos.setAttribute('r', 4);
                vPos.setAttribute('fill', '#ff0000'); vPos.setAttribute('stroke', color); vPos.setAttribute('stroke-width', '1');
                const vNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                vNeg.setAttribute('cx', 26); vNeg.setAttribute('cy', 0); vNeg.setAttribute('r', 4);
                vNeg.setAttribute('fill', '#777777'); vNeg.setAttribute('stroke', color); vNeg.setAttribute('stroke-width', '1');
                g.appendChild(vPos); g.appendChild(vNeg);
                return g;
            }
        case 'ammeter':
            if (showIllustrations) {
                const val = (simulationResults && simulationResults.currents) ? (simulationResults.currents[comp.id] || 0) : 0;
                const body = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                body.setAttribute('x', -18); body.setAttribute('y', -18);
                body.setAttribute('width', 36); body.setAttribute('height', 36);
                body.setAttribute('rx', 4);
                body.setAttribute('fill', '#334155');
                const plate = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                plate.setAttribute('d', 'M -15,3 A 15,15 0 0 1 15,3 L 15,6 L -15,6 Z');
                plate.setAttribute('fill', '#f8f9fa');
                plate.setAttribute('transform', 'translate(0, -3)');
                const needle = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                needle.id = `needle-${comp.id}`;
                const maxA = comp.range || 5;
                const ratio = Math.max(Math.min(val / maxA, 1.1), -0.1);
                const angle = -50 + ratio * 100;
                needle.setAttribute('x1', 0); needle.setAttribute('y1', 0);
                needle.setAttribute('x2', 0); needle.setAttribute('y2', -16);
                needle.setAttribute('stroke', '#e03131');
                needle.setAttribute('stroke-width', '1.5');
                needle.setAttribute('transform', `translate(0, 5) rotate(${angle})`);
                
                // 文字盤の目盛 (5分割)
                const ticks = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                for (let i = 0; i <= 5; i++) {
                    const tickAngle = (-50 + i * 20) * Math.PI / 180;
                    const tLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    const rInner = 14, rOuter = 16.5;
                    tLine.setAttribute('x1', Math.sin(tickAngle) * rInner);
                    tLine.setAttribute('y1', -Math.cos(tickAngle) * rInner + 5);
                    tLine.setAttribute('x2', Math.sin(tickAngle) * rOuter);
                    tLine.setAttribute('y2', -Math.cos(tickAngle) * rOuter + 5);
                    tLine.setAttribute('stroke', '#333');
                    tLine.setAttribute('stroke-width', '1');
                    ticks.appendChild(tLine);
                }
                
                const lab = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                lab.textContent = 'A'; lab.setAttribute('x', 0); lab.setAttribute('y', 13);
                lab.setAttribute('text-anchor', 'middle'); lab.setAttribute('fill', 'white');
                lab.setAttribute('style', 'font: bold 10px Arial');
                path.setAttribute('d', 'M -30,0 L -18,0 M 18,0 L 30,0');
                g.appendChild(body); g.appendChild(plate); g.appendChild(ticks); g.appendChild(needle); g.appendChild(lab);
                g.appendChild(path);
                const tPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                tPos.setAttribute('cx', -11); tPos.setAttribute('cy', 13); tPos.setAttribute('r', 3);
                tPos.setAttribute('fill', '#ff4444');
                const tNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                tNeg.setAttribute('cx', 11); tNeg.setAttribute('cy', 13); tNeg.setAttribute('r', 3);
                tNeg.setAttribute('fill', '#333333');
                g.appendChild(tPos); g.appendChild(tNeg);
                return g;
            } else {
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
                g.appendChild(aCircle); g.appendChild(aText); g.appendChild(path);
                
                // 電圧計・電流計の端子はモードに関わらず常に表示するためクラスを付与しない
                const aPos = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                aPos.setAttribute('cx', -26); aPos.setAttribute('cy', 0); aPos.setAttribute('r', 4);
                aPos.setAttribute('fill', '#ff0000'); aPos.setAttribute('stroke', color); aPos.setAttribute('stroke-width', '1');
                const aNeg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                aNeg.setAttribute('cx', 26); aNeg.setAttribute('cy', 0); aNeg.setAttribute('r', 4);
                aNeg.setAttribute('fill', '#777777'); aNeg.setAttribute('stroke', color); aNeg.setAttribute('stroke-width', '1');
                g.appendChild(aPos); g.appendChild(aNeg);
                return g;
            }
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
            rotateComponent(id);
            forceStopSimulation();
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
            const mid = `mid_${c.x}_${c.y}`;
            if (c.rotation === 0) {
                netlist.push({ id: c.id + '_T', type: 'wire', nodes: [top, mid], value: 0 });
                netlist.push({ id: c.id + '_R', type: 'wire', nodes: [right, mid], value: 0 });
            } else if (c.rotation === 1) {
                netlist.push({ id: c.id + '_R', type: 'wire', nodes: [right, mid], value: 0 });
                netlist.push({ id: c.id + '_B', type: 'wire', nodes: [bottom, mid], value: 0 });
            } else if (c.rotation === 2) {
                netlist.push({ id: c.id + '_B', type: 'wire', nodes: [bottom, mid], value: 0 });
                netlist.push({ id: c.id + '_L', type: 'wire', nodes: [left, mid], value: 0 });
            } else {
                netlist.push({ id: c.id + '_L', type: 'wire', nodes: [left, mid], value: 0 });
                netlist.push({ id: c.id + '_T', type: 'wire', nodes: [top, mid], value: 0 });
            }
        } else if (c.type === 'wire_cross') {
            const mid = `mid_${c.x}_${c.y}`;
            netlist.push({ id: c.id + '_L', type: 'wire', nodes: [left, mid], value: 0 });
            netlist.push({ id: c.id + '_R', type: 'wire', nodes: [right, mid], value: 0 });
            netlist.push({ id: c.id + '_T', type: 'wire', nodes: [top, mid], value: 0 });
            netlist.push({ id: c.id + '_B', type: 'wire', nodes: [bottom, mid], value: 0 });
        } else if (c.type === 'wire_t') {
            const mid = `mid_${c.x}_${c.y}`;
            let n1, n2, n3;
            if (c.rotation === 0) { n1 = left; n2 = right; n3 = bottom; }
            else if (c.rotation === 1) { n1 = top; n2 = bottom; n3 = left; }
            else if (c.rotation === 2) { n1 = left; n2 = right; n3 = top; }
            else { n1 = top; n2 = bottom; n3 = right; }
            netlist.push({ id: c.id + '_1', type: 'wire', nodes: [n1, mid], value: 0 });
            netlist.push({ id: c.id + '_2', type: 'wire', nodes: [n2, mid], value: 0 });
            netlist.push({ id: c.id + '_3', type: 'wire', nodes: [n3, mid], value: 0 });
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
            
            const netItem = { id: c.id, type: c.type, nodes: [n1, n2], value: getCompSiValue(c) };
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

function showTooltip(e, comp) {
    if (isSimulating) return;
    if (!simulationResults) return;
    
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 15) + 'px';
    tooltip.style.top = (e.clientY + 15) + 'px';

    if (comp.type === 'wire_cross') {
        const iLeft = simulationResults.currents[comp.id + '_L'] || 0;
        const iRight = simulationResults.currents[comp.id + '_R'] || 0;
        const iTop = simulationResults.currents[comp.id + '_T'] || 0;
        const iBottom = simulationResults.currents[comp.id + '_B'] || 0;
        tooltip.innerHTML = `
            <strong>十字導線</strong><br>
            上: ${Math.abs(iTop).toFixed(3)}A<br>
            下: ${Math.abs(iBottom).toFixed(3)}A<br>
            左: ${Math.abs(iLeft).toFixed(3)}A<br>
            右: ${Math.abs(iRight).toFixed(3)}A
        `;
    } else if (comp.type === 'wire_t') {
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

    tooltip.innerHTML = `電圧: ${volt.toFixed(2)} V<br>電流: ${curr.toFixed(2)} A`;
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
    resultsPanel.addEventListener('pointerdown', () => bringToFront(resultsPanel));
    resultsHeader.addEventListener('pointerdown', (e) => {
        if (e.target.id === 'close-results-btn') return;
        isDraggingResults = true;
        undockPanel(resultsPanel);
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        const rect = resultsPanel.getBoundingClientRect();
        initialPanelX = rect.left;
        initialPanelY = rect.top;
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
        forceStopSimulation(); // シミュレーション動作中なら停止させる
        audio.playTrashAll();  // 全消去用の少し長い「シュッ」という音
        components = [];
        simulationResults = null;
        resetGraphHistory();
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
    const acIconBox = document.querySelector('.tool-item[data-type="ac_source"] .icon-box');
    if (acIconBox) {
        if (showIllustrations) {
            acIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <linearGradient id="grad-icon-ac-body" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#4a5568;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#1a202c;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <rect x="-24" y="-18" width="48" height="36" rx="3" fill="url(#grad-icon-ac-body)" stroke="none" />
                    <rect x="-18" y="-12" width="36" height="14" rx="1" fill="#0f172a" />
                    <path d="M -12,-5 C -12,-10 -6,-10 -6,-5 C -6,0 0,0 0,-5 C 0,-10 6,-10 6,-5 C 6,0 12,0 12,-5" stroke="#38bdf8" stroke-width="1.5" fill="none" stroke-linecap="round" />
                    <circle cx="-10" cy="8" r="3" fill="#94a3b8" />
                    <circle cx="10" cy="8" r="3" fill="#94a3b8" />
                    <path d="M -30,0 L -24,0 M 24,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                </svg>
            `;
        } else {
            acIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -18,0 M 18,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <circle cx="0" cy="0" r="18" fill="var(--inner-fill)" stroke="currentColor" stroke-width="2" />
                    <path d="M -10,0 C -10,-6 -5,-6 0,0 C 5,6 10,6 10,0" stroke="currentColor" stroke-width="2" fill="none" />
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
    
    const capIconBox = document.querySelector('.tool-item[data-type="capacitor"] .icon-box');
    if (capIconBox) {
        if (showIllustrations) {
            capIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <linearGradient id="grad-icon-cap-metal" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" style="stop-color:#ced4da;stop-opacity:1" />
                            <stop offset="50%" style="stop-color:#e2e8f0;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#adb5bd;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M -30,0 L -8,0 M 8,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <rect x="-8" y="-18" width="5" height="36" rx="1" fill="url(#grad-icon-cap-metal)" stroke="#cbd5e1" stroke-width="1" />
                    <rect x="3" y="-18" width="5" height="36" rx="1" fill="url(#grad-icon-cap-metal)" stroke="#cbd5e1" stroke-width="1" />
                    <!-- 極性マーク -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        } else {
            capIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -6,0 M 6,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
                    <path d="M -6,-15 L -6,15 M 6,-15 L 6,15" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round" />
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        }
    }
    const indIconBox = document.querySelector('.tool-item[data-type="inductor"] .icon-box');
    if (indIconBox) {
        if (showIllustrations) {
            indIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <defs>
                        <linearGradient id="grad-icon-ind-core" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#94a3b8;stop-opacity:1" />
                            <stop offset="30%" style="stop-color:#ffffff;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#64748b;stop-opacity:1" />
                        </linearGradient>
                        <linearGradient id="grad-icon-ind-wire" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" style="stop-color:#78350f;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#451a03;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M -30,0 L -18.5,0 M 18.5,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <!-- Back wires -->
                    <path d="M -16,-6 L -16,6 M -8,-6 L -8,6 M 0,-6 L 0,6 M 8,-6 L 8,6 M 16,-6 L 16,6" stroke="#451a03" stroke-width="2" fill="none" />
                    <!-- Core -->
                    <rect x="-20" y="-7" width="40" height="14" rx="2" fill="url(#grad-icon-ind-core)" stroke="none" />
                    <!-- Front wires (Parallel / Slant / Flipped) -->
                    <path d="M -20,0 L -16,6 M -16,-6 L -8,6 M -8,-6 L 0,6 M 0,-6 L 8,6 M 8,-6 L 16,6 M 16,-6 L 20,0" stroke="url(#grad-icon-ind-wire)" stroke-width="2.2" fill="none" stroke-linecap="round" />
                    <!-- 極性マーク -->
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        } else {
            indIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -15,0 M 15,0 L 30,0 M -15,0 C -15,-10 -7.5,-10 -7.5,0 C -7.5,-10 0,-10 0,0 C 0,-10 7.5,-10 7.5,0 C 7.5,-10 15,-10 15,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <circle class="passive-polarity" cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle class="passive-polarity" cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        }
    }
    const vIconBox = document.querySelector('.tool-item[data-type="voltmeter"] .icon-box');
    if (vIconBox) {
        if (showIllustrations) {
            vIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -24,0 M 24,0 L 30,0" fill="none" stroke="currentColor" stroke-width="2" />
                    <rect x="-24" y="-24" width="48" height="48" rx="4" fill="#1e3a8a" />
                    <path d="M -18,0 A 18,18 0 0 1 18,0 L 18,4 L -18,4 Z" fill="#f8f9fa" transform="translate(0, -4)" />
                    <line x1="0" y1="8" x2="0" y2="-12" stroke="#e03131" stroke-width="1.8" transform="rotate(-50, 0, 8)" />
                    <text x="0" y="18" text-anchor="middle" font-size="12px" font-weight="bold" fill="white">V</text>
                    <circle cx="-15" cy="18" r="4" fill="#ff4444" />
                    <circle cx="15" cy="18" r="4" fill="#333" />
                </svg>
            `;
        } else {
            vIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <circle cx="0" cy="0" r="14" fill="var(--inner-fill)" stroke="currentColor" stroke-width="2" />
                    <text x="0" y="0" dominant-baseline="central" text-anchor="middle" font-size="14px" font-weight="bold" fill="currentColor">V</text>
                    <path d="M -30,0 L -14,0 M 14,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <circle cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
                </svg>
            `;
        }
    }

    const aIconBox = document.querySelector('.tool-item[data-type="ammeter"] .icon-box');
    if (aIconBox) {
        if (showIllustrations) {
            aIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <path d="M -30,0 L -24,0 M 24,0 L 30,0" fill="none" stroke="currentColor" stroke-width="2" />
                    <rect x="-24" y="-24" width="48" height="48" rx="4" fill="#334155" />
                    <path d="M -18,0 A 18,18 0 0 1 18,0 L 18,4 L -18,4 Z" fill="#f8f9fa" transform="translate(0, -4)" />
                    <line x1="0" y1="8" x2="0" y2="-12" stroke="#e03131" stroke-width="1.8" transform="rotate(-50, 0, 8)" />
                    <text x="0" y="18" text-anchor="middle" font-size="12px" font-weight="bold" fill="white">A</text>
                    <circle cx="-15" cy="18" r="4" fill="#ff4444" />
                    <circle cx="15" cy="18" r="4" fill="#333" />
                </svg>
            `;
        } else {
            aIconBox.innerHTML = `
                <svg viewBox="-30 -30 60 60" style="width: 100%; height: 100%; overflow: visible;">
                    <circle cx="0" cy="0" r="14" fill="var(--inner-fill)" stroke="currentColor" stroke-width="2" />
                    <text x="0" y="0" dominant-baseline="central" text-anchor="middle" font-size="14px" font-weight="bold" fill="currentColor">A</text>
                    <path d="M -30,0 L -14,0 M 14,0 L 30,0" stroke="currentColor" stroke-width="2" fill="none" />
                    <circle cx="-26" cy="0" r="4" fill="#ff0000" stroke="currentColor" stroke-width="1"/>
                    <circle cx="26" cy="0" r="4" fill="#777777" stroke="currentColor" stroke-width="1"/>
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
        if (showIllustrations) audio.playChime();
        else audio.playChimeOff();
        updateToolbarIcons();
        render();
        if (typeof simulator3D !== 'undefined' && simulator3D.isActive) {
            simulator3D.update(components, simulationResults);
        }
    };
}

// 電荷表示のトグルにも追加
const partCheck = document.getElementById('show-particles-checkbox');
if (partCheck) {
    partCheck.addEventListener('change', (e) => {
        if (e.target.checked) audio.playChime();
        else audio.playChimeOff();
        render();
    });
}

init();
