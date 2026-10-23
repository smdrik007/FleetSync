'use strict';

const crypto = require('crypto');

/** Random per-device ingest key. Only its sha256 is stored, so it can be shown once and never recovered. */
function newDeviceKey() {
  const key = `fsk_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, hash: hashKey(key) };
}

const hashKey = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

/** Fill a device_types.setup_template for one device. */
const renderSetup = (template, vars) => template.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] ?? ''));

module.exports = { newDeviceKey, hashKey, renderSetup };
