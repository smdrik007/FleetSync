/* FleetSync landing: one rAF scroll loop writes --p per [data-sc] section, plus the route/vehicle signature move. */
(() => {
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);
  const clamp = (v) => Math.max(0, Math.min(1, v));

  // theme button
  const tb = $('#theme-btn');
  const paintTheme = () => { tb.textContent = Theme.current() === 'light' ? '☾' : '☀'; };
  tb.addEventListener('click', () => { Theme.toggle(); paintTheme(); }); paintTheme();

  // kinetic copy: wrap words so they can fill in with scroll
  const kin = $('[data-kinetic]');
  kin.innerHTML = kin.textContent.trim().split(/\s+/).map((w) => `<span>${w}</span>`).join(' ');
  const words = [...kin.children];

  // route + vehicle (signature move)
  const prog = $('#route-prog'), veh = $('#veh'), stopsG = $('#stops');
  const len = prog.getTotalLength();
  prog.style.strokeDasharray = len;
  const names = ['Main Gate', 'Library', 'Hostel', 'Science Block', 'Terminal'];
  const stopFrac = names.map((_, i) => i / (names.length - 1));
  const stops = stopFrac.map((f) => {
    const { x, y } = prog.getPointAtLength(len * f);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 11); c.classList.add('stop');
    stopsG.appendChild(c); return c;
  });
  const stopEl = $('#live-stop'), countEl = $('#live-count');

  // wipe-in grid: staggered, once
  const wipes = [...document.querySelectorAll('.wipe')];
  wipes.forEach((el, i) => el.style.setProperty('--d', `${(i % 3) * 90}ms`));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.2 });
    wipes.forEach((el) => io.observe(el));
  } else wipes.forEach((el) => el.classList.add('in'));

  // pointer glow on the closing card
  const card = $('#close-card');
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  if (still) {
    root.classList.add('static'); document.body.classList.add('static');
    words.forEach((w) => w.classList.add('on'));
    wipes.forEach((el) => el.classList.add('in'));
    prog.style.strokeDashoffset = 0; stops.forEach((s) => s.classList.add('on'));
    const end = prog.getPointAtLength(len); veh.setAttribute('transform', `translate(${end.x} ${end.y})`);
    return;
  }

  const secs = [...document.querySelectorAll('[data-sc]')];
  const track = $('#track');
  let ticking = false;

  const frame = () => {
    ticking = false;
    const vh = innerHeight;
    root.classList.toggle('scrolled', scrollY > 4);
    for (const s of secs) {
      const r = s.getBoundingClientRect();
      const span = Math.max(1, r.height - (s.classList.contains('pin') ? vh : 0));
      const p = s.classList.contains('pin') ? clamp(-r.top / span) : clamp(-r.top / r.height);
      s.style.setProperty('--p', p.toFixed(4));
      const k = s.dataset.sc;
      if (k === 'tension') {
        const n = Math.round(p * 1.15 * words.length);
        words.forEach((w, i) => w.classList.toggle('on', i < n));
      } else if (k === 'live') {
        const t = clamp(p * 1.1);
        prog.style.strokeDashoffset = len * (1 - t);
        const pt = prog.getPointAtLength(len * t);
        veh.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
        let cur = 0;
        stopFrac.forEach((f, i) => { const on = t >= f - 0.001; stops[i].classList.toggle('on', on); if (on) cur = i; });
        stopEl.textContent = names[cur]; countEl.textContent = `Stop ${cur + 1} of ${names.length}`;
      } else if (k === 'roles') {
        const dist = Math.max(0, track.scrollWidth - (innerWidth - 2 * Math.min(80, innerWidth * 0.06)));
        s.style.setProperty('--x', (-dist * p).toFixed(1));
      }
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  frame();
})();
