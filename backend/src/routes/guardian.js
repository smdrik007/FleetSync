'use strict';

/**
 * Guardian: the people linked to the signed-in guardian; guardians may also manage their safe zones.
 * GET /api/v1/guardian/people
 * GET /api/v1/guardian/people/:id/track   ?hours=24
 * POST   /api/v1/guardian/people/:id/geofences          { name, latitude, longitude, radiusM }
 * DELETE /api/v1/guardian/people/:id/geofences/:zoneId
 */

const router = require('express').Router();
const prisma = require('../db/client');
const { authenticate } = require('../middleware/auth');
const { bad, isUuid, wrap } = require('../lib/http');
const { presentAssets, assetInclude, trail, createZone, deleteZone } = require('../lib/people');

const GUARD = authenticate('GUARDIAN');

router.get('/people', GUARD, wrap(async (req, res) => {
  const { institutionId, sub } = req.user;
  const assets = await prisma.asset.findMany({ where: { institutionId, guardianships: { some: { userId: sub } } }, include: assetInclude, orderBy: { name: 'asc' } });
  res.json({ success: true, data: await presentAssets(institutionId, assets) });
}));

/** Only people linked to this guardian; anyone else's id is a plain 404. */
async function linkedAsset(req) {
  const { institutionId, sub } = req.user;
  const linked = isUuid(req.params.id) ? await prisma.guardianship.findFirst({ where: { userId: sub, assetId: req.params.id, institutionId } }) : null;
  if (!linked) throw bad(404, 'PERSON_NOT_FOUND', 'Person not found.');
  return req.params.id;
}

const presentOne = async (institutionId, id) =>
  (await presentAssets(institutionId, await prisma.asset.findMany({ where: { id, institutionId }, include: assetInclude })))[0];

router.post('/people/:id/geofences', GUARD, wrap(async (req, res) => {
  const id = await linkedAsset(req);
  await createZone(req.user.institutionId, id, req.body);
  res.status(201).json({ success: true, data: await presentOne(req.user.institutionId, id) });
}));

router.delete('/people/:id/geofences/:zoneId', GUARD, wrap(async (req, res) => {
  const id = await linkedAsset(req);
  await deleteZone(req.user.institutionId, id, req.params.zoneId);
  res.json({ success: true, data: await presentOne(req.user.institutionId, id) });
}));

router.get('/people/:id/track', GUARD, wrap(async (req, res) => {
  const { institutionId } = req.user;
  await linkedAsset(req);
  const hours = Math.min(168, Math.max(1, parseInt(req.query.hours, 10) || 24));
  res.json({ success: true, data: await trail(institutionId, req.params.id, hours) });
}));

module.exports = router;
