'use strict';

const crypto = require('crypto');

function now() {
  return new Date().toISOString();
}

function generateId() {
  return crypto.randomBytes(12).toString('hex');
}

/** Kort, lesbar romkode (uten forvekslbare tegn som O/0, I/1). */
function generateRoomCode(length = 4) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function successResponse(res, payload = {}, status = 200) {
  return res.status(status).json({ success: true, ...payload });
}

function errorResponse(res, message, status = 400, extra = {}) {
  return res.status(status).json({ success: false, error: message, ...extra });
}

/** Valider at påkrevde felt finnes i body. Returnerer manglende felt-liste. */
function validateRequired(body, fields) {
  const missing = [];
  for (const f of fields) {
    const v = body ? body[f] : undefined;
    if (v === undefined || v === null || v === '') missing.push(f);
  }
  return missing;
}

module.exports = {
  now,
  generateId,
  generateRoomCode,
  generateToken,
  successResponse,
  errorResponse,
  validateRequired,
};
