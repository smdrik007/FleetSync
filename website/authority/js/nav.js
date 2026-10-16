/**
 * Navigation + route table, grouped by the ER views (see docs/fleetsync_er_schema.md).
 * One source of truth for the sidebar, breadcrumbs, route registration and the command palette.
 */

export const NAV = [
  { group: 'Overview', items: [
    { path: '/overview/dashboard', label: 'Dashboard', icon: 'dashboard', hint: 'KPIs and charts' },
  ] },
  { group: 'Fleet', items: [
    { path: '/fleet/vehicles', label: 'Vehicles', icon: 'bus', hint: 'vehicles · models · drivers · routes' },
    { path: '/fleet/models',   label: 'Vehicle Models', icon: 'layers', hint: 'vehicle_models' },
    { path: '/fleet/drivers',  label: 'Drivers', icon: 'idcard', hint: 'drivers · licenses' },
    { path: '/fleet/routes',   label: 'Routes', icon: 'route', hint: 'routes · route_stops' },
    { path: '/fleet/stops',    label: 'Stops', icon: 'pin', hint: 'stops' },
  ] },
  { group: 'Tracking', items: [
    { path: '/tracking/map',     label: 'Live Map', icon: 'map', hint: 'vehicle_latest_position' },
    { path: '/tracking/trips',   label: 'Trips', icon: 'navigation', hint: 'trips · gps_logs replay' },
    { path: '/tracking/devices', label: 'Devices', icon: 'cpu', hint: 'devices' },
  ] },
  { group: 'Operations', items: [
    { path: '/operations/maintenance',   label: 'Maintenance', icon: 'wrench', hint: 'maintenance_records' },
    { path: '/operations/fuel',          label: 'Fuel Logs', icon: 'fuel', hint: 'fuel_logs' },
    { path: '/operations/costs',        label: 'Costs', icon: 'card', hint: 'fuel + maintenance spend' },
    { path: '/operations/notifications', label: 'Notifications', icon: 'bell', hint: 'notifications' },
  ] },
  { group: 'Administration', items: [
    { path: '/admin/users',        label: 'Users', icon: 'users', hint: 'users · user_roles' },
    { path: '/admin/roles',        label: 'Roles & Permissions', icon: 'shield', hint: 'roles · permissions' },
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
  ['/tracking/devices', 'devices'],
  ['/operations/maintenance', 'maintenance'],
  ['/operations/fuel', 'fuel'],
  ['/operations/costs', 'costs'],
  ['/operations/notifications', 'notifications'],
  ['/admin/users', 'users'],
  ['/admin/roles', 'roles'],
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
