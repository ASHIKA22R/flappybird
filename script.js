// ─── roundRect polyfill (for browsers without native support) ───────────────
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
    const r = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
    const [tl=0, tr=0, br=0, bl=0] = r.length === 1 ? [r[0],r[0],r[0],r[0]]
      : r.length === 2 ? [r[0],r[1],r[0],r[1]]
      : r.length === 3 ? [r[0],r[1],r[2],r[1]] : r;
    this.beginPath();
    this.moveTo(x + tl, y);
    this.lineTo(x + w - tr, y);
    this.arcTo(x + w, y, x + w, y + tr, tr);
    this.lineTo(x + w, y + h - br);
    this.arcTo(x + w, y + h, x + w - br, y + h, br);
    this.lineTo(x + bl, y + h);
    this.arcTo(x, y + h, x, y + h - bl, bl);
    this.lineTo(x, y + tl);
    this.arcTo(x, y, x + tl, y, tl);
    this.closePath();
    return this;
  };
}

"use strict";

// ─── DOM ────────────────────────────────────────────────────────────────────
const canvas        = document.getElementById("game");
const ctx           = canvas.getContext("2d");
const scoreEl       = document.getElementById("score");
const bestEl        = document.getElementById("best");
const comboEl       = document.getElementById("combo");
const hudCombo      = document.getElementById("hud-combo");
const hudScore      = document.getElementById("hud-score");
const overlayStart  = document.getElementById("overlay-start");
const overlayGO     = document.getElementById("overlay-gameover");
const goScore       = document.getElementById("go-score");
const goBest        = document.getElementById("go-best");
const goEmoji       = document.getElementById("go-emoji");
const goTitle       = document.getElementById("go-title");
const achToast      = document.getElementById("achievement-toast");
const achText       = document.getElementById("achievement-text");
const achRibbon     = document.getElementById("achievement-ribbon");
const btnStart      = document.getElementById("btn-start");
const btnRestart    = document.getElementById("btn-restart");
const btnSound      = document.getElementById("btn-sound");
const btnResetBest  = document.getElementById("btn-reset-best");
const diffLabel     = document.getElementById("diff-label");
const popupsEl      = document.getElementById("popups");
const gameWrap      = document.getElementById("game-wrap");
const starsEl       = document.getElementById("stars");

// ─── CANVAS DIMENSIONS ──────────────────────────────────────────────────────
const W = canvas.width;   // 420
const H = canvas.height;  // 620
const GROUND_H = 72;

// ─── STATE ──────────────────────────────────────────────────────────────────
let bird, pipes, particles, score, best, combo, comboTimer;
let running, gameOver, frame, animationId;
let soundOn = true;
let achRibbonTimer = null;

// Persistent best
best = Number(localStorage.getItem("flappyBest") || 0);
bestEl.textContent = best;

// ─── ACHIEVEMENTS ───────────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: "first",      score: 1,   label: "First Pipe! 🎉",         emoji: "🎉" },
  { id: "five",       score: 5,   label: "Five Pipes! 🔥",          emoji: "🔥" },
  { id: "ten",        score: 10,  label: "10 Pipes! Skilled! ⚡",   emoji: "⚡" },
  { id: "twenty",     score: 20,  label: "20 Pipes! Insane! 🚀",    emoji: "🚀" },
  { id: "fifty",      score: 50,  label: "50 Pipes! Legendary! 🏆", emoji: "🏆" },
  { id: "hundred",    score: 100, label: "100 Pipes! GODLIKE! 👑",  emoji: "👑" },
];
let unlockedAchs = new Set(JSON.parse(localStorage.getItem("flappyAchs") || "[]"));

// ─── DIFFICULTY ──────────────────────────────────────────────────────────────
function getDifficulty() {
  // Simplified to only EASY difficulty for a slower, less aggressive game
  return { name: "EASY", cls: "", gap: 160, speed: 2.6, freq: 110 };
}
function updateDiffLabel() {
  const d = getDifficulty();
  diffLabel.textContent = d.name;
  diffLabel.className   = "diff-label " + d.cls;
}

// ─── STAR FIELD ──────────────────────────────────────────────────────────────
(function initStars() {
  for (let i = 0; i < 90; i++) {
    const s = document.createElement("div");
    s.className = "star";
    const size = Math.random() * 2.5 + 0.5;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      top:${Math.random()*100}%;
      --dur:${(Math.random()*3+1.5).toFixed(1)}s;
      --delay:${(Math.random()*3).toFixed(1)}s;
    `;
    starsEl.appendChild(s);
  }
})();

// ─── WEB AUDIO ───────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playTone(freq, type, duration, gainVal = 0.18, decay = true) {
  if (!soundOn) return;
  try {
    const ac  = getAudioCtx();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.connect(g);
    g.connect(ac.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    g.gain.setValueAtTime(gainVal, ac.currentTime);
    if (decay) g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  } catch(e) {}
}
function sfxFlap()   { playTone(320, "sine",     0.12, 0.15); }
function sfxScore()  {
  playTone(660, "sine",   0.08, 0.18);
  setTimeout(() => playTone(880, "sine", 0.1, 0.2), 80);
}
function sfxCombo(n) {
  const freq = 600 + n * 80;
  playTone(freq, "sine",   0.07, 0.22);
  setTimeout(() => playTone(freq * 1.5, "triangle", 0.1, 0.25), 60);
}
function sfxDie() {
  playTone(200, "sawtooth", 0.3, 0.35);
  setTimeout(() => playTone(120, "square", 0.5, 0.3), 80);
}

// ─── PARTICLES ───────────────────────────────────────────────────────────────
function spawnParticles(x, y, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.random() * Math.PI * 2);
    const speed = opts.speed || (Math.random() * 4 + 1);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed * (Math.random() * 0.8 + 0.6),
      vy: Math.sin(angle) * speed * (Math.random() * 0.8 + 0.6),
      life: 1,
      decay: opts.decay || (Math.random() * 0.03 + 0.02),
      radius: opts.radius || (Math.random() * 4 + 2),
      color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : "#facc15",
      gravity: opts.gravity !== undefined ? opts.gravity : 0.12,
    });
  }
}
function updateParticles() {
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.97;
    p.life -= p.decay;
  }
  particles = particles.filter(p => p.life > 0);
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ─── FLOATING POPUPS ─────────────────────────────────────────────────────────
function showPopup(text, x, y, cls = "") {
  const el = document.createElement("div");
  el.className = "popup" + (cls ? " " + cls : "");
  el.textContent = text;
  // Convert canvas coords to % for overlay positioning
  const rect = canvas.getBoundingClientRect();
  const px = (x / W) * 100;
  const py = (y / H) * 100;
  el.style.left = px + "%";
  el.style.top  = py + "%";
  el.style.transform = "translate(-50%, -50%)";
  popupsEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// ─── ACHIEVEMENT RIBBON ───────────────────────────────────────────────────────
function showRibbon(text) {
  achRibbon.textContent = text;
  achRibbon.classList.remove("hidden");
  if (achRibbonTimer) clearTimeout(achRibbonTimer);
  achRibbonTimer = setTimeout(() => achRibbon.classList.add("hidden"), 3000);
}
function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (!unlockedAchs.has(a.id) && score >= a.score) {
      unlockedAchs.add(a.id);
      localStorage.setItem("flappyAchs", JSON.stringify([...unlockedAchs]));
      showRibbon("🏅 Achievement: " + a.label);
    }
  }
}

// ─── HUD BUMP ─────────────────────────────────────────────────────────────────
function bumpHud(el) {
  el.classList.remove("bump");
  void el.offsetWidth; // reflow
  el.classList.add("bump");
  el.addEventListener("animationend", () => el.classList.remove("bump"), { once: true });
}

// ─── SCREEN SHAKE ─────────────────────────────────────────────────────────────
function triggerShake() {
  gameWrap.classList.remove("shake");
  void gameWrap.offsetWidth;
  gameWrap.classList.add("shake");
  gameWrap.addEventListener("animationend", () => gameWrap.classList.remove("shake"), { once: true });
}

// ─── PARALLAX LAYERS ─────────────────────────────────────────────────────────
// Clouds array — each cloud moves at a different rate
const CLOUD_DATA = [
  { x: 60,  y: 70,  r: 1.0,  speed: 0.4  },
  { x: 200, y: 100, r: 0.8,  speed: 0.25 },
  { x: 330, y: 55,  r: 1.2,  speed: 0.55 },
  { x: 420, y: 90,  r: 0.9,  speed: 0.35 },
  { x: 520, y: 130, r: 0.7,  speed: 0.20 },
];

// ─── GAME RESET ──────────────────────────────────────────────────────────────
function resetGame() {
  bird = {
    x: 100,
    y: H * 0.40,
    radius: 15,
    velocity: 0,
    rotation: 0,
    wingAngle: 0,
    wingDir: 1,
    flapping: false,
    flapTimer: 0,
  };
  pipes = [];
  particles = [];
  score = 0;
  combo = 0;
  comboTimer = 0;
  frame = 0;
  running = false;
  gameOver = false;
  scoreEl.textContent = 0;
  hudCombo.classList.add("hidden");
  updateDiffLabel();
  addPipe(W + 40);
  draw();
}

// ─── PIPE FACTORY ─────────────────────────────────────────────────────────────
function addPipe(x = W + 20) {
  const d = getDifficulty();
  const gap = d.gap;
  const margin = 70;
  const topH = margin + Math.random() * (H - GROUND_H - gap - margin * 2);
  pipes.push({ x, width: 64, top: topH, gap, passed: false, color: pickPipeColor() });
}
function pickPipeColor() {
  // Cycle through pipe color themes based on score
  const themes = [
    { body: "#16a34a", cap: "#22c55e", shade: "#15803d" },
    { body: "#1d4ed8", cap: "#3b82f6", shade: "#1e40af" },
    { body: "#7e22ce", cap: "#a855f7", shade: "#6b21a8" },
    { body: "#b91c1c", cap: "#ef4444", shade: "#991b1b" },
  ];
  return themes[Math.floor(score / 15) % themes.length];
}

// ─── FLAP ─────────────────────────────────────────────────────────────────────
function flap() {
  if (gameOver) return;
  if (!running) {
    running = true;
    overlayStart.classList.add("hidden");
  }
  bird.velocity = -7.2;
  bird.flapping = true;
  bird.flapTimer = 8;
  sfxFlap();
  // Small flap particles
  spawnParticles(bird.x - 8, bird.y + 8, 6, {
    speed: 2, decay: 0.07, radius: 2.5, gravity: 0.05,
    colors: ["#fef08a", "#fde047", "#facc15"],
  });
}

// ─── GAME OVER ────────────────────────────────────────────────────────────────
function endGame() {
  if (gameOver) return;
  running   = false;
  gameOver  = true;
  sfxDie();
  triggerShake();

  // Death particles (sparks)
  spawnParticles(bird.x, bird.y, 35, {
    speed: 5, decay: 0.025, radius: 5,
    colors: ["#facc15", "#fb923c", "#ef4444", "#fff", "#fde68a"],
    gravity: 0.2,
  });

  // Update best
  if (score > best) {
    best = score;
    bestEl.textContent = best;
    localStorage.setItem("flappyBest", String(best));
    goTitle.textContent = "New Best! 🎉";
    goEmoji.textContent = "🏆";
  } else {
    goTitle.textContent = "Game Over!";
    goEmoji.textContent = "💥";
  }

  goScore.textContent = score;
  goBest.textContent  = best;

  // Achievement toast on game-over overlay
  const latest = ACHIEVEMENTS.slice().reverse().find(a => unlockedAchs.has(a.id));
  if (latest) {
    achText.textContent = latest.label;
    achToast.classList.remove("hidden");
  } else {
    achToast.classList.add("hidden");
  }

  overlayGO.classList.remove("hidden");
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────
function update() {
  frame++;
  const d = getDifficulty();

  // Bird physics
  bird.velocity += 0.2; // reduced gravity for slower fall
  bird.y        += bird.velocity;
  bird.rotation  = Math.min(Math.PI / 2.8, Math.max(-0.5, bird.velocity * 0.075));

  // Wing animation
  if (bird.flapTimer > 0) {
    bird.flapTimer--;
    bird.wingAngle += bird.wingDir * 0.35;
    if (Math.abs(bird.wingAngle) > 0.7) bird.wingDir *= -1;
  } else {
    bird.wingAngle += bird.wingDir * 0.06;
    if (Math.abs(bird.wingAngle) > 0.2) bird.wingDir *= -1;
  }

  // Spawn pipes
  if (frame % d.freq === 0) addPipe();

  // Combo timer decay
  if (comboTimer > 0) comboTimer--;
  if (comboTimer === 0 && combo > 0) {
    combo = 0;
    hudCombo.classList.add("hidden");
  }

  // Pipe logic
  for (const p of pipes) {
    p.x -= d.speed;

    if (!p.passed && p.x + p.width < bird.x) {
      p.passed = true;
      score++;
      combo++;
      comboTimer = 90; // frames to keep combo alive

      const pts = combo >= 5 ? combo : 1;
      scoreEl.textContent = score;
      bumpHud(hudScore);
      updateDiffLabel();
      checkAchievements();
      sfxScore();

      // Floating popup
      const px = p.x + p.width / 2;
      showPopup(combo >= 3 ? `x${combo} 🔥` : `+1`, px, p.top + p.gap / 2, combo >= 3 ? "combo" : "");

      // Score coins
      spawnParticles(bird.x, bird.y, combo >= 3 ? 18 : 8, {
        speed: 3.5, decay: 0.035, radius: 4,
        colors: combo >= 3
          ? ["#f472b6", "#e879f9", "#c084fc", "#ffffff"]
          : ["#facc15", "#fde68a", "#fbbf24"],
        gravity: -0.05,
      });

      if (combo >= 3) {
        sfxCombo(combo);
        comboEl.textContent = "x" + combo;
        hudCombo.classList.remove("hidden");
        bumpHud(hudCombo);
      }

      if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem("flappyBest", String(best));
        bumpHud(document.getElementById("hud-best"));
      }
    }

    // Collision
    const ox = bird.x + bird.radius > p.x && bird.x - bird.radius < p.x + p.width;
    if (ox && (bird.y - bird.radius < p.top || bird.y + bird.radius > p.top + p.gap)) {
      endGame();
    }
  }

  // Cull off-screen pipes
  pipes = pipes.filter(p => p.x + p.width > -10);

  // Ground / ceiling
  if (bird.y - bird.radius < 0 || bird.y + bird.radius > H - GROUND_H) endGame();

  updateParticles();

  // Animate clouds
  for (const c of CLOUD_DATA) {
    c.x -= c.speed;
    if (c.x + 90 < 0) c.x = W + 60 + Math.random() * 100;
  }
}

// ─── DRAW HELPERS ─────────────────────────────────────────────────────────────

/* Sky gradient shifts from day to dusk to night as score rises */
function skyColor() {
  if (score < 10)  return { top: "#38bdf8", bot: "#bae6fd" };
  if (score < 20)  return { top: "#fb923c", bot: "#fde68a" }; // sunset
  if (score < 35)  return { top: "#7c3aed", bot: "#c4b5fd" }; // dusk
  return               { top: "#0f172a", bot: "#1e3a8a" }; // night
}

function drawBackground() {
  const sk = skyColor();
  const grad = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
  grad.addColorStop(0, sk.top);
  grad.addColorStop(1, sk.bot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Stars visible at night
  if (score >= 20) {
    const alpha = Math.min(1, (score - 20) / 15) * 0.6;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    for (let i = 0; i < 40; i++) {
      // deterministic positions via seed
      const sx = ((i * 137 + 7)  % W);
      const sy = ((i * 97  + 13) % (H * 0.5));
      const sr = i % 5 === 0 ? 1.5 : 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Clouds
  ctx.fillStyle = score >= 35
    ? "rgba(200,200,255,0.15)"
    : "rgba(255,255,255,0.78)";
  for (const c of CLOUD_DATA) {
    const scale = c.r;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0,   0,  22, 0, Math.PI * 2);
    ctx.arc(28, -10, 28, 0, Math.PI * 2);
    ctx.arc(58,   0, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Distant hills (parallax at 50% speed)
  const hillOff = (frame * 1.3) % (W * 2);
  const hillColor = score >= 35 ? "#1e3a8a" : score >= 20 ? "#7e22ce" : "#4ade80";
  ctx.fillStyle = hillColor;
  for (let hx = -hillOff; hx < W + 200; hx += 200) {
    ctx.beginPath();
    ctx.moveTo(hx, H - GROUND_H);
    ctx.quadraticCurveTo(hx + 65, H - GROUND_H - 90, hx + 130, H - GROUND_H);
    ctx.fill();
  }

  // City silhouette at night
  if (score >= 20) {
    const cityAlpha = Math.min(1, (score - 20) / 10) * 0.5;
    ctx.fillStyle = `rgba(15,23,42,${cityAlpha})`;
    const cityOff = (frame * 0.9) % 160;
    const buildings = [[0,70],[20,50],[40,80],[60,45],[80,65],[100,55],[120,75],[140,40]];
    for (let bx = -cityOff; bx < W + 160; bx += 160) {
      for (const [ox, oh] of buildings) {
        ctx.fillRect(bx + ox, H - GROUND_H - oh, 18, oh);
        // windows
        ctx.fillStyle = `rgba(250,204,21,${cityAlpha * 0.6})`;
        for (let wy = 0; wy < oh - 10; wy += 14) {
          ctx.fillRect(bx + ox + 4, H - GROUND_H - oh + wy + 4, 4, 6);
          ctx.fillRect(bx + ox + 11, H - GROUND_H - oh + wy + 4, 4, 6);
        }
        ctx.fillStyle = `rgba(15,23,42,${cityAlpha})`;
      }
    }
  }
}

function drawPipes() {
  for (const p of pipes) {
    const c = p.color;
    const bY = p.top + p.gap;

    // Draw pipe body (top)
    ctx.fillStyle = c.body;
    ctx.fillRect(p.x, 0, p.width, p.top - 18);
    // Draw pipe body (bottom)
    ctx.fillRect(p.x, bY + 18, p.width, H - GROUND_H - bY);

    // Caps
    ctx.fillStyle = c.cap;
    ctx.beginPath();
    ctx.roundRect(p.x - 6, p.top - 18, p.width + 12, 18, [0, 0, 4, 4]);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(p.x - 6, bY, p.width + 12, 18, [4, 4, 0, 0]);
    ctx.fill();

    // Shade stripe
    ctx.fillStyle = c.shade;
    ctx.fillRect(p.x + p.width - 10, 0, 10, p.top - 18);
    ctx.fillRect(p.x + p.width - 10, bY + 18, 10, H - GROUND_H - bY);

    // Highlight stripe
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(p.x + 4, 0, 5, p.top - 18);
    ctx.fillRect(p.x + 4, bY + 18, 5, H - GROUND_H - bY);
  }
}

function drawBird() {
  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate(bird.rotation);

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(3, 18, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail feathers
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.lineTo(-26, -5);
  ctx.lineTo(-22, 4);
  ctx.lineTo(-27, 8);
  ctx.lineTo(-14, 6);
  ctx.closePath();
  ctx.fill();

  // Body
  const bodyGrad = ctx.createRadialGradient(-3, -4, 2, 0, 0, 17);
  bodyGrad.addColorStop(0, "#fef08a");
  bodyGrad.addColorStop(1, "#f59e0b");
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = "#92400e";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Wing (animated)
  ctx.save();
  ctx.rotate(bird.wingAngle);
  ctx.fillStyle = "#fde047";
  ctx.strokeStyle = "#a16207";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(-4, 5, 10, 6, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Eye white
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(8, -5, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Iris
  const irisGrad = ctx.createRadialGradient(9.5, -5.5, 0, 9.5, -5.5, 3.5);
  irisGrad.addColorStop(0, "#3b82f6");
  irisGrad.addColorStop(1, "#1e3a8a");
  ctx.fillStyle = irisGrad;
  ctx.beginPath();
  ctx.arc(9.5, -5.5, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(10, -6, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Eye shine
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.arc(8.5, -7, 1, 0, Math.PI * 2);
  ctx.fill();

  // Beak
  ctx.fillStyle = "#fb923c";
  ctx.strokeStyle = "#c2410c";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(14, -1);
  ctx.lineTo(26, 3);
  ctx.lineTo(26, 7);
  ctx.lineTo(14, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Beak midline
  ctx.strokeStyle = "#ea580c";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(14, 2.5);
  ctx.lineTo(26, 5);
  ctx.stroke();

  // Cheek blush
  ctx.fillStyle = "rgba(252,129,74,0.35)";
  ctx.beginPath();
  ctx.ellipse(6, 4, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGround() {
  // Grass strip
  ctx.fillStyle = score >= 35 ? "#312e81" : score >= 20 ? "#581c87" : "#4ade80";
  ctx.fillRect(0, H - GROUND_H, W, 16);

  // Dirt
  ctx.fillStyle = score >= 35 ? "#1e1b4b" : "#854d0e";
  ctx.fillRect(0, H - GROUND_H + 16, W, GROUND_H - 16);

  // Scrolling dirt tiles
  const tileOffset = -((frame * getDifficulty().speed) % 36);
  ctx.fillStyle = score >= 35 ? "#2d1f6e" : "#a16207";
  for (let x = tileOffset; x < W + 36; x += 36) {
    ctx.beginPath();
    ctx.roundRect(x + 2, H - GROUND_H + 30, 22, 10, 3);
    ctx.fill();
  }

  // Top edge highlight
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, H - GROUND_H, W, 2);
}

function drawScoreOnCanvas() {
  if (!running && !gameOver) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 18px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Tap or press Space to fly!", W / 2, H / 2 + 40);
  }
}

function draw() {
  drawBackground();
  drawPipes();
  drawGround();
  drawParticles();
  drawBird();
  drawScoreOnCanvas();
}

// ─── GAME LOOP ────────────────────────────────────────────────────────────────
function loop() {
  if (running) update();
  else if (gameOver) updateParticles(); // keep death particles running
  draw();
  animationId = requestAnimationFrame(loop);
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
btnStart.addEventListener("click", () => {
  flap();
});

btnRestart.addEventListener("click", () => {
  overlayGO.classList.add("hidden");
  resetGame();
  // Auto-start on restart
  flap();
});

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  flap();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    if (gameOver) {
      overlayGO.classList.add("hidden");
      resetGame();
    }
    flap();
  }
});

btnSound.addEventListener("click", () => {
  soundOn = !soundOn;
  btnSound.textContent = soundOn ? "🔊" : "🔇";
  btnSound.title = soundOn ? "Sound On" : "Sound Off";
});

btnResetBest.addEventListener("click", () => {
  if (confirm("Reset best score?")) {
    best = 0;
    localStorage.removeItem("flappyBest");
    bestEl.textContent = 0;
    goBest.textContent = 0;
    // Also reset achievements
    unlockedAchs.clear();
    localStorage.removeItem("flappyAchs");
    showRibbon("🗑️ Best score & achievements reset!");
  }
});

// Prevent scroll on spacebar
window.addEventListener("keydown", e => {
  if (["Space","ArrowUp","ArrowDown"].includes(e.code)) e.preventDefault();
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
resetGame();
loop();
