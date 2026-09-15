'use strict';

const { PrismaClient } = require('@prisma/client');

// Singleton Prisma client — reused across the app
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
