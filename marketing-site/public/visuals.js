// Field Pro live hero: an animated wireframe of a building being measured, plus telemetry tiles.
// Pure decoration: it reads nothing from the user and sends nothing anywhere. Respects reduced motion.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canvas = document.getElementById('hero-canvas');
  var hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var size = { w: 0, h: 0 };

  // A simple gable house in plan feet; projected to isometric on screen.
  var W = 50, D = 32, WALL = 9, RIDGE = 15;
  var corners = [
    [0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0],
    [0, 0, WALL], [W, 0, WALL], [W, D, WALL], [0, D, WALL],
    [0, D / 2, WALL + RIDGE - WALL], [W, D / 2, WALL + RIDGE - WALL]
  ];
  var edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7],[4,8],[7,8],[5,9],[6,9],[8,9]];

  function project(p, t) {
    var ang = t * 0.00035;
    var x = p[0] - W / 2, y = p[1] - D / 2, z = p[2];
    var cos = Math.cos(ang), sin = Math.sin(ang);
    var rx = x * cos - y * sin, ry = x * sin + y * cos;
    var iso = { x: (rx - ry) * 0.866, y: (rx + ry) * 0.5 - z };
    var scale = Math.min(size.w, size.h) / 95;
    return { x: size.w * 0.5 + iso.x * scale, y: size.h * 0.5 + iso.y * scale };
  }

  function resize() {
    size.w = hero.clientWidth;
    size.h = hero.clientHeight;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(t) {
    ctx.clearRect(0, 0, size.w, size.h);
    var pts = corners.map(function (p) { return project(p, t); });
    // Scan line sweeps down the building.
    var scanY = size.h * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.0012)));
    ctx.lineWidth = 1.2;
    edges.forEach(function (e) {
      var a = pts[e[0]], b = pts[e[1]];
      var mid = (a.y + b.y) / 2;
      var lit = Math.abs(mid - scanY) < 26;
      ctx.strokeStyle = lit ? 'rgba(166,255,92,0.95)' : 'rgba(54,228,255,0.55)';
      ctx.shadowColor = lit ? 'rgba(166,255,92,0.8)' : 'transparent';
      ctx.shadowBlur = lit ? 12 : 0;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
    // Corner nodes.
    pts.forEach(function (p) {
      ctx.fillStyle = 'rgba(255,181,71,0.9)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
    // Live dimension: the wall length readout follows the rotation.
    var a = pts[0], b = pts[1];
    var len = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3.2);
    ctx.font = '12px ui-monospace, Consolas, monospace';
    ctx.fillStyle = 'rgba(232,244,255,0.85)';
    ctx.fillText('L ' + len + ' ft', (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 + 16);
    ctx.fillStyle = 'rgba(54,228,255,0.9)';
    ctx.fillText('scan ' + Math.round((scanY / size.h) * 100) + '%', 14, size.h - 14);
  }

  function loop(t) {
    frame(t);
    requestAnimationFrame(loop);
  }

  resize();
  if (reduce) {
    frame(0);
  } else {
    requestAnimationFrame(loop);
  }
  window.addEventListener('resize', function () { resize(); if (reduce) frame(0); });

  // Fact tiles only: every figure here is stated elsewhere on this site. No invented metrics.
  var strip = document.createElement('div');
  strip.className = 'fp-telemetry';
  strip.setAttribute('aria-label', 'Field Pro at a glance');
  strip.innerHTML =
    '<div class="fp-tile"><b>5</b><span>Trades in one app</span></div>' +
    '<div class="fp-tile"><b>1</b><span>Licence, paid once</span></div>' +
    '<div class="fp-tile"><b>3D</b><span>House model &amp; takeoff</span></div>';
  var copy = hero.querySelector(':scope > div');
  if (copy) copy.appendChild(strip);
})();
