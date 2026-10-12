/**
 * List-screen factory: page header + filter bar + sortable/paginated table + optional detail drawer.
 * Every list screen in the console (vehicles, drivers, trips, …) is a thin config over this.
 *
 * makeListView({
 *   title, subtitle, basePath,                       // basePath e.g. '/fleet/vehicles' ; detail route is `${basePath}/:id`
 *   load(api) → rows[],                              // always hits the API (fresh)
 *   columns(api) → dataTable columns,
 *   chips?: [{key,label}], chipOf?(row) → key,       // status chips
 *   searchOf(row) → string[],                        // text matched by the search box
 *   filterRow?(row, api) → boolean,                  // extra filters (selects, dates) kept on api.extra
 *   create?: { label, run(api) },                    // primary action
 *   toolbar?(api) → Node[],                          // extra toolbar controls
 *   openDetail?({ id, row, api }),                   // fill a drawer via api.drawer({...})
 *   live?(api) → cleanup,                            // subscribe to WS events
 *   pageSize?, emptyText?, summary?(rows) → Node     // optional line under the table
 * })
 *
 * api: { rows, ctx, reload(), refresh() (re-filter), drawer(opts), closeDetail(), navigate(path), openDetailFor(id) }
 */
import { h, pageHead, button, filterBar, dataTable, skeleton, errorState, closeDrawer, openDrawer, matches } from '../ui.js';
import { invalidate } from '../data.js';

export function makeListView(cfg) {
  let api = null;                 // the most recently started render (what update() talks to)
  const instances = new Map();    // renderId → { me, cleanup } — renders can overlap during quick navigation

  async function render(ctx) {
    const root = h('div');
    const headSlot = h('div');
    const tableSlot = h('div', {}, skeleton(6));
    const summarySlot = h('div');

    api = { rows: [], ctx, filter: { q: '', chip: '' }, extra: {}, table: null, dead: false };
    const me = api;
    const instance = { me, cleanup: null };
    instances.set(ctx.renderId ?? Symbol('render'), instance);

    me.navigate = ctx.navigate;
    me.closeDetail = () => { if (me.ctx.params.id) me.navigate(cfg.basePath); };
    me.drawer = (opts) => openDrawer({ ...opts, onClose: me.closeDetail });
    me.openDetailFor = (id) => me.navigate(`${cfg.basePath}/${id}`);

    const paintHead = () => {
      headSlot.replaceChildren(pageHead({
        title: cfg.title, subtitle: cfg.subtitle, count: me.rows.length,
        actions: cfg.create ? [button(cfg.create.label, { variant: 'primary', iconName: 'plus', size: 'md', onClick: () => cfg.create.run(me) })] : [],
      }));
    };

    me.refresh = () => {
      const { q, chip } = me.filter;
      const rows = me.rows.filter((r) => (!chip || !cfg.chipOf || cfg.chipOf(r) === chip) && matches(q, ...(cfg.searchOf?.(r) || [])) && (!cfg.filterRow || cfg.filterRow(r, me)));
      me.table?.setRows(rows);
      summarySlot.replaceChildren(cfg.summary ? cfg.summary(rows, me) : '');
    };

    me.reload = async ({ quiet = false } = {}) => {
      invalidate();
      try {
        me.rows = await cfg.load(me);
        if (me.dead) return;
        if (!me.table) {
          me.table = dataTable({ columns: cfg.columns(me), rows: [], pageSize: cfg.pageSize || 15, empty: cfg.emptyText, onRowClick: cfg.openDetail ? (row) => me.openDetailFor(row.id) : undefined });
          tableSlot.replaceChildren(me.table);
        }
        paintHead();
        me.refresh();
        if (me.ctx.params.id && me.openedId !== me.ctx.params.id) await openDetail(me.ctx.params.id);
      } catch (err) {
        if (me.dead) return;
        if (!quiet || !me.table) { tableSlot.replaceChildren(errorState(err, () => { tableSlot.replaceChildren(skeleton(6)); me.reload(); })); me.table = null; }
        else Toast.error(err.message);
      }
    };

    async function openDetail(id) {
      if (!cfg.openDetail) return;
      me.openedId = id;
      closeDrawer({ silent: true });
      try { await cfg.openDetail({ id, row: me.rows.find((r) => r.id === id), api: me }); }
      catch (err) { Toast.error(err.message || 'Could not load details.'); me.openedId = null; me.closeDetail(); }
    }
    me.openDetail = openDetail;

    const bar = filterBar({
      placeholder: cfg.searchPlaceholder || 'Search…', chips: cfg.chips || [],
      onChange: (s) => { me.filter = { q: s.q, chip: s.chip }; me.refresh(); },
      actions: cfg.toolbar ? cfg.toolbar(me) : [],
    });

    root.append(headSlot, bar, tableSlot, summarySlot);
    paintHead();
    instance.cleanup = cfg.live?.(me) || null;
    await me.reload();
    return root;
  }

  return {
    title: cfg.title,
    render,
    /** Same screen, new params: open or close the drawer without reloading the table. */
    async update(ctx) {
      if (!api) return false;
      api.ctx = ctx;
      if (ctx.params.id) await api.openDetail(ctx.params.id);
      else { api.openedId = null; closeDrawer({ silent: true }); }
      return true;
    },
    /** destroy(renderId) cleans up that one render; destroy() cleans up all of them. */
    destroy(renderId) {
      const keys = renderId === undefined ? [...instances.keys()] : [renderId];
      for (const key of keys) {
        const inst = instances.get(key);
        if (!inst) continue;
        inst.me.dead = true;
        try { inst.cleanup?.(); } catch (e) { console.error(e); }
        instances.delete(key);
        if (api === inst.me) { api = [...instances.values()].pop()?.me ?? null; closeDrawer({ silent: true }); }
      }
    },
  };
}
