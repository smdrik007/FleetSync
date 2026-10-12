/**
 * Hash router for the authority console.
 *
 *   registerRoute('/fleet/vehicles/:id', () => import('./views/vehicles.js'));
 *   startRouter(outlet, ctxBase, { onChange });
 *
 * A view module's default export is  { title, render(ctx) → Node, mounted?(ctx), update?(ctx) → boolean, destroy?(renderId) }.
 * ctx.renderId identifies one render; destroy(renderId) must only clean up that render (renders can overlap
 * when the user navigates quickly), and destroy() with no id cleans up everything.
 * When the next route resolves to the SAME loader and the view has update(), the view is
 * updated in place (used by list views to open/close their detail drawer without a reload).
 */
import { skeleton, emptyState, errorState } from './ui.js';

const routes = [];            // { pattern, regex, keys, loader }
const moduleCache = new Map(); // loader → View
let outlet = null;
let ctxBase = {};
let onChange = () => {};
let current = null;           // { route, view, path }
let token = 0;                // guards against out-of-order async renders

export function registerRoute(pattern, loader) {
  const keys = [];
  const source = pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
  routes.push({ pattern, regex: new RegExp(`^${source}$`), keys, loader });
}

export function navigate(path) {
  if (currentPath() === path) { resolve(); return; }
  location.hash = `#${path}`;
}

export function currentPath() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

function parseQuery() {
  const raw = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(raw));
}

function match(path) {
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (m) {
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      return { route, params };
    }
  }
  return null;
}

async function loadView(loader) {
  if (!moduleCache.has(loader)) moduleCache.set(loader, (await loader()).default);
  return moduleCache.get(loader);
}

async function resolve() {
  const mine = ++token;
  const path = currentPath();
  const found = match(path);

  if (!found) {
    teardown();
    outlet.replaceChildren(emptyState('Page not found', `There is no screen at ${path}.`));
    onChange({ path, view: null, params: {} });
    return;
  }

  const { route, params } = found;
  const ctx = { ...ctxBase, params, query: parseQuery(), path, outlet, navigate, renderId: mine };

  try {
    const view = await loadView(route.loader);
    if (mine !== token) return;

    // Same screen, different params (e.g. list → detail drawer): update in place.
    if (current && current.route.loader === route.loader && view.update) {
      const handled = await view.update(ctx);
      if (mine !== token) return;
      if (handled !== false) {
        current.path = path;
        onChange({ path, view, params });
        return;
      }
    }

    teardown();
    outlet.replaceChildren(skeleton(6));
    const node = await view.render(ctx);
    if (mine !== token) { view.destroy?.(mine); return; }   // a newer navigation won: clean up only this render
    current = { route, view, path, id: mine };
    if (node) outlet.replaceChildren(node);
    document.title = `${view.title} · FleetSync`;
    outlet.focus({ preventScroll: true });
    // Views that need to be in the DOM first (charts, maps) do that work here.
    Promise.resolve(view.mounted?.(ctx)).catch((e) => console.error('[router] mounted failed', e));
    onChange({ path, view, params });
  } catch (err) {
    if (mine !== token) return;
    teardown();
    outlet.replaceChildren(errorState(err, resolve));
    onChange({ path, view: null, params });
  }
}

function teardown() {
  try { current?.view.destroy?.(current.id); } catch (e) { console.error('[router] destroy failed', e); }
  current = null;
}

export function startRouter(outletEl, base, opts = {}) {
  outlet = outletEl;
  ctxBase = base;
  onChange = opts.onChange || onChange;
  window.addEventListener('hashchange', resolve);
  if (!location.hash) location.hash = `#${opts.home || '/overview/dashboard'}`;
  else resolve();
}

/** Re-run the current route (e.g. after a mutation). */
export function reload() { teardown(); resolve(); }
