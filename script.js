/* =====================================================================
   STELLAR SIEGE — script.js
   Architecture: D-Pad controls, Canvas Resizing, Multi-Phase Bosses.
   ===================================================================== */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const gameView = document.getElementById('game-view');

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = 0, H = 0; 

function resizeCanvas() {
  // We size strictly based on the game-view container, leaving room for the gamepad
  const rect = gameView.getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildStars(); 
}
window.addEventListener('resize', resizeCanvas);

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist2 = (x1, y1, x2, y2) => (x1 - x2) ** 2 + (y1 - y2) ** 2;
const circlesHit = (x1, y1, r1, x2, y2, r2) => dist2(x1, y1, x2, y2) <= (r1 + r2) ** 2;

let _memoryHighScore = 0;
function loadHighScore() { try { return Number(localStorage.getItem('stellarSiege_highScore') || 0); } catch (e) { return _memoryHighScore; } }
function saveHighScore(value) { _memoryHighScore = value; try { localStorage.setItem('stellarSiege_highScore', String(value)); } catch (e) {} }

/* --- AUDIO MANAGER --- */
const Audio2 = {
  ctx: null, muted: false,
  ensure() {
    if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); }
    if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx;
  },
  tone(freq, duration, type = 'square', startGain = 0.15, freqEnd = null) {
    if (this.muted) return;
    const ac = this.ensure(); const osc = ac.createOscillator(); const gain = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), ac.currentTime + duration);
    gain.gain.setValueAtTime(startGain, ac.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    osc.connect(gain).connect(ac.destination); osc.start(); osc.stop(ac.currentTime + duration + 0.02);
  },
  shoot() { this.tone(880, 0.09, 'square', 0.06, 340); },
  explosion() {
    if (this.muted) return; const ac = this.ensure(); const bufferSize = ac.sampleRate * 0.35;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate); const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ac.createBufferSource(); noise.buffer = buffer; const filter = ac.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, ac.currentTime); filter.frequency.exponentialRampToValueAtTime(80, ac.currentTime + 0.3);
    const gain = ac.createGain(); gain.gain.setValueAtTime(0.35, ac.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
    noise.connect(filter).connect(gain).connect(ac.destination); noise.start();
  },
  powerup() { const notes = [523, 659, 784, 1046]; notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.14, 'triangle', 0.12), i * 60)); },
  hit() { this.tone(180, 0.12, 'sawtooth', 0.12, 60); },
  gameOver() { const notes = [392, 349, 293, 220, 150]; notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'sawtooth', 0.18), i * 200)); },
  levelUp() { const notes = [660, 880, 1108]; notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.16, 'square', 0.1), i * 90)); },
  bomb() { this.tone(60, 1.2, 'sawtooth', 0.4, 10); this.explosion(); this.explosion(); }
};

/* --- STARFIELD --- */
let stars = [];
function buildStars() {
  stars = []; const density = (W * H) / 9000;
  for (let i = 0; i < density; i++) {
    const layer = randInt(1, 3);
    stars.push({ x: rand(0, W), y: rand(0, H), r: layer * 0.55, speed: layer * 18, phase: rand(0, Math.PI * 2), layer });
  }
}
function updateStars(dt) {
  for (const s of stars) {
    s.y += (game.state === STATE.DYING ? s.speed * 0.15 : s.speed) * dt; s.phase += dt * 2;
    if (s.y > H) { s.y = -2; s.x = rand(0, W); }
  }
}
function drawStars() {
  for (const s of stars) {
    const twinkle = 0.55 + Math.sin(s.phase) * 0.35; ctx.globalAlpha = clamp(twinkle, 0.15, 1);
    ctx.fillStyle = s.layer === 3 ? '#00e5ff' : (s.layer === 2 ? '#0055ff' : '#002288');
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* --- GAME STATE --- */
const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', DYING: 'dying', OVER: 'over' };
const game = {
  state: STATE.START, score: 0, highScore: loadHighScore(), level: 1, health: 100, maxHealth: 100,
  bombs: 2, lastTime: 0, spawnTimer: 0, spawnInterval: 1.35, shakeTime: 0, shakeMag: 0,
  activePowerups: {}, combo: 0, comboTimer: 0, toastTimer: 0, toastText: '', deathTimer: 0, bossActive: false
};

const COMBO_WINDOW = 3; 
function comboMultiplier() { return clamp(1 + game.combo * 0.1, 1, 2.5); }

const bullets = [], enemyBullets = [], enemies = [], powerups = [], particles = [], floatingTexts = [];
const keys = {};

const ENEMY_TYPES = {
  scout:       { hp: 1,  speed: [110, 160], points: 10,  radius: 14, color: '#ff2a4b', minLevel: 1, shoots: false },
  fighter:     { hp: 3,  speed: [80, 120],  points: 20,  radius: 18, color: '#ff6a00', minLevel: 2, shoots: true,  fireChance: 0.006 },
  cruiser:     { hp: 7,  speed: [50, 80],   points: 40,  radius: 24, color: '#ffcc00', minLevel: 3, shoots: true,  fireChance: 0.010 },
  bomber:      { hp: 14, speed: [30, 50],   points: 80,  radius: 32, color: '#ff2a4b', minLevel: 4, shoots: true,  fireChance: 0.016 },
  interceptor: { hp: 4,  speed: [160, 220], points: 60,  radius: 16, color: '#00e5ff', minLevel: 6, shoots: true,  fireChance: 0.020 }
};

const POWERUP_TYPES = {
  weapon:      { color: '#00e5ff', label: 'WEAPON UP', duration: 0 },
  shield:      { color: '#00ffaa', label: 'SHIELD',    duration: 8 },
  bomb:        { color: '#ffcc00', label: '+1 BOMB',   duration: 0 }
};

/* --- ENTITIES --- */
class Player {
  constructor() { this.w = 46; this.h = 46; this.radius = 16; this.speed = 380; this.reset(); }
  reset() {
    this.x = W / 2; this.y = H - 80; this.cooldown = 0; this.baseFireDelay = 0.25;
    this.thrusterPhase = 0; this.invulnTime = 0.6; this.weaponTier = 1; this.dead = false;
  }
  update(dt) {
    if (this.dead) return;
    
    // 8-Way Keyboard + Touch D-pad Movement
    let dx = 0, dy = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A'] || touchState.left) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D'] || touchState.right) dx += 1;
    if (keys['ArrowUp'] || keys['w'] || keys['W'] || touchState.up) dy -= 1;
    if (keys['ArrowDown'] || keys['s'] || keys['S'] || touchState.down) dy += 1;
    
    // Normalize diagonal speed
    if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
    
    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
    
    // Restrict movement to bottom 45% of screen
    this.x = clamp(this.x, this.w / 2, W - this.w / 2);
    this.y = clamp(this.y, H * 0.55, H - this.h / 2);

    this.thrusterPhase += dt * 14;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnTime > 0) this.invulnTime -= dt;

    const wantsFire = keys[' '] || keys['Spacebar'] || touchState.fire;
    if (wantsFire && this.cooldown <= 0) this.fire();
  }
  fire() {
    this.cooldown = this.baseFireDelay;
    const dmg = 1 + Math.floor((this.weaponTier - 1) / 2);
    const color = this.weaponTier >= 3 ? '#0055ff' : '#00e5ff';

    if (this.weaponTier === 1) {
      bullets.push(new Bullet(this.x, this.y - this.h / 2, -650, color, dmg, 0));
    } else if (this.weaponTier === 2) {
      bullets.push(new Bullet(this.x - 8, this.y - this.h / 2, -650, color, dmg, 0));
      bullets.push(new Bullet(this.x + 8, this.y - this.h / 2, -650, color, dmg, 0));
    } else if (this.weaponTier >= 3) {
      this.cooldown *= 0.9;
      bullets.push(new Bullet(this.x, this.y - this.h / 2, -700, color, dmg+1, 0));
      bullets.push(new Bullet(this.x - 14, this.y - this.h / 2 + 6, -650, color, dmg, -12));
      bullets.push(new Bullet(this.x + 14, this.y - this.h / 2 + 6, -650, color, dmg, 12));
    }
    if (this.weaponTier >= 4) {
      bullets.push(new Bullet(this.x - 20, this.y - this.h / 2 + 10, -600, color, dmg, -25));
      bullets.push(new Bullet(this.x + 20, this.y - this.h / 2 + 10, -600, color, dmg, 25));
    }
    Audio2.shoot();
  }
  draw() {
    if (this.dead) return;
    const shielded = game.activePowerups.shield > 0;
    if (this.invulnTime > 0 && Math.floor(this.invulnTime * 14) % 2 === 0) return;
    ctx.save(); ctx.translate(this.x, this.y);

    const flick = 6 + Math.sin(this.thrusterPhase) * 3;
    const grad = ctx.createRadialGradient(0, this.h / 2 - 2, 0, 0, this.h / 2 + flick, flick + 6);
    grad.addColorStop(0, 'rgba(0,229,255,0.9)'); grad.addColorStop(1, 'rgba(0,229,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.ellipse(0, this.h / 2 - 4, 9, flick + 6, 0, 0, Math.PI * 2); ctx.fill();

    ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#020611'; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -this.h / 2); ctx.lineTo(this.w / 2, this.h / 2 - 6);
    ctx.lineTo(this.w / 4, this.h / 2 - 14); ctx.lineTo(0, this.h / 2 - 6);
    ctx.lineTo(-this.w / 4, this.h / 2 - 14); ctx.lineTo(-this.w / 2, this.h / 2 - 6); ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#0055ff'; ctx.shadowColor = '#0055ff';
    ctx.beginPath(); ctx.arc(0, -2, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    if (shielded) {
      ctx.save(); ctx.translate(this.x, this.y); ctx.strokeStyle = 'rgba(0,255,170,0.85)';
      ctx.lineWidth = 2.5; ctx.shadowColor = '#00ffaa'; ctx.shadowBlur = 14;
      const pulse = 30 + Math.sin(performance.now() / 150) * 3;
      ctx.beginPath(); ctx.arc(0, 0, pulse, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
  }
}

class Bullet {
  constructor(x, y, vy, color, damage = 1, angleDeg = 0) {
    this.x = x; this.y = y; this.damage = damage;
    const rad = (angleDeg * Math.PI) / 180;
    this.vx = Math.sin(rad) * Math.abs(vy); this.vy = Math.cos(rad) * vy;
    this.color = color; this.radius = damage > 1 ? 6 : 4; this.dead = false;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (this.y < -20 || this.y > H + 20 || this.x < -20 || this.x > W + 20) this.dead = true;
  }
  draw() {
    ctx.save(); ctx.shadowColor = this.color; ctx.shadowBlur = 12; ctx.fillStyle = this.color; ctx.beginPath();
    ctx.ellipse(this.x, this.y, this.radius * 0.6, this.radius * 2.2, Math.atan2(this.vy, this.vx) + Math.PI/2, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }
}

class Enemy {
  constructor(typeKey) {
    const def = ENEMY_TYPES[typeKey];
    this.type = typeKey; this.def = def;
    this.hp = def.hp + Math.floor((game.level - 1) * 1.8);
    this.maxHp = this.hp; this.radius = def.radius;
    this.x = rand(def.radius, W - def.radius); this.y = -def.radius - 10;
    this.speed = rand(def.speed[0], def.speed[1]) * (1 + (game.level - 1) * 0.05);
    this.color = def.color; this.wobble = rand(0, Math.PI * 2); this.wobbleSpeed = rand(1, 2.2);
    this.dead = false; this.hitFlash = 0;
  }
  update(dt) {
    this.y += this.speed * dt; this.wobble += dt * this.wobbleSpeed;
    this.x += Math.sin(this.wobble) * 22 * dt; this.x = clamp(this.x, this.radius, W - this.radius);
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.def.shoots && game.state === STATE.PLAYING && Math.random() < this.def.fireChance) {
      enemyBullets.push(new Bullet(this.x, this.y + this.radius, 280, '#ff2a4b', 1));
    }
    if (this.y - this.radius > H) {
      this.dead = true; damagePlayer(this.def.hp * 3 + 5, true); spawnHitShake();
    }
  }
  draw() {
    ctx.save(); ctx.translate(this.x, this.y);
    ctx.shadowColor = this.color; ctx.shadowBlur = this.hitFlash > 0 ? 26 : 14;
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : '#02040a'; ctx.strokeStyle = this.color; ctx.lineWidth = 2.4;
    const r = this.radius; ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = Math.cos(a) * r; const py = Math.sin(a) * r * 0.85;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    if (this.maxHp > 3) {
      const bw = r * 1.8; const pct = this.hp / this.maxHp;
      ctx.save(); ctx.translate(this.x - bw / 2, this.y - r - 10);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, bw, 4);
      ctx.fillStyle = pct > 0.4 ? '#00e5ff' : '#ff2a4b'; ctx.fillRect(0, 0, bw * pct, 4); ctx.restore();
    }
  }
  hit(dmg) {
    this.hp -= dmg; this.hitFlash = 0.08;
    addFloatingText(this.x, this.y - 15, dmg, '#fff');
    if (this.hp <= 0) this.dead = true;
  }
}

class Boss extends Enemy {
  constructor() {
    super('bomber');
    this.type = 'boss'; this.hp = 250 + (game.level * 50); this.maxHp = this.hp;
    this.radius = 70; this.color = '#ff2a4b'; this.y = -100; this.x = W / 2;
    this.phase = 1; this.speed = 80; this.fireTimer = 0; this.moveDir = 1;
    document.getElementById('boss-ui').classList.remove('hidden');
    document.querySelector('.boss-name').textContent = `SECTOR ${game.level} DREADNOUGHT`;
  }
  update(dt) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    
    const pct = this.hp / this.maxHp;
    if (pct < 0.33) this.phase = 3; else if (pct < 0.66) this.phase = 2;

    if (this.y < 120) {
      this.y += this.speed * dt;
    } else {
      if (this.phase === 1) {
        this.x += this.speed * this.moveDir * dt;
        if (this.x < 80) this.moveDir = 1; if (this.x > W - 80) this.moveDir = -1;
        this.fireTimer += dt;
        if (this.fireTimer > 1.2) {
          this.fireTimer = 0;
          enemyBullets.push(new Bullet(this.x - 30, this.y + 20, 300, '#ffcc00', 1));
          enemyBullets.push(new Bullet(this.x + 30, this.y + 20, 300, '#ffcc00', 1));
        }
      } else if (this.phase === 2) {
        this.x += (W/2 - this.x) * 2 * dt;
        this.fireTimer += dt;
        if (this.fireTimer > 2.0) {
          this.fireTimer = 0;
          for (let i = 0; i < 16; i++) {
            enemyBullets.push(new Bullet(this.x, this.y, 160, '#ff2a4b', 1, i * (360/16)));
          }
        }
      } else if (this.phase === 3) {
        this.x += (player.x - this.x) * 1.5 * dt;
        this.fireTimer += dt;
        if (this.fireTimer > 0.4) {
          this.fireTimer = 0;
          const angle = Math.atan2(player.y - this.y, player.x - this.x) * (180/Math.PI) - 90;
          enemyBullets.push(new Bullet(this.x, this.y + 30, 400, '#ff2a4b', 1, angle + rand(-10, 10)));
        }
      }
    }
    document.getElementById('boss-bar-inner').style.width = Math.max(0, pct * 100) + '%';
  }
  draw() {
    ctx.save(); ctx.translate(this.x, this.y);
    ctx.shadowColor = this.color; ctx.shadowBlur = this.hitFlash > 0 ? 30 : 20;
    ctx.fillStyle = this.hitFlash > 0 ? '#fff' : '#02040a'; ctx.strokeStyle = this.color; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-65, -35); ctx.lineTo(65, -35); ctx.lineTo(85, 15); ctx.lineTo(0, 65); ctx.lineTo(-85, 15); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.phase === 3 ? '#ffcc00' : '#00e5ff'; ctx.beginPath(); ctx.arc(0, 10, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  hit(dmg) {
    this.hp -= dmg; this.hitFlash = 0.08; addFloatingText(this.x + rand(-30, 30), this.y - 30, dmg, '#ff2a4b');
    if (this.hp <= 0) {
      this.dead = true; game.bossActive = false; document.getElementById('boss-ui').classList.add('hidden');
      spawnExplosion(this.x, this.y, this.color, 60); game.score += 2500 * comboMultiplier();
      powerups.push(new PowerUp(this.x - 40, this.y, 'weapon')); powerups.push(new PowerUp(this.x + 40, this.y, 'shield'));
    }
  }
}

class PowerUp {
  constructor(x, y, typeKey) {
    this.x = x; this.y = y; this.type = typeKey; this.def = POWERUP_TYPES[typeKey];
    this.radius = 16; this.vy = 80; this.phase = rand(0, Math.PI * 2); this.dead = false;
  }
  update(dt) { this.y += this.vy * dt; this.phase += dt * 4; if (this.y > H + 20) this.dead = true; }
  draw() {
    ctx.save(); ctx.translate(this.x, this.y + Math.sin(this.phase) * 5);
    ctx.shadowColor = this.def.color; ctx.shadowBlur = 20; ctx.strokeStyle = this.def.color;
    ctx.fillStyle = 'rgba(2,4,10,0.8)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.def.color; ctx.font = 'bold 16px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const glyph = this.type === 'weapon' ? 'W' : (this.type === 'shield' ? '🛡' : '☢');
    ctx.fillText(glyph, 0, 1); ctx.restore();
  }
}

class Particle {
  constructor(x, y, color) {
    this.x = x; this.y = y; const a = rand(0, Math.PI * 2); const speed = rand(50, 250);
    this.vx = Math.cos(a) * speed; this.vy = Math.sin(a) * speed;
    this.life = rand(0.3, 0.8); this.maxLife = this.life; this.color = color; this.size = rand(2, 4.5);
  }
  update(dt) { this.x += this.vx * dt; this.y += this.vy * dt; this.vx *= 0.94; this.vy *= 0.94; this.life -= dt; }
  draw() {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.save(); ctx.globalAlpha = t; ctx.fillStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(this.x, this.y, this.size * t + 0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

class FloatingText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 0.9; this.maxLife = 0.9; this.vy = -35;
  }
  update(dt) { this.y += this.vy * dt; this.life -= dt; }
  draw() {
    ctx.save(); ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1);
    ctx.fillStyle = this.color; ctx.font = 'bold 18px Orbitron, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y); ctx.restore();
  }
}

function spawnExplosion(x, y, color, count = 18) {
  for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color));
  Audio2.explosion();
}
function addFloatingText(x, y, text, color) { floatingTexts.push(new FloatingText(x, y, text, color)); }
function spawnHitShake(mag = 8) { game.shakeTime = 0.3; game.shakeMag = mag; }

let player = new Player();

/* --- INPUT HANDLING: KEYBOARD & RETRO GAMEPAD --- */
const touchState = { left: false, right: false, up: false, down: false, fire: false };

window.addEventListener('keydown', (e) => {
  keys[e.key] = true; if (e.key === ' ') e.preventDefault();
  if ((e.key === 'p' || e.key === 'P') && (game.state === STATE.PLAYING || game.state === STATE.PAUSED)) togglePause();
  if ((e.key === 'b' || e.key === 'B') && game.state === STATE.PLAYING) triggerBomb();
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// Touch Control Binders
function bindTouchButton(id, stateKey, isBomb = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const press = (e) => { 
    e.preventDefault(); 
    if(isBomb) { triggerBomb(); } else { touchState[stateKey] = true; } 
  };
  const release = (e) => { e.preventDefault(); if(!isBomb) touchState[stateKey] = false; };
  
  el.addEventListener('touchstart', press, { passive: false });
  el.addEventListener('touchend', release, { passive: false });
  el.addEventListener('touchcancel', release, { passive: false });
}

bindTouchButton('btn-up', 'up');
bindTouchButton('btn-down', 'down');
bindTouchButton('btn-left', 'left');
bindTouchButton('btn-right', 'right');
bindTouchButton('btn-fire', 'fire');
bindTouchButton('btn-bomb', 'bomb', true);

// Show Gamepad UI block dynamically if touch API is found
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.getElementById('mobile-gamepad').classList.add('enabled');
}

/* --- SPAWNING & DIFFICULTY --- */
function spawnEnemy() {
  if (game.bossActive) return;
  const available = Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].minLevel <= game.level);
  const weights = available.map((k, i) => available.length - i);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand(0, total); let picked = available[0];
  for (let i = 0; i < available.length; i++) { if (r < weights[i]) { picked = available[i]; break; } r -= weights[i]; }
  enemies.push(new Enemy(picked));
}
function maybeDropPowerup(x, y) {
  if (Math.random() < 0.12) {
    const keysArr = Object.keys(POWERUP_TYPES);
    powerups.push(new PowerUp(x, y, keysArr[randInt(0, keysArr.length - 1)]));
  }
}
function updateDifficulty() {
  const newLevel = 1 + Math.floor(game.score / 800);
  if (newLevel !== game.level) {
    game.level = newLevel; Audio2.levelUp();
    game.toastText = `SECTOR ${game.level}`; game.toastTimer = 1.8;
    // Spawn Boss every 5 levels
    if (game.level % 5 === 0) { game.bossActive = true; enemies.push(new Boss()); }
  }
  game.spawnInterval = clamp(1.35 - (game.level - 1) * 0.08, 0.35, 1.35);
}

/* --- COLLISIONS & LOGIC --- */
function triggerBomb() {
  if (game.bombs <= 0 || player.dead) return;
  game.bombs--;
  Audio2.bomb();
  spawnHitShake(15);
  
  const flash = document.getElementById('screen-flash');
  flash.style.opacity = '1';
  setTimeout(() => { flash.style.opacity = '0'; }, 100);

  // Destroy all enemy bullets
  enemyBullets.length = 0;
  
  // Deal massive damage to all enemies
  enemies.forEach(en => {
    en.hit(40);
    if (!en.dead) addFloatingText(en.x, en.y, "EMP HIT!", "#ffcc00");
  });
}

function damagePlayer(amount, bypassShield = false) {
  if (game.state !== STATE.PLAYING) return;
  if (game.activePowerups.shield > 0 && !bypassShield) {
    addFloatingText(player.x, player.y - 25, "DEFLECTED", "#00ffaa"); return;
  }
  if (player.invulnTime > 0) return;
  
  game.health = clamp(game.health - amount, 0, game.maxHealth);
  game.combo = 0; game.comboTimer = 0;
  spawnHitShake(); Audio2.hit(); player.invulnTime = 1.2;
  
  if (game.health <= 0) triggerDeathSequence();
}

function checkCollisions() {
  for (const b of bullets) {
    if (b.dead) continue;
    for (const en of enemies) {
      if (en.dead) continue;
      if (circlesHit(b.x, b.y, b.radius, en.x, en.y, en.radius)) {
        b.dead = true; en.hit(b.damage);
        if (en.dead && en.type !== 'boss') {
          game.combo += 1; game.comboTimer = COMBO_WINDOW;
          const scoreMult = comboMultiplier();
          game.score += Math.round(en.def.points * scoreMult);
          spawnExplosion(en.x, en.y, en.color); maybeDropPowerup(en.x, en.y);
        }
        break;
      }
    }
  }
  for (const eb of enemyBullets) {
    if (eb.dead) continue;
    if (player.invulnTime <= 0 && circlesHit(eb.x, eb.y, eb.radius, player.x, player.y, player.radius)) { eb.dead = true; damagePlayer(12); }
  }
  for (const en of enemies) {
    if (en.dead) continue;
    if (player.invulnTime <= 0 && circlesHit(en.x, en.y, en.radius, player.x, player.y, player.radius)) {
      if(en.type !== 'boss') en.dead = true; spawnExplosion(en.x, en.y, en.color); damagePlayer(en.type==='boss' ? 35 : en.def.hp * 5 + 10);
    }
  }
  for (const p of powerups) {
    if (p.dead) continue;
    if (circlesHit(p.x, p.y, p.radius, player.x, player.y, player.radius)) {
      p.dead = true; Audio2.powerup(); addFloatingText(player.x, player.y - 25, p.def.label, p.def.color);
      if (p.type === 'weapon') { player.weaponTier = clamp(player.weaponTier + 1, 1, 5); } 
      else if (p.type === 'bomb') { game.bombs++; }
      else { game.activePowerups[p.type] = p.def.duration; }
    }
  }
}

function triggerDeathSequence() {
  game.state = STATE.DYING; player.dead = true; game.deathTimer = 2.5;
  spawnExplosion(player.x, player.y, '#00e5ff', 40); Audio2.gameOver();
  spawnHitShake(12);
}

/* --- UI UPDATES --- */
const el = {
  hud: document.getElementById('hud'), pauseBtn: document.getElementById('pause-btn'), muteBtn: document.getElementById('mute-btn'),
  comboDisplay: document.getElementById('combo-display'), levelToast: document.getElementById('level-toast'),
  scoreValue: document.getElementById('score-value'), highscoreValue: document.getElementById('highscore-value'),
  levelValue: document.getElementById('level-value'), healthInner: document.getElementById('health-bar-inner'),
  healthText: document.getElementById('health-text'), bombCount: document.getElementById('bomb-count'),
  activePowerups: document.getElementById('active-powerups')
};

function updateHUD() {
  el.scoreValue.textContent = game.score; el.highscoreValue.textContent = game.highScore; el.levelValue.textContent = game.level;
  el.bombCount.textContent = game.bombs;
  const pct = clamp(game.health / game.maxHealth, 0, 1) * 100;
  el.healthInner.style.width = pct + '%'; el.healthText.textContent = Math.ceil(game.health);
  el.healthInner.style.background = pct > 50 ? 'linear-gradient(90deg, #00ffaa, #00e5ff)' : pct > 20 ? 'linear-gradient(90deg, #ffcc00, #ff6a00)' : 'linear-gradient(90deg, #ff2a4b, #990000)';
  
  el.activePowerups.innerHTML = '';
  for (const key of Object.keys(game.activePowerups)) {
    if (game.activePowerups[key] > 0) {
      const chip = document.createElement('span'); chip.className = 'powerup-chip';
      chip.style.color = POWERUP_TYPES[key].color; chip.textContent = `${POWERUP_TYPES[key].label} ${Math.ceil(game.activePowerups[key])}s`;
      el.activePowerups.appendChild(chip);
    }
  }
  if (game.combo >= 3) {
    el.comboDisplay.textContent = `${game.combo}x COMBO  ×${comboMultiplier().toFixed(1)}`;
    el.comboDisplay.classList.remove('hidden');
  } else { el.comboDisplay.classList.add('hidden'); }
  
  el.levelToast.classList.toggle('hidden', game.toastTimer <= 0);
  if (game.toastTimer > 0) el.levelToast.textContent = game.toastText;
}

/* --- MAIN LOOP --- */
function update(dt) {
  updateStars(dt);
  if (game.state !== STATE.PLAYING && game.state !== STATE.DYING) return;

  if (game.state === STATE.DYING) {
    dt *= 0.3; // Slow motion effect
    game.deathTimer -= dt;
    if (Math.random() < 0.2) spawnExplosion(player.x + rand(-40, 40), player.y + rand(-40, 40), '#ff2a4b', 12);
    if (game.deathTimer <= 0) endGame();
  } else {
    player.update(dt);
  }

  for (const key of Object.keys(game.activePowerups)) { game.activePowerups[key] -= dt; if (game.activePowerups[key] <= 0) delete game.activePowerups[key]; }
  if (game.combo > 0) { game.comboTimer -= dt; if (game.comboTimer <= 0) game.combo = 0; }
  if (game.toastTimer > 0) game.toastTimer -= dt;

  bullets.forEach(b => b.update(dt)); enemyBullets.forEach(b => b.update(dt));
  enemies.forEach(en => en.update(dt)); powerups.forEach(p => p.update(dt));
  particles.forEach(p => p.update(dt)); floatingTexts.forEach(ft => ft.update(dt));

  if (game.state === STATE.PLAYING) checkCollisions();

  game.spawnTimer += dt;
  if (game.spawnTimer >= game.spawnInterval) { game.spawnTimer = 0; spawnEnemy(); }
  updateDifficulty();

  if (game.shakeTime > 0) game.shakeTime -= dt;

  removeDead(bullets); removeDead(enemyBullets); removeDead(enemies); removeDead(powerups);
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  for (let i = floatingTexts.length - 1; i >= 0; i--) if (floatingTexts[i].life <= 0) floatingTexts.splice(i, 1);
  
  updateHUD();
}
function removeDead(arr) { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].dead) arr.splice(i, 1); }

function draw() {
  ctx.clearRect(0, 0, W, H); ctx.save();
  if (game.shakeTime > 0) { const m = game.shakeMag * (game.shakeTime / 0.3); ctx.translate(rand(-m, m), rand(-m, m)); }
  drawStars();

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED || game.state === STATE.DYING) {
    powerups.forEach(p => p.draw()); enemies.forEach(en => en.draw());
    bullets.forEach(b => b.draw()); enemyBullets.forEach(b => b.draw());
    particles.forEach(p => p.draw()); player.draw(); floatingTexts.forEach(ft => ft.draw());
  }
  ctx.restore();
  if (game.state === STATE.PAUSED) { ctx.fillStyle = 'rgba(2,4,10,0.45)'; ctx.fillRect(0, 0, W, H); }
}

function loop(timestamp) {
  if (!game.lastTime) game.lastTime = timestamp;
  let dt = Math.min((timestamp - game.lastTime) / 1000, 0.05);
  game.lastTime = timestamp; update(dt); draw(); requestAnimationFrame(loop);
}

/* --- STATE TRANSITIONS --- */
function showScreen(name) {
  document.getElementById('start-screen').classList.toggle('hidden', name !== 'start');
  document.getElementById('pause-screen').classList.toggle('hidden', name !== 'pause');
  document.getElementById('gameover-screen').classList.toggle('hidden', name !== 'over');
  el.hud.classList.toggle('hidden', name !== 'hud');
  el.pauseBtn.classList.toggle('hidden', name !== 'hud');
  el.muteBtn.classList.toggle('hidden', name !== 'hud');
}

function startGame() {
  Audio2.ensure(); game.state = STATE.PLAYING; game.score = 0; game.level = 1; game.health = game.maxHealth;
  game.bombs = 2; game.spawnTimer = 0; game.spawnInterval = 1.35; game.activePowerups = {}; game.bossActive = false;
  game.combo = 0; game.comboTimer = 0; game.toastTimer = 0;
  bullets.length = 0; enemyBullets.length = 0; enemies.length = 0; powerups.length = 0; particles.length = 0; floatingTexts.length = 0;
  player = new Player(); el.comboDisplay.classList.add('hidden'); document.getElementById('boss-ui').classList.add('hidden');
  document.getElementById('start-highscore').textContent = game.highScore; showScreen('hud'); updateHUD();
}

function togglePause() {
  if (game.state === STATE.PLAYING) { game.state = STATE.PAUSED; showScreen('pause'); el.hud.classList.remove('hidden'); }
  else if (game.state === STATE.PAUSED) { game.state = STATE.PLAYING; showScreen('hud'); }
}

function endGame() {
  game.state = STATE.OVER; const isNew = game.score > game.highScore;
  if (isNew) { game.highScore = game.score; saveHighScore(game.highScore); }
  document.getElementById('final-score').textContent = game.score; document.getElementById('final-highscore').textContent = game.highScore;
  document.getElementById('final-level').textContent = game.level; document.getElementById('new-highscore-badge').classList.toggle('hidden', !isNew);
  showScreen('over');
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('pause-btn').addEventListener('click', togglePause);
document.getElementById('resume-btn').addEventListener('click', togglePause);
document.getElementById('restart-btn-pause').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

el.muteBtn.addEventListener('click', () => {
  Audio2.muted = !Audio2.muted;
  el.muteBtn.textContent = Audio2.muted ? '🔇' : '🔊'; el.muteBtn.classList.toggle('muted', Audio2.muted);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === STATE.PLAYING) togglePause(); });
document.getElementById('start-highscore').textContent = game.highScore;

resizeCanvas(); requestAnimationFrame(loop);
