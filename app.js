/*
 * BAT Milestones — app.js
 *
 * ─── ONE-TIME SUPABASE SETUP (~5 min) ──────────────────────────────────────
 *
 *  1. Create a free account at https://supabase.com → New project.
 *  2. In the SQL Editor run every statement in the block below.
 *  3. Go to Project Settings → API.
 *     Copy "Project URL"  → paste as SUPABASE_URL below.
 *     Copy "anon public"  → paste as SUPABASE_KEY below.
 *  4. Deploy. Done.
 *
 * ─── SQL (run once in Supabase SQL Editor) ─────────────────────────────────
 *
 *  CREATE TABLE scores (
 *    id         TEXT        PRIMARY KEY,
 *    name       TEXT        NOT NULL,
 *    score      INTEGER     NOT NULL DEFAULT 0,
 *    fact_ids   TEXT[]      NOT NULL DEFAULT '{}',
 *    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *  );
 *
 *  ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
 *
 *  CREATE POLICY "read_all" ON scores FOR SELECT USING (true);
 *
 *  CREATE OR REPLACE FUNCTION submit_score(
 *    p_id TEXT, p_name TEXT, p_score INTEGER, p_fact_ids TEXT[]
 *  )
 *  RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
 *  BEGIN
 *    INSERT INTO scores (id, name, score, fact_ids, updated_at)
 *    VALUES (p_id, p_name, p_score, p_fact_ids, NOW())
 *    ON CONFLICT (id) DO UPDATE SET
 *      name       = EXCLUDED.name,
 *      score      = GREATEST(scores.score, EXCLUDED.score),
 *      fact_ids   = CASE WHEN EXCLUDED.score >= scores.score
 *                        THEN EXCLUDED.fact_ids
 *                        ELSE scores.fact_ids END,
 *      updated_at = NOW();
 *  END;
 *  $$;
 *
 *  GRANT EXECUTE ON FUNCTION submit_score TO anon;
 *
 * ───────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  //  CONFIG — paste your Supabase credentials here before deploying
  // ══════════════════════════════════════════════════════════════════════════
  const SUPABASE_URL = 'https://vwirzmrvzljqgeplqxox.supabase.co';   // Project URL
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3aXJ6bXJ2emxqcWdlcGxxeG94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5ODc0NzIsImV4cCI6MjA5ODU2MzQ3Mn0.RGBsdf5p34guWXyD7cc7BxxBlZBJCAmVFMHzII6a86w';                        // anon / public key
  // ──────────────────────────────────────────────────────────────────────────

  const PLAYER_KEY = 'bat_milestones_player';

  // ══════════════════════════════════════════════════════════════════════════
  //  DATABASE  (Supabase REST — no SDK, plain fetch)
  // ══════════════════════════════════════════════════════════════════════════
  const db = (() => {
    const configured =
      !SUPABASE_URL.includes('REPLACE_ME') && !SUPABASE_KEY.includes('REPLACE_ME');

    function headers() {
      return {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      };
    }

    return {
      configured,

      /** Returns an array of score rows ordered by score desc. */
      async leaderboard() {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/scores?select=*&order=score.desc&limit=50`,
          { headers: headers(), cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`leaderboard: ${res.status}`);
        return res.json();
      },

      /**
       * Atomically upserts one row via a Postgres function.
       * The function keeps GREATEST(existing, new) — never overwrites a better run.
       */
      async submit(player, score, factIds) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/submit_score`,
          {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              p_id:      player.id,
              p_name:    player.name,
              p_score:   score,
              p_fact_ids: factIds,
            }),
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`submit_score: ${res.status} ${body}`);
        }
      },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════════
  //  PLAYER  (persistent UUID per browser via localStorage)
  //
  //  First visit  → nothing in storage  → name overlay shown
  //  Return visit → player object found → name overlay skipped
  // ══════════════════════════════════════════════════════════════════════════
  function loadPlayer() {
    try {
      const p = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
      return p && p.id && p.name ? p : null;
    } catch {
      return null;
    }
  }

  function createPlayer(name) {
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : `p-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const player = { id, name: name.trim().slice(0, 16) || 'Flyer' };
    try { localStorage.setItem(PLAYER_KEY, JSON.stringify(player)); } catch {}
    return player;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME CONSTANTS
  // ══════════════════════════════════════════════════════════════════════════
  const GRAVITY      = 0.42;
  const FLAP_VEL     = -7.4;
  const PIPE_GAP     = 152;
  const PIPE_W       = 58;
  const PIPE_SPACING = 210;
  const GROUND_H     = 64;
  const BIRD_X       = 96;
  const BIRD_R       = 16;

  const MILESTONES = [
    { id: 'm0',  year: '1902',    text: 'Born from a truce between Imperial Tobacco and American Tobacco.' },
    { id: 'm1',  year: '1911',    text: 'A US antitrust ruling sent BAT onto the London Stock Exchange.' },
    { id: 'm2',  year: '1927',    text: 'BAT re-entered the US market by buying Brown & Williamson.' },
    { id: 'm3',  year: 'WWI',     text: 'Soldiers switched habits, and BAT grew with the cigarette boom.' },
    { id: 'm4',  year: '1994',    text: 'BAT bought its former parent, American Tobacco Co.' },
    { id: 'm5',  year: '1999',    text: 'The Rothmans merger brought Dunhill into the fold.' },
    { id: 'm6',  year: '2000',    text: 'BAT acquired Imperial Tobacco Canada.' },
    { id: 'm7',  year: '2017',    text: 'Full ownership of Reynolds American became one of BATs biggest deals.' },
    { id: 'm8',  year: 'Today',   text: 'BAT now operates in 180+ countries.' },
    { id: 'm9',  year: 'People',  text: 'BATs workforce spans 47,000+ people across six continents.' },
    { id: 'm10', year: 'Regions', text: 'The business is organized across three major regions.' },
    { id: 'm11', year: 'Brands',  text: 'Vuse, glo, and Velo are the main smokeless growth brands.' },
    { id: 'm12', year: 'R&D',     text: 'BAT spends heavily on reinventing a century-old category.' },
    { id: 'm13', year: 'Supply',  text: 'More than 91,000 farmers support the leaf supply chain.' },
    { id: 'm14', year: '2030',    text: 'BAT targets 50 million smokeless consumers by 2030.' },
    { id: 'm15', year: '2050',    text: 'BAT has a net-zero target for its value chain by 2050.' },
  ];

  // ══════════════════════════════════════════════════════════════════════════
  //  DOM REFS
  // ══════════════════════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);

  const canvas          = $('gameCanvas');
  const ctx             = canvas.getContext('2d');
  const W               = canvas.width;
  const H               = canvas.height;

  const nameOverlay     = $('nameOverlay');
  const startOverlay    = $('startOverlay');
  const overOverlay     = $('overOverlay');
  const factsOverlay    = $('factsOverlay');
  const nameInput       = $('nameInput');
  const nameSubmit      = $('nameSubmit');
  const startBtn        = $('startBtn');
  const retryBtn        = $('retryBtn');
  const greeting        = $('greeting');
  const finalScoreEl    = $('finalScore');
  const overNote        = $('overNote');
  const boardList       = $('boardList');
  const viewFactsList   = $('viewFactsList');
  const closeFactsBtn   = $('closeFactsBtn');
  const factsTitle      = $('factsTitle');
  const milestoneBanner = $('milestoneBanner');
  const factsList       = $('factsList');
  const refreshBtn      = $('refreshBtn');
  const lastUpdatedEl   = $('lastUpdated');
  const setupBanner     = $('setupBanner');

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME STATE
  // ══════════════════════════════════════════════════════════════════════════
  const state = {
    mode:   'name',   // 'name' | 'start' | 'playing' | 'over'
    player: null,
    best:   0,        // confirmed personal best from the leaderboard
    score:  0,
    speed:  2.6,
    frame:  0,
    groundOffset: 0,
    bird:   { y: H / 2 - 60, vy: 0, rot: 0 },
    pipes:  [],
    clouds: Array.from({ length: 5 }, () => ({
      x: Math.random() * W,
      y: 40 + Math.random() * 140,
      s: 0.6 + Math.random() * 0.8,
      v: 0.15 + Math.random() * 0.2,
    })),
    roundMilestones: [],
    milestoneCursor: 0,
    uncoveredFacts:  [],
    milestoneTimer:  null,
  };

  // ══════════════════════════════════════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════════════════════════════════════
  function esc(v) {
    return String(v).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function rgb([r, g, b]) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

  function lerpArr(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }

  // ══════════════════════════════════════════════════════════════════════════
  //  LEADERBOARD
  // ══════════════════════════════════════════════════════════════════════════
  let _boardBusy = false;

  function setRefreshState(busy) {
    _boardBusy = busy;
    if (refreshBtn) {
      refreshBtn.disabled    = busy;
      refreshBtn.textContent = busy ? '…' : '↺';
    }
  }

  function renderBoard(entries) {
    boardList.innerHTML = '';
    if (!entries.length) {
      boardList.innerHTML = '<div class="board-empty">no flights yet — be the first!</div>';
      return;
    }
    entries.forEach((entry, i) => {
      const isMine  = state.player && entry.id === state.player.id;
      const rankCls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const li      = document.createElement('li');
      li.className  = isMine ? 'me' : '';
      li.title      = 'View discovered facts';
      li.style.cursor = 'pointer';
      li.innerHTML  =
        `<span class="rank ${rankCls}">${isMine ? 'YOU' : '#' + (i + 1)}</span>` +
        `<span class="lb-name">${esc(entry.name || 'Flyer')}</span>` +
        `<span class="lb-score">${entry.score}</span>`;
      li.addEventListener('click', () => showPlayerFacts(entry));
      boardList.appendChild(li);
    });
  }

  async function refreshLeaderboard() {
    if (_boardBusy) return;

    if (!db.configured) {
      boardList.innerHTML =
        '<div class="board-error">Fill in SUPABASE_URL + SUPABASE_KEY in app.js</div>';
      return;
    }

    setRefreshState(true);
    boardList.innerHTML = '<div class="board-empty">loading…</div>';

    try {
      const entries = await db.leaderboard();
      // Keep our local best in sync with the server
      const mine = state.player ? entries.find(e => e.id === state.player.id) : null;
      if (mine) state.best = mine.score;
      renderBoard(entries);
      if (lastUpdatedEl) lastUpdatedEl.textContent = new Date().toLocaleTimeString();
    } catch (err) {
      console.error('[leaderboard]', err);
      boardList.innerHTML = "<div class='board-error'>couldn't load scores</div>";
    } finally {
      setRefreshState(false);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SCORE SUBMISSION
  // ══════════════════════════════════════════════════════════════════════════
  async function submitAndRefresh() {
    if (!state.player) return;

    if (db.configured) {
      try {
        await db.submit(state.player, state.score, state.uncoveredFacts.slice());
      } catch (err) {
        console.error('[submit]', err);
        // Non-fatal — fall through to refresh so the board still updates
      }
    }

    await refreshLeaderboard();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  SKY
  // ══════════════════════════════════════════════════════════════════════════
  function skyForScore(score) {
    const stages = [
      { at: 0,  top: [43,16,85],  bot: [117,151,222], grd: [61,214,151],  sun: false, stars: 0   },
      { at: 8,  top: [63,26,90],  bot: [214,140,120], grd: [214,150,90],  sun: true,  stars: 0   },
      { at: 16, top: [74,24,72],  bot: [255,150,110], grd: [214,120,80],  sun: true,  stars: 0.2 },
      { at: 26, top: [35,14,58],  bot: [120,70,110],  grd: [90,70,110],   sun: true,  stars: 0.6 },
      { at: 36, top: [10,8,28],   bot: [35,24,66],    grd: [40,40,70],    sun: false, stars: 1   },
    ];

    let lo = stages[0], hi = stages[stages.length - 1];
    for (let i = 0; i < stages.length - 1; i++) {
      if (score >= stages[i].at && score < stages[i + 1].at) {
        lo = stages[i]; hi = stages[i + 1]; break;
      }
    }

    const t = Math.min(1, (score - lo.at) / Math.max(1, hi.at - lo.at));
    return {
      top:   lerpArr(lo.top, hi.top, t),
      bot:   lerpArr(lo.bot, hi.bot, t),
      grd:   lerpArr(lo.grd, hi.grd, t),
      sun:   lo.sun || hi.sun,
      stars: lo.stars + (hi.stars - lo.stars) * t,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DRAWING
  // ══════════════════════════════════════════════════════════════════════════
  function drawBackground(sky) {
    const g = ctx.createLinearGradient(0, 0, 0, H - GROUND_H);
    g.addColorStop(0, rgb(sky.top));
    g.addColorStop(1, rgb(sky.bot));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H - GROUND_H);

    if (sky.stars > 0.05) {
      ctx.fillStyle = `rgba(255,255,255,${sky.stars * 0.9})`;
      for (let i = 0; i < 24; i++) {
        ctx.fillRect((i * 53 + 17) % W, (i * 97 + 11) % (H * 0.5), 2, 2);
      }
    }

    const bodyY = 70 + Math.sin(state.frame * 0.003) * 4;
    ctx.beginPath();
    ctx.fillStyle = sky.sun ? '#ffe28a' : '#e9e6f5';
    ctx.arc(W - 70, bodyY, 26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    state.clouds.forEach(cl => {
      ctx.beginPath();
      ctx.ellipse(cl.x, cl.y, 26 * cl.s, 12 * cl.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cl.x + 18 * cl.s, cl.y + 4 * cl.s, 18 * cl.s, 10 * cl.s, 0, 0, Math.PI * 2);
      ctx.fill();
      if (state.mode === 'playing') {
        cl.x -= cl.v;
        if (cl.x < -40) cl.x = W + 40;
      }
    });
  }

  function drawPipes() {
    state.pipes.forEach(pipe => {
      const g = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_W, 0);
      g.addColorStop(0, '#4a4550');
      g.addColorStop(0.5, '#8a8494');
      g.addColorStop(1, '#4a4550');
      ctx.fillStyle = g;

      ctx.fillRect(pipe.x, 0, PIPE_W, pipe.top);
      const bY = pipe.top + PIPE_GAP;
      ctx.fillRect(pipe.x, bY, PIPE_W, H - GROUND_H - bY);

      // Seam lines
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      for (let y = 20; y < pipe.top; y += 22) {
        ctx.beginPath(); ctx.moveTo(pipe.x + 3, y); ctx.lineTo(pipe.x + PIPE_W - 3, y); ctx.stroke();
      }
      for (let y = bY + 20; y < H - GROUND_H; y += 22) {
        ctx.beginPath(); ctx.moveTo(pipe.x + 3, y); ctx.lineTo(pipe.x + PIPE_W - 3, y); ctx.stroke();
      }

      // Caps
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(pipe.x - 5, pipe.top - 14, PIPE_W + 10, 14);
      ctx.fillRect(pipe.x - 5, bY,            PIPE_W + 10, 14);

      // Year label
      if (pipe.milestone) {
        ctx.font = "8px 'ui-monospace', monospace";
        ctx.textAlign = 'center';
        ctx.fillStyle = '#3a1f0a';
        ctx.fillText(pipe.milestone.year, pipe.x + PIPE_W / 2, pipe.top - 4);
      }
    });
  }

  function drawGround(sky) {
    ctx.fillStyle = rgb(sky.grd);
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    for (let x = -(state.groundOffset % 28); x < W; x += 28) {
      ctx.fillRect(x, H - GROUND_H, 14, 8);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, H - GROUND_H, W, 4);
  }

  function drawBird() {
    ctx.save();
    ctx.translate(BIRD_X, state.bird.y);
    ctx.rotate(state.bird.rot);

    const flap = Math.sin(state.frame * 0.35) * 6;

    // Wing
    ctx.fillStyle = '#8a1c2e';
    ctx.beginPath();
    ctx.ellipse(-4, 3 + flap * 0.3, 9, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Body
    const g = ctx.createRadialGradient(-4, -4, 2, 0, 0, BIRD_R);
    g.addColorStop(0, '#a8283f');
    g.addColorStop(1, '#7a1626');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();

    // Gold ring
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R - 1.5, 0, Math.PI * 2);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#f0dfa0';
    ctx.font = "bold 10px var(--body-font)";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BAT', 0, 1);
    ctx.textBaseline = 'alphabetic';

    ctx.restore();
  }

  function drawScore() {
    ctx.font = "20px var(--display-font)";
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.strokeText(String(state.score), W / 2, 56);
    ctx.fillStyle = '#fff';
    ctx.fillText(String(state.score), W / 2, 56);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  PHYSICS & GAME LOOP
  // ══════════════════════════════════════════════════════════════════════════
  function resetGame() {
    state.bird            = { y: H / 2 - 60, vy: 0, rot: 0 };
    state.pipes           = [];
    state.score           = 0;
    state.speed           = 2.6;
    state.frame           = 0;
    state.groundOffset    = 0;
    state.milestoneCursor = 0;
    state.roundMilestones = shuffled(MILESTONES);
    state.uncoveredFacts  = [];
    spawnPipe(W + 100);
    spawnPipe(W + 100 + PIPE_SPACING);
    spawnPipe(W + 100 + PIPE_SPACING * 2);
  }

  function spawnPipe(x) {
    const margin = 60;
    const top    = margin + Math.random() * (H - GROUND_H - PIPE_GAP - margin * 2);
    const ms     = state.roundMilestones[state.milestoneCursor % state.roundMilestones.length];
    state.milestoneCursor++;
    state.pipes.push({ x, top, passed: false, milestone: ms });
  }

  function flap() {
    if (state.mode === 'playing') {
      state.bird.vy = FLAP_VEL;
    } else if (state.mode === 'start') {
      state.mode = 'playing';
      hideOverlays();
    }
  }

  function update() {
    state.frame++;
    if (state.mode !== 'playing') return;

    // Physics
    state.bird.vy     += GRAVITY;
    state.bird.y      += state.bird.vy;
    state.bird.rot     = Math.max(-0.5, Math.min(1.3, state.bird.vy * 0.06));
    state.groundOffset += state.speed;

    // Pipe movement + recycling
    state.pipes.forEach(p => { p.x -= state.speed; });
    if (state.pipes.length && state.pipes[0].x < -PIPE_W - 10) {
      state.pipes.shift();
      spawnPipe(state.pipes[state.pipes.length - 1].x + PIPE_SPACING);
    }

    // Scoring + milestone banners
    state.pipes.forEach(p => {
      if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
        p.passed = true;
        state.score++;
        state.speed = Math.min(5.2, 2.6 + state.score * 0.045);
        if (p.milestone) {
          showMilestoneBanner(p.milestone);
          if (!state.uncoveredFacts.includes(p.milestone.id)) {
            state.uncoveredFacts.push(p.milestone.id);
          }
        }
      }
    });

    // Collision detection
    const hitGround  = state.bird.y + BIRD_R * 0.82 > H - GROUND_H;
    const hitCeiling = state.bird.y - BIRD_R < 0;
    const hitPipe    = state.pipes.some(p => {
      const inX = BIRD_X + BIRD_R * 0.7 > p.x && BIRD_X - BIRD_R * 0.7 < p.x + PIPE_W;
      return inX && (state.bird.y - BIRD_R * 0.75 < p.top || state.bird.y + BIRD_R * 0.75 > p.top + PIPE_GAP);
    });

    if (hitGround || hitCeiling || hitPipe) showGameOver();
  }

  function draw() {
    const sky = skyForScore(state.mode === 'playing' || state.mode === 'over' ? state.score : 0);
    drawBackground(sky);
    drawPipes();
    drawGround(sky);
    drawBird();
    if (state.mode === 'playing') drawScore();
  }

  function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  UI
  // ══════════════════════════════════════════════════════════════════════════
  function hideOverlays() {
    [nameOverlay, startOverlay, overOverlay, factsOverlay].forEach(o => o.classList.add('hidden'));
  }

  function showMilestoneBanner(ms) {
    milestoneBanner.innerHTML = `<span class="yr">${esc(ms.year)}</span>${esc(ms.text)}`;
    milestoneBanner.classList.remove('hidden');
    clearTimeout(state.milestoneTimer);
    state.milestoneTimer = setTimeout(() => milestoneBanner.classList.add('hidden'), 2200);
  }

  function renderFactsList(container, factIds) {
    container.innerHTML = '';
    const ids = Array.isArray(factIds) ? factIds : [];
    if (!ids.length) {
      container.innerHTML = '<div class="facts-empty">no facts uncovered yet</div>';
      return;
    }
    ids.forEach(id => {
      const ms = MILESTONES.find(m => m.id === id);
      if (!ms) return;
      const li = document.createElement('li');
      li.innerHTML = `<span class="yr">${esc(ms.year)}</span>${esc(ms.text)}`;
      container.appendChild(li);
    });
  }

  // Remember which overlay was active before the facts overlay opened
  let _factsOriginOverlay = null;

  function showPlayerFacts(entry) {
    _factsOriginOverlay =
      !overOverlay.classList.contains('hidden')  ? overOverlay :
      !startOverlay.classList.contains('hidden') ? startOverlay : null;

    factsTitle.textContent = `${esc(entry.name || 'Flyer').toUpperCase()}'S FACTS`;
    renderFactsList(viewFactsList, entry.fact_ids || []);
    hideOverlays();
    factsOverlay.classList.remove('hidden');
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME FLOW
  // ══════════════════════════════════════════════════════════════════════════
  function showStart() {
    state.mode = 'start';
    resetGame();
    hideOverlays();
    milestoneBanner.classList.add('hidden');
    greeting.textContent = state.player ? `READY, ${state.player.name.toUpperCase()}?` : 'READY?';
    startOverlay.classList.remove('hidden');
  }

  async function showGameOver() {
    if (state.mode !== 'playing') return;   // guard against double-fire
    state.mode = 'over';
    hideOverlays();

    finalScoreEl.textContent = String(state.score);

    // Accurate note — compare to the best confirmed BEFORE this run
    const prevBest = state.best || 0;
    overNote.textContent =
      state.score > prevBest ? 'new personal best!' :
      prevBest > 0           ? `personal best: ${prevBest}` :
                               'first flight!';

    renderFactsList(factsList, state.uncoveredFacts);
    overOverlay.classList.remove('hidden');

    // Submit score then refresh board (board always updates, even if submit fails)
    await submitAndRefresh();
  }

  function finalizeName() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    state.player = createPlayer(name);
    showStart();
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  EVENTS
  // ══════════════════════════════════════════════════════════════════════════
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); flap(); });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); flap(); }
  });

  nameSubmit.addEventListener('click', finalizeName);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') finalizeName(); });

  startBtn.addEventListener('click', () => { state.mode = 'playing'; hideOverlays(); });

  retryBtn.addEventListener('click', showStart);

  closeFactsBtn.addEventListener('click', () => {
    hideOverlays();
    // Return to wherever the user was before they opened the facts overlay
    if (_factsOriginOverlay) {
      _factsOriginOverlay.classList.remove('hidden');
    } else {
      showStart();
    }
  });

  if (refreshBtn) refreshBtn.addEventListener('click', refreshLeaderboard);

  // ══════════════════════════════════════════════════════════════════════════
  //  BOOT
  // ══════════════════════════════════════════════════════════════════════════
  function boot() {
    if (!db.configured && setupBanner) setupBanner.classList.remove('hidden');

    state.player = loadPlayer();
    state.best   = 0;

    if (state.player) {
      showStart();          // returning user — skip the name prompt
    } else {
      state.mode = 'name';
      nameOverlay.classList.remove('hidden');
      nameInput.focus();
    }

    refreshLeaderboard();   // load board in background (non-blocking)
    setInterval(refreshLeaderboard, 5000); // auto-refresh every 5 s
    loop();                 // start render loop
  }

  boot();
})();
