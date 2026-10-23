/**
 * Navigation + route table, grouped by the ER views (see docs/fleetsync_er_schema.md).
 * One source of truth for the sidebar, breadcrumbs, route registration and the command palette.
 */

export const NAV = [
  { group: 'Overview', items: [
    { path: '/overview/dashboard', for: 'fleet', label: 'Dashboard', icon: 'dashboard', hint: 'KPIs and charts' },
  ] },
  { group: 'Fleet', items: [
    { path: '/fleet/vehicles', for: 'fleet', label: 'Vehicles', icon: 'bus', hint: 'vehicles · models · drivers · routes' },
    { path: '/fleet/models',   for: 'fleet', label: 'Vehicle Models', icon: 'layers', hint: 'vehicle_models' },
    { path: '/fleet/drivers',  for: 'fleet', label: 'Drivers', icon: 'idcard', hint: 'drivers · licenses' },
    { path: '/fleet/routes',   for: 'fleet', label: 'Routes', icon: 'route', hint: 'routes · route_stops' },
    { path: '/fleet/stops',    for: 'fleet', label: 'Stops', icon: 'pin', hint: 'stops' },
  ] },
  { group: 'Tracking', items: [
    { path: '/tracking/map',     for: 'fleet', label: 'Live Map', icon: 'map', hint: 'vehicle_latest_position' },
    { path: '/tracking/trips',   for: 'fleet', label: 'Trips', icon: 'navigation', hint: 'trips · gps_logs replay' },
    { path: '/tracking/people-map', for: 'people', label: 'Live Map', icon: 'map', hint: 'everyone on one map' },
    { path: '/tracking/people',  for: 'people', label: 'People', icon: 'user', hint: 'assets · geofences' },
    { path: '/tracking/guardians', for: 'people', label: 'Guardians', icon: 'shield', hint: 'who may follow whom' },
    { path: '/tracking/devices', label: 'Devices', icon: 'cpu', hint: 'devices' },
  ] },
  { group: 'Operations', items: [
    { path: '/operations/maintenance',   for: 'fleet', label: 'Maintenance', icon: 'wrench', hint: 'maintenance_records' },
    { path: '/operations/fuel',          for: 'fleet', label: 'Fuel Logs', icon: 'fuel', hint: 'fuel_logs' },
    { path: '/operations/costs',        for: 'fleet', label: 'Costs', icon: 'card', hint: 'fuel + maintenance spend' },
    { path: '/operations/notifications', label: 'Notifications', icon: 'bell', hint: 'notifications' },
  ] },
  { group: 'Administration', items: [
    { path: '/admin/users',        label: 'Users', icon: 'users', hint: 'users · user_roles' },
    { path: '/admin/subscription', label: 'Subscription', icon: 'card', hint: 'subscriptions' },
    { path: '/admin/institution',  label: 'Institution', icon: 'building', hint: 'institutions' },
  ] },
];

/** [pattern, view module name]. Detail patterns reuse the list view, which opens a drawer. */
export const ROUTES = [
  ['/overview/dashboard', 'dashboard'],
  ['/fleet/vehicles', 'vehicles'], ['/fleet/vehicles/:id', 'vehicles'],
  ['/fleet/models', 'models'],
  ['/fleet/drivers', 'drivers'], ['/fleet/drivers/:id', 'drivers'],
  ['/fleet/routes', 'routes'], ['/fleet/routes/:id', 'routes'],
  ['/fleet/stops', 'stops'],
  ['/tracking/map', 'livemap'],
  ['/tracking/trips', 'trips'], ['/tracking/trips/:id', 'trips'],
  ['/tracking/people-map', 'peoplemap'],
  ['/tracking/people', 'people'], ['/tracking/people/:id', 'people'],
  ['/tracking/guardians', 'guardians'],
  ['/tracking/devices', 'devices'],
  ['/operations/maintenance', 'maintenance'],
  ['/operations/fuel', 'fuel'],
  ['/operations/costs', 'costs'],
  ['/operations/notifications', 'notifications'],
  ['/admin/users', 'users'],
  ['/admin/subscription', 'subscription'],
  ['/admin/institution', 'institution'],
];

// One loader function per view so the router can tell "same screen" apart.
const loaders = {};
export const loaderFor = (name) => (loaders[name] ||= () => import(`./views/${name}.js`));

/** Find the nav entry (and its group) that owns a path. */
export function findNav(path) {
  for (const g of NAV) for (const item of g.items) if (path === item.path || path.startsWith(`${item.path}/`)) return { group: g.group, item };
  return null;
}

/**
 * What each tracking type shows. "things" is exactly like "people".
 * Items tagged for:'fleet' are vehicle-only (fleet, drivers, routes, trips, live map, maintenance, fuel, costs, dashboard);
 * for:'people' are people-only (People, Guardians); untagged screens (Devices, Notifications, Administration) are shared.
 */
export const featureOf = (type) => (type === 'vehicle' ? 'fleet' : 'people');
const FLEET_VIEWS = new Set(['dashboard', 'vehicles', 'models', 'drivers', 'routes', 'stops', 'livemap', 'trips', 'maintenance', 'fuel', 'costs']);
const PEOPLE_VIEWS = new Set(['people', 'guardians', 'peoplemap']);

/** NAV without the items (and empty groups) this tracking type does not get. */
export const navFor = (type) => NAV
  .map((g) => ({ ...g, items: g.items.filter((i) => !i.for || i.for === featureOf(type)) }))
  .filter((g) => g.items.length);

/** Routes this tracking type may open. */
export const routesFor = (type) => ROUTES.filter(([, name]) => !(featureOf(type) === 'fleet' ? PEOPLE_VIEWS : FLEET_VIEWS).has(name));

export const homeFor = (type) => (featureOf(type) === 'fleet' ? '/overview/dashboard' : '/tracking/people-map');
