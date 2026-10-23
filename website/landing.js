/* FleetSync landing: one rAF scroll loop writes --p per [data-sc] section (kinetic copy + the route/vehicle scrub); the rest is small UI wiring. */
(() => {
  const root = document.documentElement;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const clamp = (v) => Math.max(0, Math.min(1, v));

  /* theme button (footer) */
  const tb = $('#theme-btn');
  const paintTheme = () => {
    const light = Theme.current() === 'light';
    $('#theme-use').setAttribute('href', light ? '#i-moon' : '#i-sun');
    $('#theme-txt').textContent = light ? 'Dark theme' : 'Light theme';
  };
  tb.addEventListener('click', () => { Theme.toggle(); paintTheme(); });
  paintTheme();

  /* phone menu */
  const burger = $('#burger'), sheet = $('#sheet');
  const setSheet = (open) => {
    sheet.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    burger.querySelector('use').setAttribute('href', open ? '#i-x' : '#i-menu');
  };
  burger.addEventListener('click', () => setSheet(sheet.hidden));
  sheet.addEventListener('click', (e) => { if (e.target.closest('a')) setSheet(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) { setSheet(false); burger.focus(); } });

  /* role tabs */
  const tabs = $$('[role="tab"]');
  const pick = (t) => {
    tabs.forEach((x) => {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
    });
    t.focus();
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (step) { e.preventDefault(); pick(tabs[(i + step + tabs.length) % tabs.length]); }
    });
  });

  /* reveal on view, staggered within a row, once */
  const reveals = $$('[data-reveal]');
  reveals.forEach((el, i) => el.style.setProperty('--d', `${(i % 3) * 90}ms`));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15 });
    reveals.forEach((el) => io.observe(el));
  } else reveals.forEach((el) => el.classList.add('in'));

  /* pointer glow on the closing card */
  const card = $('#close-card');
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });

  /* kinetic copy: wrap words so they can fill in with scroll */
  const kin = $('[data-kinetic]');
  kin.innerHTML = kin.textContent.trim().split(/\s+/).map((w) => `<span>${w}</span>`).join(' ');
  const words = [...kin.children];

  /* route + vehicle (signature move) */
  const prog = $('#route-prog'), veh = $('#veh'), stopsG = $('#stops');
  const len = prog.getTotalLength();
  prog.style.strokeDasharray = len;
  const names = ['Main Gate', 'Library', 'Hostel', 'Science Block', 'Terminal'];
  const stopFrac = names.map((_, i) => i / (names.length - 1));
  const NS = 'http://www.w3.org/2000/svg';
  const stops = [], labels = [];
  stopFrac.forEach((f, i) => {
    const { x, y } = prog.getPointAtLength(len * f);
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 11); c.classList.add('stop');
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', Math.min(735, Math.max(60, x))); t.setAttribute('y', y - 22); t.classList.add('stop-lbl');
    t.textContent = names[i].toUpperCase();
    stopsG.append(c, t); stops.push(c); labels.push(t);
  });
  const stopEl = $('#live-stop'), countEl = $('#live-count');
  const paintStops = (t) => {
    let cur = 0;
    stopFrac.forEach((f, i) => { const on = t >= f - 0.001; stops[i].classList.toggle('on', on); labels[i].classList.toggle('on', on); if (on) cur = i; });
    stopEl.textContent = names[cur]; countEl.textContent = `Stop ${cur + 1} of ${names.length}`;
  };

  if (still) {
    root.classList.add('static'); document.body.classList.add('static');
    words.forEach((w) => w.classList.add('on'));
    prog.style.strokeDashoffset = 0; paintStops(1);
    const end = prog.getPointAtLength(len); veh.setAttribute('transform', `translate(${end.x} ${end.y})`);
    return;
  }

  const secs = $$('[data-sc]');
  let ticking = false;
  const frame = () => {
    ticking = false;
    const vh = innerHeight;
    for (const s of secs) {
      const r = s.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - vh));
      s.style.setProperty('--p', p.toFixed(4));
      if (s.dataset.sc === 'tension') {
        const n = Math.round(p * 1.15 * words.length);
        words.forEach((w, i) => w.classList.toggle('on', i < n));
      } else if (s.dataset.sc === 'live') {
        const t = clamp(p * 1.1);
        prog.style.strokeDashoffset = len * (1 - t);
        const pt = prog.getPointAtLength(len * t);
        veh.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
        paintStops(t);
      }
    }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  frame();
})();
