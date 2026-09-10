/* =====================================================================
   STELLAR SIEGE 2.5D — script.js
   Architecture: Touch Event Fixes, Stable Movement
   ===================================================================== */

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const gameView = document.getElementById('game-view');

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = 0, H = 0; 
let renderList = []; 

let playWidth = 0, playLeft = 0, playRight = 0;

function resizeCanvas() {
  const rect = gameView.getBoundingClientRect();
  W = rect.width; H = rect.height;
  
  playWidth = Math.min(W, 1000); 
  playLeft = (W - playWidth) / 2;
  playRight = playLeft + playWidth;

  canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  buildStars(); 
}
window.addEventListener('resize', resizeCanvas);

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist2 = (x1, y1, x2, y2) => (x1 - x2) ** 2 + (y1 - y2) ** 2;

function getDepthScale(y) { return clamp(0.45 + (y / H) * 0.8, 0.45, 1.25); }

let _memoryHighScore = 0;
function loadHighScore() { try { return Number(localStorage.getItem('stellarSiege_highScore') || 0); } catch (e) { return _memoryHighScore; } }
function saveHighScore(value) { _memoryHighScore = value; try { localStorage.setItem('stellarSiege_highScore', String(value)); } catch (e) {} }

/* --- AUDIO MANAGER --- */
const Audio2 = {
  ctx: null, muted: false,
  ensure() { if (!this.ctx) { const AC = window.AudioContext || window.webkitAudioContext; this.ctx = new AC(); } if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; },
  tone(freq, duration, type = 'square', startGain = 0.15, freqEnd = null) {
    if (this.muted) return; const ac = this.ensure(); const osc = ac.createOscillator(); const gain = ac.createGain();
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
  bomb() { this.tone(60, 1.2, 'sawtooth', 0.4, 10); this.explosion(); this.explosion(); }
};

/* --- 2.5D BACKGROUND ENVIRONMENT --- */
let gridOffset = 0;
let stars = [];
const FOV = 400; const CAM_Z = -300; const MAX_Z = 2000;

function projectGrid(x, y, z) {
  if (z < CAM_Z) return null; const scale = FOV / (z - CAM_Z);
  return { x: (W / 2) + x * scale, y: (H * 0.15) + y * scale, alpha: Math.max(0, 1 - (z / MAX_Z)) };
}

function buildStars() {
  stars = []; 
  for (let i = 0; i < 150; i++) { stars.push({ x: rand(-1200, 1200), y: rand(100, 800), z: rand(0, MAX_Z) }); }
}
function updateEnvironment(dt) {
  let speed = 1800; // Playing
  if (game.state === STATE.START) speed = 3500; // Hyper-warp menu
  if (game.state === STATE.DYING) speed = 300;  // Slow mo death
  if (game.state === STATE.OVER) speed = 80;   // Drifting space

  gridOffset = (gridOffset + speed * dt) % 200;
  for (const s of stars) {
    s.z -= speed * dt;
    if (s.z < CAM_Z) { s.z = MAX_Z; s.x = rand(-1200, 1200); s.y = rand(100, 800); }
  }
}
function drawGridAndStars() {
  ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0, 85, 255, 0.25)';
  for (let z = 0; z <= MAX_Z; z += 200) {
    let actualZ = z - gridOffset;
    let p1 = projectGrid(-1500, 400, actualZ); let p2 = projectGrid(1500, 400, actualZ);
    if(p1 && p2) { ctx.globalAlpha = p1.alpha * 0.6; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
  }
  for (let x = -1500; x <= 1500; x += 200) {
    let p1 = projectGrid(x, 400, 0); let p2 = projectGrid(x, 400, MAX_Z);
    if(p1 && p2) { ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
  }
  ctx.strokeStyle = '#00e5ff';
  for (const s of stars) {
    let p1 = projectGrid(s.x, s.y, s.z); let p2 = projectGrid(s.x, s.y, s.z + 150);
    if(p1 && p2) { ctx.globalAlpha = p1.alpha * 0.7; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
  }
  ctx.restore();
}

function drawDropShadow(x, y, radius, scale, alpha = 0.4) {
  ctx.save(); ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`; ctx.beginPath(); ctx.ellipse(x, y + (70 * scale), radius * scale, (radius * scale) * 0.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

/* --- GAME STATE --- */
const STATE = { START: 'start', PLAYING: 'playing', PAUSED: 'paused', DYING: 'dying', OVER: 'over' };
const game = { state: STATE.START, score: 0, highScore: loadHighScore(), level: 1, health: 100, maxHealth: 100, bombs: 2, lastTime: 0, spawnTimer: 0, spawnInterval: 1.2, shakeTime: 0, shakeMag: 0, activePowerups: {}, combo: 0, comboTimer: 0, toastTimer: 0, toastText: '', deathTimer: 0, bossActive: false };
const COMBO_WINDOW = 3; 
function comboMultiplier() { return clamp(1 + game.combo * 0.1, 1, 2.5); }

const bullets = [], enemyBullets = [], enemies = [], powerups = [], particles = [], floatingTexts = [];
const keys = {};

const ENEMY_TYPES = {
  scout:       { hp: 1,  speed: 140, points: 10,  radius: 20, color: '#ff2a4b', minLevel: 1, shoots: false },
  fighter:     { hp: 3,  speed: 110, points: 20,  radius: 25, color: '#ff6a00', minLevel: 2, shoots: true,  fireChance: 0.005 },
  cruiser:     { hp: 7,  speed: 80,  points: 40,  radius: 35, color: '#ffcc00', minLevel: 3, shoots: true,  fireChance: 0.010 },
  bomber:      { hp: 14, speed: 55,  points: 80,  radius: 45, color: '#ff2a4b', minLevel: 4, shoots: true,  fireChance: 0.014 },
  interceptor: { hp: 4,  speed: 200, points: 60,  radius: 22, color: '#00e5ff', minLevel: 6, shoots: true,  fireChance: 0.016 }
};
const POWERUP_TYPES = { weapon: { color: '#00e5ff', label: 'WEAPON UP', duration: 0 }, shield: { color: '#00ffaa', label: 'SHIELD', duration: 8 }, bomb: { color: '#ffcc00', label: '+1 BOMB', duration: 0 }};

/* --- 2.5D ENTITIES --- */
class Player {
  constructor() { this.w = 50; this.h = 50; this.radius = 20; this.speed = 550; this.reset(); }
  reset() { 
    this.x = W / 2; this.y = H - 90; 
    this.cooldown = 0; this.baseFireDelay = 0.18; 
    this.bankAngle = 0; this.invulnTime = 0.6; this.weaponTier = 1; this.dead = false; this.thrusterPhase = 0; 
  }
  getScaledRadius() { return this.radius * getDepthScale(this.y); }
  update(dt) {
    if (this.dead) return;
    let dx = 0;
    if (keys['ArrowLeft'] || keys['a'] || keys['A'] || touchState.left) dx -= 1;
    if (keys['ArrowRight'] || keys['d'] || keys['D'] || touchState.right) dx += 1;
    
    this.x = clamp(this.x + dx * this.speed * dt, playLeft + this.w/2, playRight - this.w/2);
    
    this.bankAngle += ((dx * 0.4) - this.bankAngle) * 12 * dt;
    this.thrusterPhase += dt * 15;

    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.invulnTime > 0) this.invulnTime -= dt;

    const wantsFire = keys[' '] || keys['Spacebar'] || touchState.fire;
    if (wantsFire && this.cooldown <= 0) this.fire();
  }
  fire() {
    this.cooldown = this.baseFireDelay;
    const dmg = 1 + Math.floor((this.weaponTier - 1) / 2);
    const color = this.weaponTier >= 3 ? '#0055ff' : '#00e5ff';
    const velY = -1200; 

    if (this.weaponTier === 1) { bullets.push(new Bullet(this.x, this.y - 20, 0, velY, color, dmg));
    } else if (this.weaponTier === 2) { bullets.push(new Bullet(this.x - 14, this.y - 20, 0, velY, color, dmg)); bullets.push(new Bullet(this.x + 14, this.y - 20, 0, velY, color, dmg));
    } else if (this.weaponTier >= 3) { this.cooldown *= 0.85; bullets.push(new Bullet(this.x, this.y - 20, 0, velY, color, dmg+1)); bullets.push(new Bullet(this.x - 20, this.y - 10, -200, velY, color, dmg)); bullets.push(new Bullet(this.x + 20, this.y - 10, 200, velY, color, dmg));
    }
    if (this.weaponTier >= 4) { bullets.push(new Bullet(this.x - 30, this.y, -400, velY, color, dmg)); bullets.push(new Bullet(this.x + 30, this.y, 400, velY, color, dmg)); }
    Audio2.shoot();
  }
  queueRender() {
    if (this.dead || (this.invulnTime > 0 && Math.floor(this.invulnTime * 15) % 2 === 0)) return;
    const scale = getDepthScale(this.y); const shielded = game.activePowerups.shield > 0;
    
    renderList.push({ y: this.y, draw: () => {
      drawDropShadow(this.x, this.y, 40, scale, 0.5);
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale); ctx.rotate(this.bankAngle);

      const hullGrad = ctx.createLinearGradient(0, -30, 0, 30);
      hullGrad.addColorStop(0, '#00e5ff'); hullGrad.addColorStop(0.5, '#0055ff'); hullGrad.addColorStop(1, '#02040a');
      ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 15; ctx.fillStyle = hullGrad; ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2;
      
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(25, 20); ctx.lineTo(10, 15); ctx.lineTo(0, 25); ctx.lineTo(-10, 15); ctx.lineTo(-25, 20); ctx.closePath(); ctx.fill(); ctx.stroke();

      const flick = 10 + Math.sin(this.thrusterPhase) * 5;
      ctx.fillStyle = '#00e5ff'; ctx.beginPath(); ctx.ellipse(0, 20, 7, flick, 0, 0, Math.PI*2); ctx.fill();

      if (shielded) { ctx.strokeStyle = 'rgba(0,255,170,0.8)'; ctx.lineWidth = 3; ctx.shadowColor = '#00ffaa'; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(0, 0, 45, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }});
  }
}

class Bullet {
  constructor(x, y, vx, vy, color, damage) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color; this.baseRadius = damage > 1 ? 8 : 4; this.dead = false; this.damage = damage; }
  getScaledRadius() { return this.baseRadius * getDepthScale(this.y); }
  update(dt) { const scale = getDepthScale(this.y); this.x += this.vx * scale * dt; this.y += this.vy * scale * dt; if (this.y < -50 || this.y > H + 50 || this.x < -50 || this.x > W + 50) this.dead = true; }
  queueRender() {
    const scale = getDepthScale(this.y);
    renderList.push({ y: this.y, draw: () => {
      drawDropShadow(this.x, this.y, this.baseRadius * 2.5, scale, 0.2);
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale); ctx.shadowColor = this.color; ctx.shadowBlur = 12; ctx.fillStyle = this.color;
      ctx.beginPath(); ctx.ellipse(0, 0, this.baseRadius * 0.6, this.baseRadius * 2.5, Math.atan2(this.vy, this.vx) + Math.PI/2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }});
  }
}

class Enemy {
  constructor(typeKey) {
    const def = ENEMY_TYPES[typeKey]; this.type = typeKey; this.def = def;
    this.hp = def.hp + Math.floor((game.level - 1) * 1.0); this.maxHp = this.hp; this.radius = def.radius;
    this.x = rand(playLeft + this.radius, playRight - this.radius); this.y = -50;
    this.baseSpeed = def.speed * (1 + (game.level - 1) * 0.03); this.color = def.color; this.dead = false; this.hitFlash = 0; this.wobblePhase = rand(0, Math.PI*2);
  }
  getScaledRadius() { return this.radius * getDepthScale(this.y); }
  update(dt) {
    const scale = getDepthScale(this.y);
    this.y += this.baseSpeed * scale * dt; this.wobblePhase += dt * 3; this.x += Math.sin(this.wobblePhase) * 50 * scale * dt;
    this.x = clamp(this.x, playLeft + (this.radius * scale), playRight - (this.radius * scale));
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.def.shoots && game.state === STATE.PLAYING && Math.random() < this.def.fireChance) { enemyBullets.push(new Bullet(this.x, this.y, 0, 450, '#ff2a4b', 1)); }
    if (this.y > H + (this.radius * scale)) { this.dead = true; damagePlayer(this.def.hp * 2 + 2, true); spawnHitShake(); }
  }
  queueRender() {
    const scale = getDepthScale(this.y); const bankAngle = Math.cos(this.wobblePhase) * 0.25;
    renderList.push({ y: this.y, draw: () => {
      drawDropShadow(this.x, this.y, this.radius * 1.5, scale, 0.4);
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale); ctx.rotate(bankAngle); ctx.shadowColor = this.color; ctx.shadowBlur = this.hitFlash > 0 ? 30 : 10;
      const r = this.radius; const grad = ctx.createRadialGradient(0, -r*0.2, 0, 0, 0, r);
      grad.addColorStop(0, this.hitFlash > 0 ? '#fff' : '#445a7a'); grad.addColorStop(0.3, this.hitFlash > 0 ? '#fff' : this.color); grad.addColorStop(1, '#02040a');
      ctx.fillStyle = '#010205'; ctx.strokeStyle = '#223344'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 8, r * 0.95, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = grad; ctx.strokeStyle = this.color; ctx.lineWidth = 3; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (Math.PI / 4) * i + Math.PI / 8; const px = Math.cos(a) * r; const py = Math.sin(a) * r; i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r*0.25, 0, Math.PI*2); ctx.fill();
      if(this.maxHp > 3) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-r, -r-20, r*2, 8); ctx.fillStyle = (this.hp/this.maxHp) > 0.4 ? '#00e5ff' : '#ff2a4b'; ctx.fillRect(-r, -r-20, (r*2) * (this.hp/this.maxHp), 8); }
      ctx.restore();
    }});
  }
  hit(dmg) { this.hp -= dmg; this.hitFlash = 0.08; addFloatingText(this.x, this.y - 25, dmg, '#fff'); if (this.hp <= 0) this.dead = true; }
}

class Boss extends Enemy {
  constructor() {
    super('bomber'); this.type = 'boss'; this.hp = 200 + (game.level * 40); this.maxHp = this.hp; this.radius = 120; this.color = '#ff2a4b'; this.x = W/2; this.y = -150;
    this.phase = 1; this.fireTimer = 0; this.moveDir = 1;
    document.getElementById('boss-ui').classList.remove('hidden'); document.querySelector('.boss-name').textContent = `SECTOR ${game.level} DREADNOUGHT`;
  }
  update(dt) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    const scale = getDepthScale(this.y); const pct = this.hp / this.maxHp;
    if (pct < 0.33) this.phase = 3; else if (pct < 0.66) this.phase = 2;

    if (this.y < 150) { this.y += 120 * dt; } 
    else {
      this.x += 150 * this.moveDir * scale * dt;
      const margin = 150 * scale;
      if (this.x < playLeft + margin) this.moveDir = 1; 
      if (this.x > playRight - margin) this.moveDir = -1;
      
      this.fireTimer += dt;
      if (this.phase === 1 && this.fireTimer > 1.2) { this.fireTimer = 0; enemyBullets.push(new Bullet(this.x - 60 * scale, this.y + 30 * scale, 0, 350, '#ffcc00', 1)); enemyBullets.push(new Bullet(this.x + 60 * scale, this.y + 30 * scale, 0, 350, '#ffcc00', 1)); } 
      else if (this.phase === 2 && this.fireTimer > 1.8) { this.fireTimer = 0; for (let i = 0; i < 16; i++) { let a = (Math.PI / 8) * i; enemyBullets.push(new Bullet(this.x, this.y, Math.cos(a)*250, Math.sin(a)*250, '#ff2a4b', 1)); } } 
      else if (this.phase === 3 && this.fireTimer > 0.35) { this.fireTimer = 0; let dx = player.x - this.x; let dy = player.y - this.y; let mag = Math.hypot(dx, dy); enemyBullets.push(new Bullet(this.x, this.y + 40 * scale, (dx/mag)*450 + rand(-50,50), (dy/mag)*450 + rand(-50,50), '#ff2a4b', 1)); }
    }
    document.getElementById('boss-bar-inner').style.width = Math.max(0, pct * 100) + '%';
  }
  queueRender() {
    const scale = getDepthScale(this.y);
    renderList.push({ y: this.y, draw: () => {
      drawDropShadow(this.x, this.y, this.radius * 1.2, scale, 0.6);
      ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale);
      const grad = ctx.createRadialGradient(0, -20, 0, 0, 0, this.radius); grad.addColorStop(0, '#fff'); grad.addColorStop(0.4, this.color); grad.addColorStop(1, '#010205');
      ctx.shadowColor = this.color; ctx.shadowBlur = this.hitFlash > 0 ? 50 : 25;
      ctx.fillStyle = '#010205'; ctx.beginPath(); ctx.moveTo(-110, -40); ctx.lineTo(110, -40); ctx.lineTo(140, 35); ctx.lineTo(0, 95); ctx.lineTo(-140, 35); ctx.closePath(); ctx.fill();
      ctx.fillStyle = this.hitFlash > 0 ? '#fff' : grad; ctx.strokeStyle = this.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-120, -50); ctx.lineTo(120, -50); ctx.lineTo(150, 25); ctx.lineTo(0, 85); ctx.lineTo(-150, 25); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = this.phase === 3 ? '#ffcc00' : '#00e5ff'; ctx.beginPath(); ctx.arc(0, 15, 22, 0, Math.PI*2); ctx.fill(); ctx.restore();
    }});
  }
  hit(dmg) { this.hp -= dmg; this.hitFlash = 0.08; addFloatingText(this.x + rand(-40, 40), this.y - 60, dmg, '#ff2a4b'); if (this.hp <= 0) { this.dead = true; game.bossActive = false; document.getElementById('boss-ui').classList.add('hidden'); spawnExplosion(this.x, this.y, this.color, 50); game.score += 2500 * comboMultiplier(); powerups.push(new PowerUp(this.x - 60, this.y, 'weapon')); powerups.push(new PowerUp(this.x + 60, this.y, 'shield')); } }
}

class PowerUp {
  constructor(x, y, typeKey) { this.x = x; this.y = y; this.type = typeKey; this.def = POWERUP_TYPES[typeKey]; this.baseRadius = 18; this.vy = 120; this.phase = rand(0, Math.PI * 2); this.dead = false; }
  getScaledRadius() { return this.baseRadius * getDepthScale(this.y); }
  update(dt) { this.y += this.vy * getDepthScale(this.y) * dt; this.phase += dt * 4; if (this.y > H + 50) this.dead = true; }
  queueRender() {
    const scale = getDepthScale(this.y);
    renderList.push({ y: this.y, draw: () => {
      drawDropShadow(this.x, this.y + Math.sin(this.phase)*5, this.baseRadius, scale, 0.4);
      ctx.save(); ctx.translate(this.x, this.y + Math.sin(this.phase) * 8); ctx.scale(scale, scale);
      const grad = ctx.createRadialGradient(0, -5, 0, 0, 0, this.baseRadius); grad.addColorStop(0, '#fff'); grad.addColorStop(0.5, this.def.color); grad.addColorStop(1, '#02040a');
      ctx.shadowColor = this.def.color; ctx.shadowBlur = 25; ctx.strokeStyle = this.def.color; ctx.fillStyle = grad; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.baseRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const glyph = this.type === 'weapon' ? 'W' : (this.type === 'shield' ? '🛡' : '☢'); ctx.fillText(glyph, 0, 2); ctx.restore();
    }});
  }
}

class Particle {
  constructor(x, y, color) { this.x = x; this.y = y; const a = rand(0, Math.PI * 2); const speed = rand(80, 400); this.vx = Math.cos(a) * speed; this.vy = Math.sin(a) * speed; this.life = rand(0.3, 0.8); this.maxLife = this.life; this.color = color; this.size = rand(3, 8); }
  update(dt) { const scale = getDepthScale(this.y); this.x += this.vx * scale * dt; this.y += this.vy * scale * dt; this.vx *= 0.94; this.vy *= 0.94; this.life -= dt; }
  queueRender() {
    const scale = getDepthScale(this.y); const t = clamp(this.life / this.maxLife, 0, 1);
    renderList.push({ y: this.y, draw: () => { ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale); ctx.globalAlpha = t; ctx.fillStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 15; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }});
  }
}

class FloatingText {
  constructor(x, y, text, color) { this.x = x; this.y = y; this.text = text; this.color = color; this.life = 0.9; this.maxLife = 0.9; this.vy = -60; }
  update(dt) { this.y += this.vy * getDepthScale(this.y) * dt; this.life -= dt; }
  queueRender() {
    const scale = getDepthScale(this.y);
    renderList.push({ y: this.y + 100, draw: () => { ctx.save(); ctx.translate(this.x, this.y); ctx.scale(scale, scale); ctx.globalAlpha = clamp(this.life / this.maxLife, 0, 1); ctx.fillStyle = this.color; ctx.font = 'bold 20px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.text, 0, 0); ctx.restore(); }});
  }
}

function spawnExplosion(x, y, color, count = 20) { for (let i = 0; i < count; i++) particles.push(new Particle(x, y, color)); Audio2.explosion(); }
function addFloatingText(x, y, text, color) { floatingTexts.push(new FloatingText(x, y, text, color)); }
function spawnHitShake(mag = 12) { game.shakeTime = 0.3; game.shakeMag = mag; }

let player = new Player();

/* --- INPUT HANDLING --- */
const touchState = { left: false, right: false, fire: false };

window.addEventListener('keydown', (e) => { keys[e.key] = true; if (e.key === ' ') e.preventDefault(); if ((e.key === 'p' || e.key === 'P') && (game.state === STATE.PLAYING || game.state === STATE.PAUSED)) togglePause(); if ((e.key === 'b' || e.key === 'B') && game.state === STATE.PLAYING) triggerBomb(); });
window.addEventListener('keyup', (e) => { keys[e.key] = false; });

// Touch Control Binders with comprehensive mouse fallback for testability
function bindTouchButton(id, stateKey, isBomb = false) {
  const el = document.getElementById(id); if (!el) return;
  const press = (e) => { e.preventDefault(); if(isBomb) triggerBomb(); else touchState[stateKey] = true; };
  const release = (e) => { e.preventDefault(); if(!isBomb) touchState[stateKey] = false; };
  
  el.addEventListener('touchstart', press, { passive: false }); 
  el.addEventListener('touchend', release, { passive: false }); 
  el.addEventListener('touchcancel', release, { passive: false });
  
  // Mouse fallbacks to ensure robust clicking on non-touch devices
  el.addEventListener('mousedown', press);
  el.addEventListener('mouseup', release);
  el.addEventListener('mouseleave', release);
}
bindTouchButton('btn-left', 'left'); bindTouchButton('btn-right', 'right'); bindTouchButton('btn-fire', 'fire'); bindTouchButton('btn-bomb', 'bomb', true);

// Enable Gamepad if touch is natively supported
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.getElementById('mobile-gamepad').classList.add('enabled');

/* --- LOGIC --- */
function spawnEnemy() {
  if (game.bossActive) return;
  const available = Object.keys(ENEMY_TYPES).filter(k => ENEMY_TYPES[k].minLevel <= game.level);
  let r = rand(0, available.length * 2); let picked = available[0];
  for (let i = 0; i < available.length; i++) { if (r < (available.length - i)*2) { picked = available[i]; break; } }
  enemies.push(new Enemy(picked));
}
function maybeDropPowerup(x, y) { if (Math.random() < 0.12) powerups.push(new PowerUp(x, y, Object.keys(POWERUP_TYPES)[randInt(0, Object.keys(POWERUP_TYPES).length - 1)])); }
function updateDifficulty() {
  const newLevel = 1 + Math.floor(game.score / 1200);
  if (newLevel !== game.level) {
    game.level = newLevel; Audio2.levelUp(); game.toastText = `SECTOR ${game.level}`; game.toastTimer = 1.8;
    if (game.level % 5 === 0) { game.bossActive = true; enemies.push(new Boss()); }
  }
  game.spawnInterval = clamp(1.2 - (game.level - 1) * 0.08, 0.4, 1.2);
}

function triggerBomb() {
  if (game.bombs <= 0 || player.dead) return;
  game.bombs--; Audio2.bomb(); spawnHitShake(20);
  const flash = document.getElementById('screen-flash'); flash.style.opacity = '1'; setTimeout(() => { flash.style.opacity = '0'; }, 100);
  enemyBullets.length = 0; enemies.forEach(en => { en.hit(40); if (!en.dead) addFloatingText(en.x, en.y, "EMP HIT!", "#ffcc00"); });
}

function damagePlayer(amount, bypassShield = false) {
  if (game.state !== STATE.PLAYING) return;
  if (game.activePowerups.shield > 0 && !bypassShield) { addFloatingText(player.x, player.y-40, "DEFLECTED", "#00ffaa"); return; }
  if (player.invulnTime > 0) return;
  game.health = clamp(game.health - amount, 0, game.maxHealth); game.combo = 0; game.comboTimer = 0;
  spawnHitShake(); Audio2.hit(); player.invulnTime = 1.2;
  if (game.health <= 0) { game.state = STATE.DYING; player.dead = true; game.deathTimer = 3.0; spawnExplosion(player.x, player.y, '#00e5ff', 50); Audio2.gameOver(); spawnHitShake(18); }
}

function checkCollisions() {
  for (const b of bullets) {
    if (b.dead) continue;
    for (const en of enemies) {
      if (en.dead) continue;
      if (dist2(b.x, b.y, en.x, en.y) <= Math.pow(b.getScaledRadius() + en.getScaledRadius(), 2)) {
        b.dead = true; en.hit(b.damage);
        if (en.dead && en.type !== 'boss') { game.combo += 1; game.comboTimer = COMBO_WINDOW; game.score += Math.round(en.def.points * comboMultiplier()); spawnExplosion(en.x, en.y, en.color); maybeDropPowerup(en.x, en.y); }
        break;
      }
    }
  }
  for (const eb of enemyBullets) { if (!eb.dead && player.invulnTime <= 0 && dist2(eb.x, eb.y, player.x, player.y) <= Math.pow(eb.getScaledRadius() + player.getScaledRadius(), 2)) { eb.dead = true; damagePlayer(8); } }
  for (const en of enemies) { if (!en.dead && player.invulnTime <= 0 && dist2(en.x, en.y, player.x, player.y) <= Math.pow(en.getScaledRadius() + player.getScaledRadius(), 2)) { if(en.type !== 'boss') en.dead = true; spawnExplosion(en.x, en.y, en.color); damagePlayer(en.type==='boss' ? 25 : en.def.hp * 3 + 5); } }
  for (const p of powerups) {
    if (!p.dead && dist2(p.x, p.y, player.x, player.y) <= Math.pow(p.getScaledRadius() + player.getScaledRadius(), 2)) {
      p.dead = true; Audio2.powerup(); addFloatingText(player.x, player.y - 30, p.def.label, p.def.color);
      if (p.type === 'weapon') { player.weaponTier = clamp(player.weaponTier + 1, 1, 5); } else if (p.type === 'bomb') { game.bombs++; } else { game.activePowerups[p.type] = p.def.duration; }
    }
  }
}

/* --- UI --- */
const el = { hud: document.getElementById('hud'), pauseBtn: document.getElementById('pause-btn'), muteBtn: document.getElementById('mute-btn'), comboDisplay: document.getElementById('combo-display'), levelToast: document.getElementById('level-toast'), scoreValue: document.getElementById('score-value'), highscoreValue: document.getElementById('highscore-value'), levelValue: document.getElementById('level-value'), healthInner: document.getElementById('health-bar-inner'), healthText: document.getElementById('health-text'), bombCount: document.getElementById('bomb-count'), activePowerups: document.getElementById('active-powerups') };
function updateHUD() {
  el.scoreValue.textContent = game.score; el.highscoreValue.textContent = game.highScore; el.levelValue.textContent = game.level; el.bombCount.textContent = game.bombs;
  const pct = clamp(game.health / game.maxHealth, 0, 1) * 100; el.healthInner.style.width = pct + '%'; el.healthText.textContent = Math.ceil(game.health);
  el.healthInner.style.background = pct > 50 ? 'linear-gradient(90deg, #00ffaa, #00e5ff)' : pct > 20 ? 'linear-gradient(90deg, #ffcc00, #ff6a00)' : 'linear-gradient(90deg, #ff2a4b, #990000)';
  el.activePowerups.innerHTML = '';
  for (const key of Object.keys(game.activePowerups)) { if (game.activePowerups[key] > 0) { const chip = document.createElement('span'); chip.className = 'powerup-chip'; chip.style.color = POWERUP_TYPES[key].color; chip.textContent = `${POWERUP_TYPES[key].label} ${Math.ceil(game.activePowerups[key])}s`; el.activePowerups.appendChild(chip); } }
  if (game.combo >= 3) { el.comboDisplay.textContent = `${game.combo}x COMBO  ×${comboMultiplier().toFixed(1)}`; el.comboDisplay.classList.remove('hidden'); } else { el.comboDisplay.classList.add('hidden'); }
  el.levelToast.classList.toggle('hidden', game.toastTimer <= 0); if (game.toastTimer > 0) el.levelToast.textContent = game.toastText;
}

/* --- LOOP --- */
function update(dt) {
  updateEnvironment(dt);

  if (game.state === STATE.START) return;

  if (game.state === STATE.OVER) {
    particles.forEach(p => p.update(dt));
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    return;
  }

  if (game.state !== STATE.PLAYING && game.state !== STATE.DYING) return;

  if (game.state === STATE.DYING) {
    dt *= 0.3; game.deathTimer -= dt;
    if (Math.random() < 0.2) spawnExplosion(player.x + rand(-60, 60), player.y + rand(-60, 60), '#ff2a4b', 12);
    if (game.deathTimer <= 0) {
      game.state = STATE.OVER; const isNew = game.score > game.highScore;
      if (isNew) { game.highScore = game.score; saveHighScore(game.highScore); }
      document.getElementById('final-score').textContent = game.score; document.getElementById('final-highscore').textContent = game.highScore; document.getElementById('final-level').textContent = game.level; document.getElementById('new-highscore-badge').classList.toggle('hidden', !isNew); showScreen('over');
    }
  } else { player.update(dt); }

  for (const key of Object.keys(game.activePowerups)) { game.activePowerups[key] -= dt; if (game.activePowerups[key] <= 0) delete game.activePowerups[key]; }
  if (game.combo > 0) { game.comboTimer -= dt; if (game.comboTimer <= 0) game.combo = 0; }
  if (game.toastTimer > 0) game.toastTimer -= dt;

  bullets.forEach(b => b.update(dt)); enemyBullets.forEach(b => b.update(dt));
  enemies.forEach(en => en.update(dt)); powerups.forEach(p => p.update(dt));
  particles.forEach(p => p.update(dt)); floatingTexts.forEach(ft => ft.update(dt));

  if (game.state === STATE.PLAYING) checkCollisions();

  game.spawnTimer += dt; if (game.spawnTimer >= game.spawnInterval) { game.spawnTimer = 0; spawnEnemy(); }
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
  drawGridAndStars();

  renderList = [];

  if (game.state === STATE.PLAYING || game.state === STATE.PAUSED || game.state === STATE.DYING || game.state === STATE.OVER) {
    powerups.forEach(p => p.queueRender()); 
    enemies.forEach(en => en.queueRender());
    bullets.forEach(b => b.queueRender()); 
    enemyBullets.forEach(b => b.queueRender());
    particles.forEach(p => p.queueRender()); 
    if (!player.dead) player.queueRender(); 
    floatingTexts.forEach(ft => ft.queueRender());
  }
  
  if (renderList.length > 0) {
    renderList.sort((a, b) => a.y - b.y);
    renderList.forEach(item => item.draw());
  }

  ctx.restore();
  if (game.state === STATE.PAUSED) { ctx.fillStyle = 'rgba(2,4,10,0.45)'; ctx.fillRect(0, 0, W, H); }
}

function loop(timestamp) {
  if (!game.lastTime) game.lastTime = timestamp; let dt = Math.min((timestamp - game.lastTime) / 1000, 0.05);
  game.lastTime = timestamp; update(dt); draw(); requestAnimationFrame(loop);
}

/* --- STATE TRANSITIONS --- */
function showScreen(name) {
  document.getElementById('start-screen').classList.toggle('hidden', name !== 'start'); document.getElementById('pause-screen').classList.toggle('hidden', name !== 'pause'); document.getElementById('gameover-screen').classList.toggle('hidden', name !== 'over');
  el.hud.classList.toggle('hidden', name !== 'hud'); el.pauseBtn.classList.toggle('hidden', name !== 'hud'); el.muteBtn.classList.toggle('hidden', name !== 'hud');
}
function startGame() {
  Audio2.ensure(); game.state = STATE.PLAYING; game.score = 0; game.level = 1; game.health = game.maxHealth; game.bombs = 2; game.spawnTimer = 0; game.spawnInterval = 1.2; game.activePowerups = {}; game.bossActive = false; game.combo = 0; game.comboTimer = 0; game.toastTimer = 0;
  bullets.length = 0; enemyBullets.length = 0; enemies.length = 0; powerups.length = 0; particles.length = 0; floatingTexts.length = 0;
  player.reset(); el.comboDisplay.classList.add('hidden'); document.getElementById('boss-ui').classList.add('hidden'); document.getElementById('start-highscore').textContent = game.highScore; showScreen('hud'); updateHUD();
}
function togglePause() { if (game.state === STATE.PLAYING) { game.state = STATE.PAUSED; showScreen('pause'); el.hud.classList.remove('hidden'); } else if (game.state === STATE.PAUSED) { game.state = STATE.PLAYING; showScreen('hud'); } }

document.getElementById('start-btn').addEventListener('click', startGame); document.getElementById('pause-btn').addEventListener('click', togglePause); document.getElementById('resume-btn').addEventListener('click', togglePause); document.getElementById('restart-btn-pause').addEventListener('click', startGame); document.getElementById('restart-btn').addEventListener('click', startGame);
el.muteBtn.addEventListener('click', () => { Audio2.muted = !Audio2.muted; el.muteBtn.textContent = Audio2.muted ? '🔇' : '🔊'; el.muteBtn.classList.toggle('muted', Audio2.muted); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === STATE.PLAYING) togglePause(); });
document.getElementById('start-highscore').textContent = game.highScore;
resizeCanvas(); requestAnimationFrame(loop);
