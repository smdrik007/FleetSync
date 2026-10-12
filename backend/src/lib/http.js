'use strict';

/** Build an Error the global handler turns into { success:false, error:{ code, message } }. */
function bad(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.expose = true;   // safe to show to the client as-is
  return err;
}

/** Throw 422 INVALID_<FIELD> unless value is one of allowed. */
function assertEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw bad(422, `INVALID_${String(field).toUpperCase()}`, `${field} must be one of: ${allowed.join(', ')}.`);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True for a well-formed uuid string (Postgres rejects anything else with a 500). */
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Wrap an async route handler so rejections reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { bad, assertEnum, isUuid, wrap };
