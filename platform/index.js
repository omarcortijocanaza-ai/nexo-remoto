'use strict';
// NEXO_PLATFORM sólo existe para pruebas; en uso normal manda process.platform.
const nombre = process.env.NEXO_PLATFORM || (process.platform === 'win32' ? 'windows' : 'linux');
module.exports = require(`./${nombre}`);
