// ========== CONFIG ==========
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const attemptsEl = document.getElementById('attempts');

// Full-viewport death overlay canvas
const deathCanvas = document.getElementById('death-fx');
const dctx = deathCanvas.getContext('2d');
let VW = window.innerWidth;
let VH = window.innerHeight;

// Full-viewport background canvas
const bgCanvas = document.getElementById('bg-fx');
const bctx = bgCanvas.getContext('2d');
bgCanvas.width = VW * (window.devicePixelRatio || 1);
bgCanvas.height = VH * (window.devicePixelRatio || 1);
bctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

// ---- CHANGE GRID SIZE HERE ----
const GRID = 8;
const TOTAL = GRID * GRID;

// Dynamic canvas: fill more on mobile, 80% on desktop
const isMobile = Math.min(window.innerWidth, window.innerHeight) < 600;
const W = Math.floor(Math.min(window.innerWidth, window.innerHeight) * (isMobile ? 0.95 : 0.8));
canvas.style.width = W + 'px';
canvas.style.height = W + 'px';

// HiDPI
const dpr = window.devicePixelRatio || 1;
canvas.width = W * dpr;
canvas.height = W * dpr;
ctx.scale(dpr, dpr);

// Zoomed view: 3x3 cells fill the canvas (hero centered)
const VCELL = W / 3;
const maxR = VCELL * 0.38;

// Minimap in bottom-right corner
const MINI = Math.floor(W * 0.28);
const MINI_CELL = MINI / GRID;
const MINI_PAD = 10;
const MINI_X = W - MINI - MINI_PAD;
const MINI_Y = W - MINI - MINI_PAD;

// ========== MAZE GENERATION ==========
const maze = [];
for (let y = 0; y < GRID; y++) {
    maze[y] = [];
    for (let x = 0; x < GRID; x++) {
        maze[y][x] = 0;
    }
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function generateMaze() {
    // Random walk from (0,0) to (GRID-1, GRID-1) to guarantee a path,
    // then randomly add/remove walls for variety
    const goal = GRID - 1;

    // Step 1: Random walk to carve a guaranteed path from start to goal
    let cx = 0, cy = 0;
    maze[0][0] = 1;
    while (cx !== goal || cy !== goal) {
        // Bias toward goal but allow random detours
        const dirs = [];
        if (cx < goal) dirs.push([1, 0]);
        if (cy < goal) dirs.push([0, 1]);
        if (cx > 0 && Math.random() < 0.3) dirs.push([-1, 0]);
        if (cy > 0 && Math.random() < 0.3) dirs.push([0, -1]);
        const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
        cx += dx;
        cy += dy;
        maze[cy][cx] = 1;
    }

    // Step 2: Randomly add some extra path cells (dead ends / alternate routes)
    const extraPaths = Math.floor(TOTAL * 0.15);
    for (let i = 0; i < extraPaths; i++) {
        const rx = Math.floor(Math.random() * GRID);
        const ry = Math.floor(Math.random() * GRID);
        maze[ry][rx] = 1;
    }
}

generateMaze();

// ========== CELL ANIMATION ==========
const cellAnims = [];
for (let i = 0; i < TOTAL; i++) {
    cellAnims.push({
        speed: 1.2 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        speed2: 0.6 + Math.random() * 1.2,
        phase2: Math.random() * Math.PI * 2,
        speed3: 0.2 + Math.random() * 0.5,
        phase3: Math.random() * Math.PI * 2,
        speed4: 0.1 + Math.random() * 0.3,
        phase4: Math.random() * Math.PI * 2,
        // Rotation speeds for decorative layers
        rotSpeed: (0.15 + Math.random() * 0.35) * (Math.random() > 0.5 ? 1 : -1),
        rotSpeed2: (0.05 + Math.random() * 0.15) * (Math.random() > 0.5 ? 1 : -1),
        // Orbit params for particles
        orbitCount: 3 + Math.floor(Math.random() * 4),
        orbitSpeed: 0.4 + Math.random() * 0.8,
        orbitPhase: Math.random() * Math.PI * 2,
    });
}

// Smooth value interpolation
const smoothVals = new Float32Array(TOTAL);
const LERP = 0.12;

function getCellValue(x, y, t) {
    const a = cellAnims[y * GRID + x];
    const f1 = Math.sin(t * a.speed + a.phase);
    const f2 = Math.sin(t * a.speed2 + a.phase2) * 0.3;
    const f3 = Math.sin(t * a.speed3 + a.phase3) * 0.18;
    const f4 = Math.sin(t * a.speed4 + a.phase4) * 0.08;
    return Math.max(-1, Math.min(1, f1 + f2 + f3 + f4));
}

// Smoothed value (for rendering fluidity)
function getSmoothedValue(x, y, t) {
    const idx = y * GRID + x;
    const raw = getCellValue(x, y, t);
    smoothVals[idx] += (raw - smoothVals[idx]) * LERP;
    return smoothVals[idx];
}

// ========== GAME STATE ==========
let heroX = 0;
let heroY = 0;
let attempts = 1;
let dead = false;
let won = false;
let deathTime = 0;
let deathX = -1;
let deathY = -1;
let deathType = ''; // 'wall' or 'dark'
let canRestart = false;
let winTime = 0;

// Persistent knowledge across deaths
const knownPath = new Set();      // safely visited path cells
const knownWalls = new Set();     // confirmed walls
const knownTimingDeath = new Set(); // path cells where you died due to timing
knownPath.add('0,0');

function isPath(x, y) {
    return x >= 0 && x < GRID && y >= 0 && y < GRID && maze[y][x] === 1;
}

function isVisible(x, y) {
    return Math.abs(x - heroX) + Math.abs(y - heroY) <= 1;
}

// ========== GAME LOGIC ==========
function tryMove(dx, dy) {
    if (dead || won) return;

    const nx = heroX + dx;
    const ny = heroY + dy;

    // Bounds
    if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) return;

    // Wall check
    if (!isPath(nx, ny)) {
        knownWalls.add(`${nx},${ny}`);
        die(nx, ny, 'wall');
        return;
    }

    // Timing check — cell must be crimson (negative) AND bright enough
    const t = performance.now() / 1000;
    const val = getCellValue(nx, ny, t);
    if (val >= 0) {
        knownTimingDeath.add(`${nx},${ny}`); // it IS path, just white right now
        die(nx, ny, 'white');
        return;
    }
    if (Math.abs(val) < 0.5) {
        knownTimingDeath.add(`${nx},${ny}`); // it IS path, just too dim
        die(nx, ny, 'dark');
        return;
    }

    // Safe move
    heroX = nx;
    heroY = ny;
    knownPath.add(`${nx},${ny}`);
    knownTimingDeath.delete(`${nx},${ny}`);

    // Win?
    if (nx === GRID - 1 && ny === GRID - 1) {
        won = true;
        winTime = performance.now();
        // Init full-viewport win canvas (reuse death overlay)
        VW = window.innerWidth;
        VH = window.innerHeight;
        deathCanvas.width = VW * dpr;
        deathCanvas.height = VH * dpr;
        dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        deathCanvas.style.display = 'block';
    }
}

function die(x, y, type) {
    dead = true;
    deathTime = performance.now();
    deathX = x;
    deathY = y;
    deathType = type;
    canRestart = false;
    setTimeout(() => { canRestart = true; }, 1320);

    // Init full-viewport death canvas
    VW = window.innerWidth;
    VH = window.innerHeight;
    deathCanvas.width = VW * dpr;
    deathCanvas.height = VH * dpr;
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    deathCanvas.style.display = 'block';
}

function restart() {
    heroX = 0;
    heroY = 0;
    dead = false;
    deathX = -1;
    deathY = -1;
    attempts++;
    attemptsEl.textContent = attempts;
    canvas.style.transform = 'translate(-50%, -50%)';
    document.body.style.transform = '';
    deathCanvas.style.display = 'none';
}

// ========== INTRO SCREEN ==========
let introActive = true;
const introEl = document.getElementById('intro');
const introControls = document.getElementById('intro-controls');
const introStart = document.getElementById('intro-start');
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

if (isTouchDevice) {
    introControls.innerHTML = 'swipe <b>up / down / left / right</b> to move<br>tap to restart after death';
    introStart.textContent = 'tap anywhere to start';
} else {
    introControls.innerHTML = '<kbd>\u2190</kbd> <kbd>\u2191</kbd> <kbd>\u2193</kbd> <kbd>\u2192</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to move';
    introStart.textContent = 'press any key to start';
}

function dismissIntro() {
    if (!introActive) return;
    introActive = false;
    introEl.style.display = 'none';
}

// ========== INPUT ==========
document.addEventListener('keydown', (e) => {
    if (introActive) { dismissIntro(); return; }
    if (won) return;

    if (dead) {
        if (canRestart) restart();
        return;
    }

    switch (e.key) {
        case 'ArrowUp':    case 'w': case 'W': e.preventDefault(); tryMove(0, -1); break;
        case 'ArrowDown':  case 's': case 'S': e.preventDefault(); tryMove(0, 1); break;
        case 'ArrowLeft':  case 'a': case 'A': e.preventDefault(); tryMove(-1, 0); break;
        case 'ArrowRight': case 'd': case 'D': e.preventDefault(); tryMove(1, 0); break;
    }
});

// Touch / swipe support for mobile
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

document.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = performance.now();
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    e.preventDefault(); // prevent scrolling while playing
}, { passive: false });

document.addEventListener('touchend', (e) => {
    if (introActive) { dismissIntro(); return; }

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - touchStartTime;

    // Tap (short distance) — restart if dead
    if (dist < 20) {
        if (won) return;
        if (dead && canRestart) restart();
        return;
    }

    // Swipe — need minimum distance and max time
    if (dist < 30 || elapsed > 800) return;
    if (won) return;

    if (dead) {
        if (canRestart) restart();
        return;
    }

    // Determine swipe direction
    if (Math.abs(dx) > Math.abs(dy)) {
        tryMove(dx > 0 ? 1 : -1, 0);
    } else {
        tryMove(0, dy > 0 ? 1 : -1);
    }
});

// ========== RENDER HELPERS ==========
// Convert grid coords to screen coords (hero-centered camera)
function toScreen(gx, gy) {
    const dx = gx - heroX;
    const dy = gy - heroY;
    return {
        x: (dx + 1.5) * VCELL,
        y: (dy + 1.5) * VCELL,
    };
}

// ========== RENDER ==========
function render(timestamp) {
    const t = timestamp / 1000;

    // Trail overlay — longer persistence for fluid feel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.09)';
    ctx.fillRect(0, 0, W, W);

    // --- Main view: zoomed-in hero neighborhood ---
    if (!dead) {
        const neighbors = [
            [heroX, heroY],
            [heroX - 1, heroY], [heroX + 1, heroY],
            [heroX, heroY - 1], [heroX, heroY + 1],
        ];

        // Pre-compute smoothed values for all visible cells
        const cellData = [];
        for (const [gx, gy] of neighbors) {
            if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) {
                cellData.push(null);
                continue;
            }
            const { x: sx, y: sy } = toScreen(gx, gy);
            const a = cellAnims[gy * GRID + gx];
            const val = getSmoothedValue(gx, gy, t);
            const rawVal = getCellValue(gx, gy, t);
            const mag = Math.abs(val);
            const mapped = Math.pow(mag, 0.75);
            const dist = Math.abs(gx - heroX) + Math.abs(gy - heroY);
            const brightness = dist === 0 ? 1 : 0.55;
            cellData.push({ gx, gy, sx, sy, a, val, rawVal, mag, mapped, dist, brightness });
        }

        // ---- Layer 1: Expanding ripple rings ----
        for (const c of cellData) {
            if (!c) continue;
            const { sx, sy, a, val, brightness } = c;

            for (let ring = 0; ring < 5; ring++) {
                const cycle = (t * a.speed * 0.5 + a.phase + ring * 1.26) % (Math.PI * 2);
                const progress = cycle / (Math.PI * 2);
                const ringR = progress * maxR * 1.8;
                const ringAlpha = (1 - progress) * (1 - progress) * 0.08 * brightness;
                const lw = 2 * (1 - progress);

                ctx.strokeStyle = val >= 0
                    ? `rgba(255,255,255,${ringAlpha})`
                    : `rgba(220,20,60,${ringAlpha})`;
                ctx.lineWidth = lw;
                ctx.beginPath();
                ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // ---- Layer 2: Slow rotating spokes ----
        for (const c of cellData) {
            if (!c) continue;
            const { sx, sy, a, val, mag, brightness } = c;

            const rotation = t * a.rotSpeed;
            const spokeLen = mag * maxR * 1.2;
            const spokeAlpha = 0.05 * brightness * mag;

            ctx.strokeStyle = val >= 0
                ? `rgba(255,255,255,${spokeAlpha})`
                : `rgba(220,20,60,${spokeAlpha})`;
            ctx.lineWidth = 0.8;

            for (let s = 0; s < 8; s++) {
                const angle = rotation + (s / 8) * Math.PI * 2;
                ctx.beginPath();
                ctx.moveTo(
                    sx + Math.cos(angle) * maxR * 0.1,
                    sy + Math.sin(angle) * maxR * 0.1
                );
                ctx.lineTo(
                    sx + Math.cos(angle) * spokeLen,
                    sy + Math.sin(angle) * spokeLen
                );
                ctx.stroke();
            }
        }

        // ---- Layer 3: Orbiting particles ----
        for (const c of cellData) {
            if (!c) continue;
            const { sx, sy, a, val, mag, brightness } = c;
            if (mag < 0.1) continue;

            const orbitR = mag * maxR * 0.85;
            for (let p = 0; p < a.orbitCount; p++) {
                const angle = t * a.orbitSpeed + a.orbitPhase + (p / a.orbitCount) * Math.PI * 2;
                const wobble = Math.sin(t * a.speed2 + p * 1.7) * maxR * 0.08;
                const px = sx + Math.cos(angle) * (orbitR + wobble);
                const py = sy + Math.sin(angle) * (orbitR + wobble);
                const pr = 1.5 + mag * 2.5;
                const pa = 0.2 * brightness * mag;

                ctx.fillStyle = val >= 0
                    ? `rgba(255,255,255,${pa})`
                    : `rgba(220,20,60,${pa})`;
                ctx.beginPath();
                ctx.arc(px, py, pr, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ---- Layer 4: Soft glow halo ----
        for (const c of cellData) {
            if (!c) continue;
            const { sx, sy, val, mag, mapped, brightness } = c;
            if (mag < 0.05) continue;

            const glowR = mapped * maxR * 1.5;
            const alpha = mag * 0.1 * brightness;

            ctx.fillStyle = val >= 0
                ? `rgba(255,255,255,${alpha})`
                : `rgba(220,20,60,${alpha})`;
            ctx.beginPath();
            ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
            ctx.fill();
        }

        // ---- Layer 5: Main circle + concentric inner rings + core ----
        for (const c of cellData) {
            if (!c) continue;
            const { gx, gy, sx, sy, a, val, rawVal, mag, mapped, brightness } = c;
            const r = mapped * maxR;
            if (r < 0.5) continue;

            // Main circle
            ctx.fillStyle = val >= 0
                ? `rgba(255,255,255,${brightness})`
                : `rgba(220,20,60,${brightness})`;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();

            // Concentric inner rings — pulsing at different rates
            for (let ir = 0; ir < 3; ir++) {
                const irPhase = t * a.speed * (1.5 + ir * 0.8) + a.phase2 + ir * 1.1;
                const irMag = Math.abs(Math.sin(irPhase));
                const irR = r * (0.25 + ir * 0.2) * irMag;
                if (irR < 1) continue;
                const irAlpha = 0.12 * brightness * irMag;

                ctx.strokeStyle = `rgba(255,255,255,${irAlpha})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.arc(sx, sy, irR, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Corona flicker — jagged edge shimmer
            const coronaSegs = 24;
            const coronaAlpha = 0.06 * brightness * mag;
            ctx.strokeStyle = val >= 0
                ? `rgba(255,255,255,${coronaAlpha})`
                : `rgba(220,20,60,${coronaAlpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let cs = 0; cs <= coronaSegs; cs++) {
                const cAngle = (cs / coronaSegs) * Math.PI * 2;
                const flicker = 1 + Math.sin(t * a.speed * 5 + cs * 2.3 + a.phase3) * 0.12;
                const cr = r * flicker;
                if (cs === 0) ctx.moveTo(sx + Math.cos(cAngle) * cr, sy + Math.sin(cAngle) * cr);
                else ctx.lineTo(sx + Math.cos(cAngle) * cr, sy + Math.sin(cAngle) * cr);
            }
            ctx.closePath();
            ctx.stroke();

            // Inner bright core — fast pulse
            const corePulse = Math.abs(Math.sin(t * a.speed * 3 + a.phase2));
            const coreR = r * 0.25 * corePulse;
            if (coreR > 1) {
                const coreAlpha = 0.6 * corePulse * brightness;
                ctx.fillStyle = `rgba(255,255,255,${coreAlpha})`;
                ctx.beginPath();
                ctx.arc(sx, sy, coreR, 0, Math.PI * 2);
                ctx.fill();
            }

            // Knowledge indicator
            const key = `${gx},${gy}`;
            if (knownPath.has(key) && !(gx === heroX && gy === heroY)) {
                ctx.fillStyle = 'rgba(100,220,100,0.3)';
                ctx.beginPath();
                ctx.arc(sx, sy + maxR + 8, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (knownWalls.has(key)) {
                ctx.fillStyle = 'rgba(220,60,60,0.35)';
                ctx.beginPath();
                ctx.arc(sx, sy + maxR + 8, 3, 0, Math.PI * 2);
                ctx.fill();
            } else if (knownTimingDeath.has(key)) {
                ctx.fillStyle = 'rgba(255,170,50,0.3)';
                ctx.beginPath();
                ctx.arc(sx, sy + maxR + 8, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // Goal indicator
            if (gx === GRID - 1 && gy === GRID - 1) {
                ctx.strokeStyle = `rgba(255,200,50,${0.3 + Math.sin(t * 3) * 0.2})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sx, sy, maxR + 6, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // ---- Hero (always center) ----
        const hScreen = toScreen(heroX, heroY);
        const hr = VCELL * 0.1;

        // Hero glow — slow breathing
        const heroBreath = 0.18 + Math.sin(t * 1.5) * 0.06;
        const glow = ctx.createRadialGradient(
            hScreen.x, hScreen.y, 0,
            hScreen.x, hScreen.y, hr * 4
        );
        glow.addColorStop(0, `rgba(255,200,50,${heroBreath})`);
        glow.addColorStop(0.5, `rgba(255,200,50,${heroBreath * 0.3})`);
        glow.addColorStop(1, 'rgba(255,200,50,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hScreen.x, hScreen.y, hr * 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffcc33';
        ctx.beginPath();
        ctx.arc(hScreen.x, hScreen.y, hr, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Minimap (bottom-right corner) ---
    // Clear minimap area so trails don't accumulate over it
    ctx.fillStyle = '#000';
    ctx.fillRect(MINI_X - 2, MINI_Y - 2, MINI + 4, MINI + 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(MINI_X - 1, MINI_Y - 1, MINI + 2, MINI + 2);

    for (let y = 0; y < GRID; y++) {
        for (let x = 0; x < GRID; x++) {
            const mx = MINI_X + x * MINI_CELL + MINI_CELL / 2;
            const my = MINI_Y + y * MINI_CELL + MINI_CELL / 2;
            const key = `${x},${y}`;
            const dotR = Math.max(1.5, MINI_CELL * 0.35);

            if (x === heroX && y === heroY && !dead) {
                ctx.fillStyle = 'rgba(255,200,50,0.9)';
                ctx.beginPath();
                ctx.arc(mx, my, dotR + 1, 0, Math.PI * 2);
                ctx.fill();
            } else if (knownPath.has(key)) {
                ctx.fillStyle = 'rgba(100,220,100,0.45)';
                ctx.beginPath();
                ctx.arc(mx, my, dotR, 0, Math.PI * 2);
                ctx.fill();
            } else if (knownWalls.has(key)) {
                ctx.fillStyle = 'rgba(220,60,60,0.5)';
                ctx.beginPath();
                ctx.arc(mx, my, dotR, 0, Math.PI * 2);
                ctx.fill();
            } else if (knownTimingDeath.has(key)) {
                ctx.fillStyle = 'rgba(255,170,50,0.5)';
                ctx.beginPath();
                ctx.arc(mx, my, dotR, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    // Goal on minimap
    const gmx = MINI_X + (GRID - 1) * MINI_CELL + MINI_CELL / 2;
    const gmy = MINI_Y + (GRID - 1) * MINI_CELL + MINI_CELL / 2;
    ctx.strokeStyle = `rgba(255,200,50,${0.4 + Math.sin(t * 3) * 0.2})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(gmx, gmy, MINI_CELL * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    // --- Death effect: full-viewport freakout on death canvas ---
    if (dead) {
        const elapsed = (performance.now() - deathTime) / 1000 / 0.6; // 40% faster
        const isWall = deathType === 'wall';
        const isWhite = deathType === 'white';

        // Death color: wall=crimson, white=blinding white, dark=amber
        const deathR = isWall ? 220 : isWhite ? 255 : 255;
        const deathG = isWall ? 20 : isWhite ? 255 : 150;
        const deathB = isWall ? 60 : isWhite ? 255 : 50;

        // Death epicenter in viewport coords (center of canvas + offset)
        const canvasRect = canvas.getBoundingClientRect();
        const screenCoord = toScreen(deathX, deathY);
        const epX = canvasRect.left + (screenCoord.x / W) * canvasRect.width;
        const epY = canvasRect.top + (screenCoord.y / W) * canvasRect.height;

        // Fade previous frame (trail on death canvas)
        dctx.fillStyle = 'rgba(0,0,0,0.08)';
        dctx.fillRect(0, 0, VW, VH);

        // Screen shake — shake the entire page
        if (elapsed < 1.2) {
            const intensity = (1 - elapsed / 1.2) * 18;
            const sx = (Math.random() - 0.5) * intensity;
            const sy = (Math.random() - 0.5) * intensity;
            document.body.style.transform = `translate(${sx}px,${sy}px)`;
        } else {
            document.body.style.transform = '';
        }

        // Phase 1: Blinding full-screen flash (0–0.15s)
        if (elapsed < 0.15) {
            const a = 0.85 * (1 - elapsed / 0.15);
            dctx.fillStyle = `rgba(${deathR},${deathG},${deathB},${a})`;
            dctx.fillRect(0, 0, VW, VH);
        }

        // Phase 2: Massive shockwave rings from epicenter (0–1.8s)
        if (elapsed < 1.8) {
            const maxDist = Math.hypot(VW, VH);
            for (let wave = 0; wave < 8; wave++) {
                const wStart = wave * 0.1;
                const wE = elapsed - wStart;
                if (wE < 0 || wE > 1.5) continue;

                const p = wE / 1.5;
                const wR = p * maxDist * 0.7;
                const wA = (1 - p) * 0.4;
                const lw = (1 - p) * 6;

                dctx.strokeStyle = `rgba(${deathR},${deathG},${deathB},${wA})`;
                dctx.lineWidth = lw;
                dctx.beginPath();
                dctx.arc(epX, epY, wR, 0, Math.PI * 2);
                dctx.stroke();
            }
        }

        // Phase 3: Full-width glitch scanlines (0.03–0.8s)
        if (elapsed > 0.03 && elapsed < 0.8) {
            const gi = 1 - (elapsed - 0.03) / 0.77;
            // Horizontal tears
            const lines = Math.floor(gi * 40);
            for (let i = 0; i < lines; i++) {
                const ly = Math.random() * VH;
                const lh = 1 + Math.random() * 6;
                const offset = (Math.random() - 0.5) * 60 * gi;
                dctx.fillStyle = `rgba(${deathR},${deathG},${deathB},${0.5 * gi * Math.random()})`;
                dctx.fillRect(offset, ly, VW, lh);
            }
            // White glitch tears
            const wlines = Math.floor(gi * 12);
            for (let i = 0; i < wlines; i++) {
                const ly = Math.random() * VH;
                const lh = 1 + Math.random() * 3;
                dctx.fillStyle = `rgba(255,255,255,${0.25 * gi * Math.random()})`;
                dctx.fillRect(0, ly, VW, lh);
            }
            // Vertical glitch blocks
            const vblocks = Math.floor(gi * 6);
            for (let i = 0; i < vblocks; i++) {
                const bx = Math.random() * VW;
                const bw = 5 + Math.random() * 40;
                const by = Math.random() * VH;
                const bh = 20 + Math.random() * 100;
                dctx.fillStyle = `rgba(${deathR},${deathG},${deathB},${0.15 * gi * Math.random()})`;
                dctx.fillRect(bx, by, bw, bh);
            }
        }

        // Phase 4: TV static noise across entire viewport (0.05–1.2s)
        if (elapsed > 0.05 && elapsed < 1.2) {
            const ni = 1 - (elapsed - 0.05) / 1.15;
            const dots = Math.floor(ni * ni * 500);
            for (let i = 0; i < dots; i++) {
                const nx = Math.random() * VW;
                const ny = Math.random() * VH;
                const ns = 1 + Math.random() * 4 * ni;
                const na = ni * 0.4 * Math.random();
                dctx.fillStyle = Math.random() > 0.35
                    ? `rgba(${deathR},${deathG},${deathB},${na})`
                    : `rgba(255,255,255,${na * 0.4})`;
                dctx.fillRect(nx, ny, ns, ns);
            }
        }

        // Phase 5: Spiral vortex sucking in from screen edges (0.2–1.8s)
        if (elapsed > 0.2 && elapsed < 1.8) {
            const sp = (elapsed - 0.2) / 1.6;
            const arms = 24;
            const maxSpiral = Math.hypot(VW, VH) * 0.5;
            for (let s = 0; s < arms; s++) {
                const angle = sp * Math.PI * 8 + (s / arms) * Math.PI * 2;
                const dist = (1 - sp) * maxSpiral;
                const px = epX + Math.cos(angle) * dist;
                const py = epY + Math.sin(angle) * dist;
                const pr = (1 - sp) * 8;
                const pa = (1 - sp) * 0.3;

                dctx.fillStyle = `rgba(${deathR},${deathG},${deathB},${pa})`;
                dctx.beginPath();
                dctx.arc(px, py, Math.max(1, pr), 0, Math.PI * 2);
                dctx.fill();
            }

            // Vortex core glow
            const vR = (1 - sp) * maxSpiral * 0.6;
            if (vR > 1) {
                const vGrad = dctx.createRadialGradient(epX, epY, 0, epX, epY, vR);
                vGrad.addColorStop(0, `rgba(${deathR},${deathG},${deathB},${(1 - sp) * 0.12})`);
                vGrad.addColorStop(1, `rgba(${deathR},${deathG},${deathB},0)`);
                dctx.fillStyle = vGrad;
                dctx.beginPath();
                dctx.arc(epX, epY, vR, 0, Math.PI * 2);
                dctx.fill();
            }
        }

        // Phase 6: Full-screen heartbeat aftershock pulses (0.8–2.0s)
        if (elapsed > 0.8 && elapsed < 2.0) {
            const pulseT = elapsed - 0.8;
            for (let p = 0; p < 4; p++) {
                const pStart = p * 0.25;
                const pE = pulseT - pStart;
                if (pE < 0 || pE > 0.4) continue;

                const pp = pE / 0.4;
                const pAlpha = (1 - pp) * 0.15;
                dctx.fillStyle = `rgba(${deathR},${deathG},${deathB},${pAlpha})`;
                dctx.fillRect(0, 0, VW, VH);
            }
        }

        // Gradual fade to black
        if (elapsed > 1.2) {
            const fadeP = Math.min(1, (elapsed - 1.2) / 1.0);
            dctx.fillStyle = `rgba(0,0,0,${fadeP * 0.15})`;
            dctx.fillRect(0, 0, VW, VH);
        }

        // Death message (centered on viewport)
        if (canRestart) {
            document.body.style.transform = '';
            const fontSize = Math.floor(Math.min(VW, VH) * 0.025);
            dctx.fillStyle = 'rgba(255,255,255,0.6)';
            dctx.font = `${fontSize}px "Courier New", monospace`;
            dctx.textAlign = 'center';
            const msg = deathType === 'wall'
                ? 'not a path \u2014 press any key'
                : deathType === 'white'
                ? 'too bright \u2014 press any key'
                : 'too dark \u2014 press any key';
            dctx.fillText(msg, VW / 2, VH / 2);
        }
    }

    // --- Win effect: full-viewport trippy celebration ---
    if (won) {
        const elapsed = (performance.now() - winTime) / 1000;
        const cx = VW / 2;
        const cy = VH / 2;
        const diag = Math.hypot(VW, VH);

        // Slow trail fade — keeps trails visible longer for trippy buildup
        dctx.fillStyle = 'rgba(0,0,0,0.045)';
        dctx.fillRect(0, 0, VW, VH);

        // Phase 1: Golden supernova flash (0–0.3s)
        if (elapsed < 0.3) {
            const p = elapsed / 0.3;
            const a = (1 - p) * 0.9;
            const grad = dctx.createRadialGradient(cx, cy, 0, cx, cy, diag * p * 0.5);
            grad.addColorStop(0, `rgba(255,240,180,${a})`);
            grad.addColorStop(0.4, `rgba(255,200,50,${a * 0.6})`);
            grad.addColorStop(1, `rgba(255,100,0,0)`);
            dctx.fillStyle = grad;
            dctx.fillRect(0, 0, VW, VH);
        }

        // Phase 2: Expanding golden rings (0–4s, looping feel)
        {
            const ringCount = 12;
            for (let i = 0; i < ringCount; i++) {
                const offset = i * 0.2;
                const cycle = ((elapsed - offset) % 3 + 3) % 3;
                const p = cycle / 3;
                const ringR = p * diag * 0.6;
                const ringA = (1 - p) * (1 - p) * 0.25;
                const hue = (elapsed * 30 + i * 30) % 360;
                const lw = (1 - p) * 4;

                dctx.strokeStyle = `hsla(${hue},90%,65%,${ringA})`;
                dctx.lineWidth = lw;
                dctx.beginPath();
                dctx.arc(cx, cy, Math.max(1, ringR), 0, Math.PI * 2);
                dctx.stroke();
            }
        }

        // Phase 3: Rotating kaleidoscope mandala (0.2s+)
        if (elapsed > 0.2) {
            const kT = elapsed - 0.2;
            const arms = 16;
            const layers = 5;
            const fadeIn = Math.min(1, kT / 1.5);

            for (let layer = 0; layer < layers; layer++) {
                const layerR = (0.15 + layer * 0.15) * diag * 0.4 * fadeIn;
                const rot = kT * (0.3 + layer * 0.15) * (layer % 2 === 0 ? 1 : -1);
                const hueBase = elapsed * 40 + layer * 60;

                for (let a = 0; a < arms; a++) {
                    const angle = rot + (a / arms) * Math.PI * 2;
                    const pulse = 0.7 + Math.sin(kT * 3 + a * 0.8 + layer) * 0.3;
                    const px = cx + Math.cos(angle) * layerR * pulse;
                    const py = cy + Math.sin(angle) * layerR * pulse;
                    const dotR = (4 + layer * 3) * fadeIn * pulse;
                    const hue = (hueBase + a * (360 / arms)) % 360;

                    dctx.fillStyle = `hsla(${hue},85%,65%,${0.35 * fadeIn * pulse})`;
                    dctx.beginPath();
                    dctx.arc(px, py, Math.max(1, dotR), 0, Math.PI * 2);
                    dctx.fill();

                    // Connect to center with faint lines
                    if (layer === 0) {
                        dctx.strokeStyle = `hsla(${hue},80%,60%,${0.06 * fadeIn})`;
                        dctx.lineWidth = 1;
                        dctx.beginPath();
                        dctx.moveTo(cx, cy);
                        dctx.lineTo(px, py);
                        dctx.stroke();
                    }
                }
            }
        }

        // Phase 4: Firework particle bursts (0.4s+)
        if (elapsed > 0.4) {
            const fT = elapsed - 0.4;
            const burstCount = 6;
            for (let b = 0; b < burstCount; b++) {
                const bStart = b * 0.5;
                const bE = fT - bStart;
                if (bE < 0) continue;
                const cycle = bE % 2.5;
                const p = cycle / 2.5;

                // Seeded random position per burst
                const seed = b * 7919;
                const bx = cx + Math.sin(seed) * VW * 0.3;
                const by = cy + Math.cos(seed * 1.3) * VH * 0.3;
                const particles = 20;

                for (let i = 0; i < particles; i++) {
                    const angle = (i / particles) * Math.PI * 2 + seed;
                    const speed = 0.5 + Math.sin(seed + i) * 0.3;
                    const dist = p * diag * 0.2 * speed;
                    const px = bx + Math.cos(angle) * dist;
                    const py = by + Math.sin(angle) * dist;
                    const pa = (1 - p) * (1 - p) * 0.5;
                    const pr = (1 - p) * 5;
                    const hue = (elapsed * 50 + b * 60 + i * 18) % 360;

                    dctx.fillStyle = `hsla(${hue},90%,70%,${pa})`;
                    dctx.beginPath();
                    dctx.arc(px, py, Math.max(0.5, pr), 0, Math.PI * 2);
                    dctx.fill();
                }
            }
        }

        // Phase 5: Aurora waves sweeping across screen (0.6s+)
        if (elapsed > 0.6) {
            const aT = elapsed - 0.6;
            const fadeIn = Math.min(1, aT / 2);
            const waveCount = 5;

            for (let w = 0; w < waveCount; w++) {
                const yBase = VH * (0.15 + w * 0.18);
                const hue = (elapsed * 25 + w * 70) % 360;
                const amp = VH * 0.08 * fadeIn;

                dctx.beginPath();
                dctx.moveTo(0, yBase);
                for (let x = 0; x <= VW; x += 8) {
                    const wave1 = Math.sin(x * 0.008 + aT * 1.5 + w * 1.2) * amp;
                    const wave2 = Math.sin(x * 0.015 + aT * 0.8 - w * 0.7) * amp * 0.5;
                    dctx.lineTo(x, yBase + wave1 + wave2);
                }
                dctx.lineTo(VW, VH);
                dctx.lineTo(0, VH);
                dctx.closePath();
                dctx.fillStyle = `hsla(${hue},80%,55%,${0.025 * fadeIn})`;
                dctx.fill();
            }
        }

        // Phase 6: Spiraling golden vortex at center (continuous)
        {
            const arms = 6;
            const pointsPerArm = 40;
            const spiralR = diag * 0.35;
            const fadeIn = Math.min(1, elapsed / 1.5);

            for (let a = 0; a < arms; a++) {
                const baseAngle = (a / arms) * Math.PI * 2;
                const hueStart = (elapsed * 35 + a * 60) % 360;

                for (let p = 0; p < pointsPerArm; p++) {
                    const frac = p / pointsPerArm;
                    const dist = frac * spiralR * fadeIn;
                    const angle = baseAngle + frac * Math.PI * 4 + elapsed * 1.2;
                    const wobble = Math.sin(elapsed * 2.5 + p * 0.4 + a) * dist * 0.06;
                    const px = cx + Math.cos(angle) * (dist + wobble);
                    const py = cy + Math.sin(angle) * (dist + wobble);
                    const pr = (1.5 + frac * 4) * fadeIn;
                    const pa = (1 - frac) * 0.3 * fadeIn;
                    const hue = (hueStart + frac * 120) % 360;

                    dctx.fillStyle = `hsla(${hue},85%,65%,${pa})`;
                    dctx.beginPath();
                    dctx.arc(px, py, Math.max(0.5, pr), 0, Math.PI * 2);
                    dctx.fill();
                }
            }
        }

        // Phase 7: Central golden core breathing
        {
            const breath = 0.6 + Math.sin(elapsed * 2.5) * 0.3;
            const coreR = Math.min(diag * 0.06, 60) * breath;
            const grad = dctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
            grad.addColorStop(0, `rgba(255,220,100,${breath * 0.4})`);
            grad.addColorStop(0.3, `rgba(255,180,50,${breath * 0.15})`);
            grad.addColorStop(1, 'rgba(255,150,0,0)');
            dctx.fillStyle = grad;
            dctx.beginPath();
            dctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
            dctx.fill();

            dctx.fillStyle = `rgba(255,240,200,${breath * 0.9})`;
            dctx.beginPath();
            dctx.arc(cx, cy, coreR, 0, Math.PI * 2);
            dctx.fill();
        }

        // Text (fades in after 1.5s)
        if (elapsed > 1.5) {
            const textAlpha = Math.min(1, (elapsed - 1.5) / 1.5);
            const fontSize = Math.floor(Math.min(VW, VH) * 0.06);

            dctx.textAlign = 'center';

            // Glowing text shadow
            dctx.shadowColor = `rgba(255,200,50,${textAlpha * 0.8})`;
            dctx.shadowBlur = 30;

            dctx.fillStyle = `rgba(255,220,100,${textAlpha})`;
            dctx.font = `bold ${fontSize}px "Courier New", monospace`;
            dctx.fillText('ESCAPED', cx, cy - fontSize * 0.3);

            dctx.shadowBlur = 15;
            dctx.font = `${Math.floor(fontSize * 0.45)}px "Courier New", monospace`;
            dctx.fillStyle = `rgba(255,255,255,${textAlpha * 0.7})`;
            dctx.fillText(`${attempts} attempt${attempts > 1 ? 's' : ''}`, cx, cy + fontSize * 0.5);

            dctx.font = `${Math.floor(fontSize * 0.3)}px "Courier New", monospace`;
            dctx.fillStyle = `rgba(255,255,255,${textAlpha * 0.3})`;
            dctx.fillText('reload for new maze', cx, cy + fontSize * 1.0);

            dctx.shadowColor = 'transparent';
            dctx.shadowBlur = 0;
        }
    }

    requestAnimationFrame(render);
}

// ========== INIT ==========
requestAnimationFrame(render);
