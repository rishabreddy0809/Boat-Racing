// GTA-style radar minimap: follows the player, rotates so "forward" is always up,
// and zooms out a little with speed. Drawn on a 2D canvas in the bottom-left HUD.
import { GATE_HALF } from './world.js';

const W = 230, H = 170, R = 14; // CSS px size and corner radius

export function createMinimap(canvas, course, rocks) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');

  // The course as one closed path in world coordinates (x, z).
  const lane = new Path2D();
  lane.moveTo(course.px[0], course.pz[0]);
  for (let i = 1; i < course.n; i++) lane.lineTo(course.px[i], course.pz[i]);
  lane.closePath();

  let zoom = 0.5; // px per metre (CSS px)
  const cx = W / 2, cy = H * 0.62; // player sits a bit below centre, like GTA

  function frame() {
    ctx.beginPath();
    ctx.roundRect(1, 1, W - 2, H - 2, R);
  }

  function draw({ player, boats, accents, gate, mines, rockets, dt, time }) {
    zoom += ((0.62 - Math.min(1, Math.abs(player.speed) / 60) * 0.22) - zoom) * Math.min(1, dt * 2);
    const s = zoom, h = player.heading;
    const ch = Math.cos(h), sh = Math.sin(h);
    // world (x, z) -> map: forward = up, boat's right = map right
    const a = -s * ch, b = -s * sh, c = s * sh, d = -s * ch;
    const e = cx - a * player.pos.x - c * player.pos.z;
    const f = cy - b * player.pos.x - d * player.pos.z;
    const toMap = (x, z) => [a * x + c * z + e, b * x + d * z + f];
    const mapAng = (heading) => h - heading; // rotation of a world heading on the map

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    frame();
    ctx.fillStyle = 'rgba(14, 40, 58, 0.78)';
    ctx.fill();
    ctx.clip();

    // course lane + centre line
    ctx.save();
    ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(120, 190, 215, 0.35)';
    ctx.lineWidth = GATE_HALF * 2;
    ctx.stroke(lane);
    ctx.strokeStyle = 'rgba(241, 239, 233, 0.35)';
    ctx.lineWidth = 1.2 / s;
    ctx.setLineDash([6 / s, 6 / s]);
    ctx.stroke(lane);
    ctx.setLineDash([]);
    ctx.restore();

    // rocks
    const reach = Math.hypot(W, H) / s;
    ctx.fillStyle = '#6d6a63';
    ctx.strokeStyle = 'rgba(241, 239, 233, 0.4)';
    ctx.lineWidth = 1;
    for (const r of rocks) {
      if (Math.abs(r.x - player.pos.x) > reach || Math.abs(r.z - player.pos.z) > reach) continue;
      const [x, y] = toMap(r.x, r.z);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, r.r * s), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // next gate: a bar across the lane
    {
      const nx = -gate.tz, nz = gate.tx;
      const [x0, y0] = toMap(gate.x - nx * GATE_HALF, gate.z - nz * GATE_HALF);
      const [x1, y1] = toMap(gate.x + nx * GATE_HALF, gate.z + nz * GATE_HALF);
      ctx.strokeStyle = '#ffd23c';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // start / finish line
    {
      const g0 = course.gates[0], nx = -g0.tz, nz = g0.tx;
      const [x0, y0] = toMap(g0.x - nx * GATE_HALF, g0.z - nz * GATE_HALF);
      const [x1, y1] = toMap(g0.x + nx * GATE_HALF, g0.z + nz * GATE_HALF);
      ctx.strokeStyle = '#f1efe9';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // mines (blinking red) and rockets
    const blink = Math.floor(time * 4) % 2 === 0;
    for (const m of mines) {
      if (!m.active) continue;
      const [x, y] = toMap(m.x, m.z);
      ctx.fillStyle = blink ? '#ff5a3c' : '#9a2a1a';
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffb347';
    for (const r of rockets) {
      if (!r.active) continue;
      const [x, y] = toMap(r.pos.x, r.pos.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    // opponents: coloured arrows, clamped to the edge when off-map
    for (const o of boats) {
      if (o === player || !o.alive) continue;
      let [x, y] = toMap(o.pos.x, o.pos.z);
      const off = x < 8 || x > W - 8 || y < 8 || y > H - 8;
      x = Math.min(W - 8, Math.max(8, x));
      y = Math.min(H - 8, Math.max(8, y));
      ctx.globalAlpha = off ? 0.6 : 1;
      arrow(ctx, x, y, off ? 4 : 5.5, mapAng(o.heading), '#' + accents[o.i].toString(16).padStart(6, '0'));
      ctx.globalAlpha = 1;
    }

    // player
    if (player.alive) arrow(ctx, cx, cy, 7.5, 0, '#f1efe9');

    ctx.restore();

    // frame + north marker
    frame();
    ctx.strokeStyle = 'rgba(241, 239, 233, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    {
      // direction of world "north" (+z) on the map, pushed out to the frame edge
      const dx = c, dy = d, l = Math.hypot(dx, dy);
      const ux = dx / l, uy = dy / l;
      const t = Math.min((W / 2 - 12) / Math.abs(ux || 1e-6), (H / 2 - 12) / Math.abs(uy || 1e-6));
      const x = W / 2 + ux * t, y = H / 2 + uy * t;
      ctx.fillStyle = 'rgba(10, 20, 32, 0.85)';
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f1efe9';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', x, y + 0.5);
    }
  }

  return { draw };
}

function arrow(ctx, x, y, size, ang, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, -size * 1.3);
  ctx.lineTo(size, size);
  ctx.lineTo(0, size * 0.45);
  ctx.lineTo(-size, size);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 20, 32, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}
