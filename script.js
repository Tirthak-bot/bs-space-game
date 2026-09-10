/* =====================================================================
   STELLAR SIEGE — script.js
   A self-contained vanilla-JS space shooter rendered on a <canvas>,
   with an HTML/CSS overlay for menus, HUD and touch controls.

   Sections in this file:
     1. Canvas + DPI setup
     2. Utility helpers
     3. Audio manager (Web Audio API synth sounds — no audio files)
     4. Starfield background
     5. Entity classes: Player, Bullet, Enemy, PowerUp, Particle
     6. Game state + constants
     7. Input handling (keyboard + touch)
     8. Spawning & difficulty scaling
     9. Collision detection
    10. UI / HUD updates
    11. Main update + draw loop
    12. State transitions (start / pause / resume / restart / game over)
    13. Event wiring
   ===================================================================== */

/* --------------------------------------------------------------------
   1. CANVAS + DPI SETUP
   -------------------------------------------------------------------- */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('game-container');

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = 0, H = 0; // logical (CSS) pixel dimensions of the play area

function resizeCanvas() {
  const rect = container.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildStars(); // re-scatter stars to fit new dimensions
}
window.addEventListener('resize', resizeCanvas);

/* --------------------------------------------------------------------
   2. UTILITY HELPERS
   -------------------------------------------------------------------- */
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist2 = (x1, y1, x2, y2) => (x1 - x2) ** 2 + (y1 - y2) ** 2;
const circlesHit = (x1, y1, r1, x2, y2, r2) => dist2(x1, y1, x2, y2) <= (r1 + r2) ** 2;

// localStorage can throw in private-browsing / storage-blocked contexts —
// fall back to an in-memory value so the game still runs.
let _memoryHighScore = 0;
function loadHighScore() {
  try {
    return Number(localStorage.getItem('stellarSiege_highScore') || 0);
  } catch (e) {
    return _memoryHighScore;
  }
}
function saveHighScore(value) {
  _memoryHighScore = value;
  try {
    localStorage.setItem('stellarSiege_highScore', String(value));
  } catch (e) { /* ignore — storage unavailable */ }
}

/* --------------------------------------------------------------------
   3. AUDIO MANAGER — synthesized sound effects, no external files
   -------------------------------------------------------------------- */
const Audio2 = {
  ctx: null,
  muted: false,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // simple gain-enveloped oscillator tone
  tone(freq, duration, type = 'square', startGain = 0.15, freqEnd = null) {
    if (this.muted) return;
    const ac = this.ensure();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), ac.currentTime + duration);
    }
    gain.gain.setValueAtTime(startGain, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + duration + 0.02);
  },
  shoot() {
    this.tone(880, 0.09, 'square', 0.06, 340);
  },
  explosion() {
    if (this.muted) return;
    // white-noise burst run through a lowpass filter for a "boom"
    const ac = this.ensure();
    const bufferSize = ac.sampleRate * 0.35;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, ac.currentTime);
    filter.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.3);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.35, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start();
  },
  powerup() {
    // short rising arpeggio
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'triangle', 0.12), i * 60));
  },
  hit() {
    this.tone(180, 0.12, 'sawtooth', 0.12, 60);
  },
  gameOver() {
    const notes = [392, 349, 293, 220];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.14), i * 180));
  },
  levelUp() {
    const notes = [660, 880, 1108];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.1), i * 90));
  }
};

/* --------------------------------------------------------------------
   4. STARFIELD — three parallax layers of twinkling stars
   -------------------------------------------------------------------- */
let stars = [];
function buildStars() {
  stars = [];
  const density = (W * H) / 9000; // scales with screen size
  for (let i = 0; i < density; i++) {
    const layer = randInt(1, 3); // 1 = far/slow, 3 = near/fast
    stars.push({
      x: rand(0, W),
      y: rand(0, H),
      r: layer * 0.55,
      speed: layer * 18,
      phase: rand(0, Math.PI * 2),
      layer
    });
  }
}
function updateStars(dt) {
  for (const s of stars) {
    s.y += s.speed * dt;
    s.phase += dt * 2;
    if (s.y > H) { s.y = -2; s.x = rand(0, W); }
  }
}
function drawStars() {
  for (const s of stars) {
    const twinkle = 0.55 + Math.sin(s.phase) * 0.35;
    ctx.globalAlpha = clamp(twinkle, 0.15, 1);
    ctx.fillStyle = s.layer === 3 ? '#dff6ff' : (s.layer === 2 ? '#9fb8ff' : '#6c7fbf');
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* --------------------------------------------------------------------
   6. GAME STATE + CONSTANTS  (placed before entity classes that read it)
   -------------------------------------------------------------------- */
const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

const game = {
  state: STATE.START,
  score: 0,
  highScore: loadHighScore(),
  level: 1,
  health: 100,
  maxHealth: 100,
  lastTime: 0,
  spawnTimer: 0,
  spawnInterval: 1.35,   // seconds between enemy spawns, shrinks with level
  difficultyScore: 0,    // score counter used to trigger level-ups
  shakeTime: 0,
  shakeMag: 0,
  activePowerups: {},     // { rapidfire: secondsLeft, shield: secondsLeft, doublescore: secondsLeft }
  combo: 0,               // consecutive kills without taking a hit
  comboTimer: 0,          // seconds left before an idle combo decays
  toastTimer: 0,          // seconds left to show the level-up toast
  toastText: ''
};
const COMBO_WINDOW = 3;   // seconds of no kills before combo resets
function comboMultiplier() {
  // +10% score per combo step, capped at 2x so it stays sane
  return clamp(1 + game.combo * 0.1, 1, 2);
}

const bullets = [];      // player bullets
const enemyBullets = [];
const enemies = [];
const powerups = [];
const particles = [];

const keys = {}; // currently-held keyboard keys

/* Enemy type definitions — unlocked progressively by level */
const ENEMY_TYPES = {
  scout:       { hp: 1,  speed: [110, 160], points: 10,  radius: 14, color: '#ff5c7a', minLevel: 1, shoots: false },
  fighter:     { hp: 2,  speed: [80, 120],  points: 20,  radius: 18, color: '#ffab3d', minLevel: 2, shoots: true,  fireChance: 0.006 },
  cruiser:     { hp: 4,  speed: [50, 80],   points: 40,  radius: 24, color: '#b25cff', minLevel: 3, shoots: true,  fireChance: 0.010 },
  bomber:      { hp: 8,  speed: [30, 50],   points: 80,  radius: 32, color: '#ff3df0', minLevel: 4, shoots: true,  fireChance: 0.016 },
  interceptor: { hp: 3,  speed: [160, 220], points: 60,  radius: 16, color: '#39ff88', minLevel: 6, shoots: true,  fireChance: 0.020 },
  dreadnought: { hp: 16, speed: [22, 35],   points: 150, radius: 40, color: '#ffd23d', minLevel: 8, shoots: true,  fireChance: 0.022 }
};

const POWERUP_TYPES = {
  rapidfire:   { color: '#4deeff', label: 'RAPID FIRE', duration: 8 },
  shield:      { color: '#39ff88', label: 'SHIELD',      duration: 8 },
  doublescore: { color: '#ffd23d', label: 'DOUBLE SCORE', duration: 8 }
};

/* --------------------------------------------------------------------
   5. ENTITY CLASSES
   -------------------------------------------------------------------- */
class Player {
  constructor() {
    this.w = 46; this.h = 46;
    this.radius = 18; // for circular collision
    this.speed = 380;
    this.reset();
  }
  reset() {
    this.x = W / 2;
    this.y = H - 80;
    this.cooldown = 0;
    this.baseFireDelay = 0.28;
    this.thrusterPhase = 0;
    this.invulnTime = 0.6; // brief spawn invulnerability
  }
  update(dt) {
    let dx = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D']) dx += 1;
    if (touchState.left) dx -= 1;
    if (touchState.right) dx += 1;
    this.x = clamp(this.x + dx * this.speed * dt, this.w / 2, W - this.w / 2);

    this.thrusterPhase += dt * 14;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnTime > 0) this.invulnTime -= dt;

    const wantsFire = keys[' '] || keys['Spacebar'] || touchState.fire;
    if (wantsFire && this.cooldown <= 0) this.fire();
  }
  fire() {
    const rapid = game.activePowerups.rapidfire > 0;
    this.cooldown = rapid ? this.baseFireDelay * 0.32 : this.baseFireDelay;
    bullets.push(new Bullet(this.x, this.y - this.h / 2, -620, '#4deeff'));
    if (rapid) {
      // rapid fire adds two angled side bolts for a fuller volley
      bullets.push(new Bullet(this.x - 12, this.y - this.h / 2 + 6, -600, '#4deeff', -60));
      bullets.push(new Bullet(this.x + 12, this.y - this.h / 2 + 6, -600, '#4deeff', 60));
    }
    Audio2.shoot();
  }
  draw() {
    const shielded = game.activePowerups.shield > 0;
    // flicker visibility while briefly invulnerable (spawn / post-hit grace period)
    if (this.invulnTime > 0 && Math.floor(this.invulnTime * 14) % 2 === 0) return;
    ctx.save();
    ctx.translate(this.x, this.y);

    // engine thruster glow
    const flick = 6 + Math.sin(this.thrusterPhase) * 3;
    const grad = ctx.createRadialGradient(0, this.h / 2 - 2, 0, 0, this.h / 2 + flick, flick + 6);
    grad.addColorStop(0, 'rgba(77,238,255,0.9)');
    grad.addColorStop(1, 'rgba(77,238,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, this.h / 2 - 4, 9, flick + 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // ship body (glowing triangle w/ wings)
    ctx.shadowColor = '#4deeff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#0f1830';
    ctx.strokeStyle = '#4deeff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -this.h / 2);
    ctx.lineTo(this.w / 2, this.h / 2 - 6);
    ctx.lineTo(this.w / 4, this.h / 2 - 14);
    ctx.lineTo(0, this.h / 2 - 6);
    ctx.lineTo(-this.w / 4, this.h / 2 - 14);
    ctx.lineTo(-this.w / 2, this.h / 2 - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ff3df0';
    ctx.shadowColor = '#ff3df0';
    ctx.beginPath();
    ctx.arc(0, -2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (shielded) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.strokeStyle = 'rgba(57,255,136,0.85)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#39ff88';
      ctx.shadowBlur = 14;
      const pulse = 30 + Math.sin(performance.now() / 150) * 3;
      ctx.beginPath();
      ctx.arc(0, 0, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

class Bullet {
  constructor(x, y, vy, color, angleDeg = 0) {
    this.x = x; this.y = y;
    const rad = (angleDeg * Math.PI) / 180;
    this.vx = Math.sin(rad) * Math.abs(vy) * 0.5;
    this.vy = vy;
    this.color = color;
    this.radius = 4;
    this.dead = false;
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y < -20 || this.y > H + 20 || this.x < -20 || this.x > W + 20) this.dead = true;
  }
  draw() {
    ctx.save();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.ellipse(this.x, this.y, 2.6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

class Enemy {
  constructor(typeKey) {
    const def = ENEMY_TYPES[typeKey];
    this.type = typeKey;
    this.def = def;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.radius = def.radius;
    this.x = rand(def.radius, W - def.radius);
    this.y = -def.radius - 10;
    this.speed = rand(def.speed[0], def.speed[1]) * (1 + (game.level - 1) * 0.045);
    this.color = def.color;
    this.wobble = rand(0, Math.PI * 2);
    this.wobbleSpeed = rand(1, 2.2);
    this.dead = false;
    this.hitFlash = 0;
  }
  update(dt) {
    this.y += this.speed * dt;
    this.wobble += dt * this.wobbleSpeed;
    this.x += Math.sin(this.wobble) * 22 * dt;
    this.x = clamp(this.x, this.radius, W - this.radius);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.def.shoots && game.state === STATE.PLAYING && Math.random() < this.def.fireChance) {
      enemyBullets.push(new Bullet(this.x, this.y + this.radius, 260, '#ff5c7a'));
    }

    if (this.y - this.radius > H) {
      // enemy reached the bottom unimpeded — damages the player
      this.dead = true;
      damagePlayer(this.def.hp * 4 + 6);
      spawnHitShake();
    }
  }
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.shadowColor = this.color;
    ctx.shadowBlur = this.hitFlash > 0 ? 26 : 14;
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : '#120a24';
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2.4;

    // hexagon-ish alien hull, size scales with radius
    const r = this.radius;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r * 0.85;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // mini health bar for tougher enemies
    if (this.maxHp > 1) {
      const bw = r * 1.8;
      const pct = this.hp / this.maxHp;
      ctx.save();
      ctx.translate(this.x - bw / 2, this.y - r - 10);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, bw, 4);
      ctx.fillStyle = pct > 0.4 ? '#39ff88' : '#ff5c7a';
      ctx.fillRect(0, 0, bw * pct, 4);
      ctx.restore();
    }
  }
  hit(dmg) {
    this.hp -= dmg;
    this.hitFlash = 0.08;
    if (this.hp <= 0) this.dead = true;
  }
}

class PowerUp {
  constructor(x, y, typeKey) {
    this.x = x; this.y = y;
    this.type = typeKey;
    this.def = POWERUP_TYPES[typeKey];
    this.radius = 15;
    this.vy = 90;
    this.phase = rand(0, Math.PI * 2);
    this.dead = false;
  }
  update(dt) {
    this.y += this.vy * dt;
    this.phase += dt * 4;
    if (this.y > H + 20) this.dead = true;
  }
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y + Math.sin(this.phase) * 4);
    ctx.shadowColor = this.def.color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = this.def.color;
    ctx.fillStyle = 'rgba(10,8,20,0.75)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.def.color;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = this.type === 'rapidfire' ? '⚡' : (this.type === 'shield' ? '🛡' : '★');
    ctx.fillText(glyph, 0, 1);
    ctx.restore();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y;
    const a = rand(0, Math.PI * 2);
    const speed = rand(40, 220);
    this.vx = Math.cos(a) * speed;
    this.vy = Math.sin(a) * speed;
    this.life = rand(0.3, 0.7);
    this.maxLife = this.life;
    this.color = color;
    this.size = rand(1.5, 3.5);
  }
  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.95; this.vy *= 0.95;
    this.life -= dt;
  }
  draw() {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * t + 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function spawnExplosion(x, y, color, count = 18) {
  for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
  Audio2.explosion();
}

function spawnHitShake() {
  game.shakeTime = 0.25;
  game.shakeMag = 8;
}

let player = new Player();

/* --------------------------------------------------------------------
   7. INPUT HANDLING — keyboard + touch
   -------------------------------------------------------------------- */
window.addEventListener('keydown', (e) => {
  keys[e.key] = true;
  if (e.key === ' ') e.preventDefault();
  if ((e.key === 'p' || e.key === 'P') && (game.state === STATE.PLAYING || game.state === STATE.PAUSED)) {
    togglePause();
  }
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

const touchState = { left: false, right: false, fire: false };
function bindTouchButton(el, stateKey) {
  const down = (e) => { e.preventDefault(); touchState[stateKey] = true; };
  const up = (e) => { e.preventDefault(); touchState[stateKey] = false; };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  // mouse fallback so it's testable on desktop too
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}
bindTouchButton(document.getElementById('touch-left'), 'left');
bindTouchButton(document.getElementById('touch-right'), 'right');
bindTouchButton(document.getElementById('touch-fire'), 'fire');

// Reveal the touch control layer on touch-capable devices
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.getElementById('touch-controls').classList.add('enabled');
}

/* --------------------------------------------------------------------
   8. SPAWNING & DIFFICULTY SCALING
   -------------------------------------------------------------------- */
function pickEnemyType() {
  const available = Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].minLevel <= game.level);
  // weight earlier (weaker) types more heavily so the field isn't all tanks
  const weights = available.map((k, i) => available.length - i);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand(0, total);
  for (let i = 0; i < available.length; i++) {
    if (r < weights[i]) return available[i];
    r -= weights[i];
  }
  return available[0];
}

function spawnEnemy() {
  enemies.push(new Enemy(pickEnemyType()));
}

function maybeDropPowerup(x, y) {
  if (Math.random() < 0.16) {
    const keysArr = Object.keys(POWERUP_TYPES);
    const type = keysArr[randInt(0, keysArr.length - 1)];
    powerups.push(new PowerUp(x, y, type));
  }
}

function updateDifficulty() {
  const newLevel = 1 + Math.floor(game.score / 250);
  if (newLevel !== game.level) {
    game.level = newLevel;
    Audio2.levelUp();
    game.toastText = `LEVEL ${game.level}`;
    game.toastTimer = 1.6;
  }
  game.spawnInterval = clamp(1.35 - (game.level - 1) * 0.09, 0.3, 1.35);
}

/* --------------------------------------------------------------------
   9. COLLISION DETECTION
   -------------------------------------------------------------------- */
function damagePlayer(amount) {
  if (game.activePowerups.shield > 0) return; // shield absorbs all damage
  if (player.invulnTime > 0) return;          // brief post-hit grace period
  game.health = clamp(game.health - amount, 0, game.maxHealth);
  game.combo = 0;
  game.comboTimer = 0;
  spawnHitShake();
  Audio2.hit();
  player.invulnTime = 1.1; // grace period so a cluster of bullets/enemies can't chain-kill in one frame
  if (game.health <= 0) endGame();
}

function checkCollisions() {
  // player bullets vs enemies
  for (const b of bullets) {
    if (b.dead) continue;
    for (const en of enemies) {
      if (en.dead) continue;
      if (circlesHit(b.x, b.y, b.radius, en.x, en.y, en.radius)) {
        b.dead = true;
        en.hit(1);
        if (en.dead) {
          game.combo += 1;
          game.comboTimer = COMBO_WINDOW;
          const scoreMult = (game.activePowerups.doublescore > 0 ? 2 : 1) * comboMultiplier();
          game.score += Math.round(en.def.points * scoreMult);
          spawnExplosion(en.x, en.y, en.color);
          maybeDropPowerup(en.x, en.y);
        }
        break;
      }
    }
  }

  // enemy bullets vs player
  for (const eb of enemyBullets) {
    if (eb.dead) continue;
    if (player.invulnTime <= 0 && circlesHit(eb.x, eb.y, eb.radius, player.x, player.y, player.radius)) {
      eb.dead = true;
      damagePlayer(8);
    }
  }

  // enemies vs player (direct collision)
  for (const en of enemies) {
    if (en.dead) continue;
    if (player.invulnTime <= 0 && circlesHit(en.x, en.y, en.radius, player.x, player.y, player.radius)) {
      en.dead = true;
      spawnExplosion(en.x, en.y, en.color);
      damagePlayer(en.def.hp * 5 + 10);
    }
  }

  // player vs powerups
  for (const p of powerups) {
    if (p.dead) continue;
    if (circlesHit(p.x, p.y, p.radius, player.x, player.y, player.radius)) {
      p.dead = true;
      game.activePowerups[p.type] = p.def.duration;
      Audio2.powerup();
    }
  }
}

/* --------------------------------------------------------------------
   10. UI / HUD UPDATES
   -------------------------------------------------------------------- */
const el = {
  hud: document.getElementById('hud'),
  pauseBtn: document.getElementById('pause-btn'),
  muteBtn: document.getElementById('mute-btn'),
  comboDisplay: document.getElementById('combo-display'),
  levelToast: document.getElementById('level-toast'),
  scoreValue: document.getElementById('score-value'),
  highscoreValue: document.getElementById('highscore-value'),
  levelValue: document.getElementById('level-value'),
  healthInner: document.getElementById('health-bar-inner'),
  healthText: document.getElementById('health-text'),
  activePowerups: document.getElementById('active-powerups'),
  startScreen: document.getElementById('start-screen'),
  startHighscore: document.getElementById('start-highscore'),
  startBtn: document.getElementById('start-btn'),
  pauseScreen: document.getElementById('pause-screen'),
  resumeBtn: document.getElementById('resume-btn'),
  restartBtnPause: document.getElementById('restart-btn-pause'),
  gameoverScreen: document.getElementById('gameover-screen'),
  newHighscoreBadge: document.getElementById('new-highscore-badge'),
  finalScore: document.getElementById('final-score'),
  finalHighscore: document.getElementById('final-highscore'),
  finalLevel: document.getElementById('final-level'),
  restartBtn: document.getElementById('restart-btn'),
};

function updateHUD() {
  el.scoreValue.textContent = game.score;
  el.highscoreValue.textContent = game.highScore;
  el.levelValue.textContent = game.level;
  const pct = clamp(game.health / game.maxHealth, 0, 1) * 100;
  el.healthInner.style.width = pct + '%';
  el.healthText.textContent = Math.ceil(game.health);
  el.healthInner.style.background = pct > 50
    ? 'linear-gradient(90deg, #39ff88, #a4ff4d)'
    : pct > 20
      ? 'linear-gradient(90deg, #ffd23d, #ffab3d)'
      : 'linear-gradient(90deg, #ff3b5c, #ff5c7a)';

  el.activePowerups.innerHTML = '';
  for (const key of Object.keys(game.activePowerups)) {
    if (game.activePowerups[key] > 0) {
      const chip = document.createElement('span');
      chip.className = 'powerup-chip';
      chip.style.color = POWERUP_TYPES[key].color;
      chip.textContent = `${POWERUP_TYPES[key].label} ${Math.ceil(game.activePowerups[key])}s`;
      el.activePowerups.appendChild(chip);
    }
  }

  if (game.combo >= 3) {
    el.comboDisplay.textContent = `${game.combo}x COMBO  ×${comboMultiplier().toFixed(1)}`;
    el.comboDisplay.classList.remove('hidden');
  } else {
    el.comboDisplay.classList.add('hidden');
  }

  el.levelToast.classList.toggle('hidden', game.toastTimer <= 0);
  if (game.toastTimer > 0) el.levelToast.textContent = game.toastText;
}

/* --------------------------------------------------------------------
   11. MAIN UPDATE + DRAW LOOP
   -------------------------------------------------------------------- */
function updatePowerupTimers(dt) {
  for (const key of Object.keys(game.activePowerups)) {
    game.activePowerups[key] -= dt;
    if (game.activePowerups[key] <= 0) delete game.activePowerups[key];
  }
}

function update(dt) {
  updateStars(dt);
  if (game.state !== STATE.PLAYING) return;

  player.update(dt);
  updatePowerupTimers(dt);

  if (game.combo > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) game.combo = 0;
  }
  if (game.toastTimer > 0) game.toastTimer -= dt;

  bullets.forEach(b => b.update(dt));
  enemyBullets.forEach(b => b.update(dt));
  enemies.forEach(en => en.update(dt));
  powerups.forEach(p => p.update(dt));
  particles.forEach(p => p.update(dt));

  checkCollisions();

  // spawn new enemies over time, faster as level rises
  game.spawnTimer += dt;
  if (game.spawnTimer >= game.spawnInterval) {
    game.spawnTimer = 0;
    spawnEnemy();
  }

  updateDifficulty();

  if (game.shakeTime > 0) game.shakeTime -= dt;

  // cull dead / offscreen entities
  removeDead(bullets); removeDead(enemyBullets); removeDead(enemies);
  removeDead(powerups);
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);

  updateHUD();
}
function removeDead(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].dead) arr.splice(i, 1);
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (game.shakeTime > 0) {
    const m = game.shakeMag * (game.shakeTime / 0.25);
    ctx.translate(rand(-m, m), rand(-m, m));
  }

  drawStars();

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED) {
    powerups.forEach(p => p.draw());
    enemies.forEach(en => en.draw());
    bullets.forEach(b => b.draw());
    enemyBullets.forEach(b => b.draw());
    particles.forEach(p => p.draw());
    player.draw();
  }

  ctx.restore();

  if (game.state === STATE.PAUSED) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,3,10,0.35)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

function loop(timestamp) {
  if (!game.lastTime) game.lastTime = timestamp;
  let dt = (timestamp - game.lastTime) / 1000;
  dt = Math.min(dt, 0.05); // clamp to avoid huge jumps on tab switch
  game.lastTime = timestamp;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

/* --------------------------------------------------------------------
   12. STATE TRANSITIONS
   -------------------------------------------------------------------- */
function showScreen(name) {
  el.startScreen.classList.toggle('hidden', name !== 'start');
  el.pauseScreen.classList.toggle('hidden', name !== 'pause');
  el.gameoverScreen.classList.toggle('hidden', name !== 'over');
  el.hud.classList.toggle('hidden', !(name === 'hud'));
  el.pauseBtn.classList.toggle('hidden', !(name === 'hud'));
  el.muteBtn.classList.toggle('hidden', !(name === 'hud'));
}

function startGame() {
  Audio2.ensure();
  game.state = STATE.PLAYING;
  game.score = 0;
  game.level = 1;
  game.health = game.maxHealth;
  game.spawnTimer = 0;
  game.spawnInterval = 1.35;
  game.activePowerups = {};
  game.combo = 0;
  game.comboTimer = 0;
  game.toastTimer = 0;
  bullets.length = 0; enemyBullets.length = 0; enemies.length = 0;
  powerups.length = 0; particles.length = 0;
  player = new Player();
  el.startHighscore.textContent = game.highScore;
  showScreen('hud');
  updateHUD();
}

function togglePause() {
  if (game.state === STATE.PLAYING) {
    game.state = STATE.PAUSED;
    showScreen('pause');
    el.hud.classList.remove('hidden'); // keep HUD visible behind pause overlay
  } else if (game.state === STATE.PAUSED) {
    game.state = STATE.PLAYING;
    showScreen('hud');
  }
}

function endGame() {
  game.state = STATE.OVER;
  Audio2.gameOver();
  const isNew = game.score > game.highScore;
  if (isNew) {
    game.highScore = game.score;
    saveHighScore(game.highScore);
  }
  el.finalScore.textContent = game.score;
  el.finalHighscore.textContent = game.highScore;
  el.finalLevel.textContent = game.level;
  el.newHighscoreBadge.classList.toggle('hidden', !isNew);
  showScreen('over');
}

function restartGame() {
  startGame();
}

/* --------------------------------------------------------------------
   13. EVENT WIRING
   -------------------------------------------------------------------- */
el.startBtn.addEventListener('click', startGame);
el.pauseBtn.addEventListener('click', togglePause);
el.resumeBtn.addEventListener('click', togglePause);
el.restartBtnPause.addEventListener('click', restartGame);
el.restartBtn.addEventListener('click', restartGame);

el.muteBtn.addEventListener('click', () => {
  Audio2.muted = !Audio2.muted;
  el.muteBtn.textContent = Audio2.muted ? '🔇' : '🔊';
  el.muteBtn.classList.toggle('muted', Audio2.muted);
});

// auto-pause when the tab/window loses focus so enemies don't pile up unseen
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) togglePause();
});

// initial paint of the high score on the start screen
el.startHighscore.textContent = game.highScore;

/* --------------------------------------------------------------------
   BOOTSTRAP
   -------------------------------------------------------------------- */
resizeCanvas();
requestAnimationFrame(loop);
