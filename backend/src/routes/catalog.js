'use strict';

/**
 * Vehicle model catalog (Authority only)
 * GET    /api/v1/fleet/models          tenant rows + global (institution_id NULL) rows
 * POST   /api/v1/fleet/models
 * PUT    /api/v1/fleet/models/:id      tenant rows only
 * DELETE /api/v1/fleet/models/:id      tenant rows only; 409 when vehicles use it
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, wrap } = require('../lib/http');

const AUTH = authenticate('AUTHORITY');

const present = (m) => ({
  id: m.id, institutionId: m.institutionId, make: m.make, model: m.model, year: m.year,
  fuelType: m.fuelType, capacity: m.capacity, isGlobal: m.institutionId === null,
  vehicleCount: m._count?.vehicles ?? 0,
});

/** Parse the optional numeric fields; throws 422 on nonsense. */
function numericFields(body) {
  const out = {};
  for (const f of ['year', 'capacity']) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === '') { out[f] = null; continue; }
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n <= 0) throw bad(422, `INVALID_${f.toUpperCase()}`, `${f} must be a positive whole number.`);
    out[f] = n;
  }
  if (body.fuelType !== undefined) out.fuelType = body.fuelType || null;
  return out;
}

/** Load a model the caller may touch: 404 if not visible, 403 if global. */
async function ownModel(id, institutionId) {
  const m = await prisma.vehicleModel.findFirst({ where: { id, OR: [{ institutionId }, { institutionId: null }] } });
  if (!m) throw bad(404, 'MODEL_NOT_FOUND', 'Vehicle model not found.');
  if (m.institutionId === null) throw bad(403, 'GLOBAL_MODEL_READONLY', 'Global catalog models cannot be changed.');
  return m;
}

router.get('/models', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const rows = await prisma.vehicleModel.findMany({
    where: { OR: [{ institutionId }, { institutionId: null }] },
    include: { _count: { select: { vehicles: { where: { institutionId } } } } },
    orderBy: [{ make: 'asc' }, { model: 'asc' }],
  });
  res.json({ success: true, data: rows.map(present) });
}));

router.post('/models', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  const { make, model } = req.body;
  if (!make || !model) throw bad(422, 'MISSING_FIELDS', 'make and model are required.');
  const row = await prisma.vehicleModel.create({ data: { institutionId, make, model, ...numericFields(req.body) } });
  res.status(201).json({ success: true, data: present(row) });
}));

router.put('/models/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownModel(req.params.id, institutionId);
  const data = numericFields(req.body);
  if (req.body.make !== undefined) data.make = req.body.make;
  if (req.body.model !== undefined) data.model = req.body.model;
  if ((data.make !== undefined && !data.make) || (data.model !== undefined && !data.model)) {
    throw bad(422, 'MISSING_FIELDS', 'make and model cannot be empty.');
  }
  const row = await prisma.vehicleModel.update({ where: { id: req.params.id }, data });
  res.json({ success: true, data: present(row) });
}));

router.delete('/models/:id', AUTH, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await ownModel(req.params.id, institutionId);
  const used = await prisma.vehicle.count({ where: { modelId: req.params.id } });
  if (used) throw bad(409, 'MODEL_IN_USE', `${used} vehicle(s) still use this model.`);
  await prisma.vehicleModel.delete({ where: { id: req.params.id } });
  res.json({ success: true, data: { message: 'Model deleted.' } });
}));

module.exports = router;
