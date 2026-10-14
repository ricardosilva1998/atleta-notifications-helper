'use strict';

// GET /health, for Railway's deploy check (railway.json) and CI: 200 {"ok":true}
// when the database answers, 503 {"ok":false} when it does not. No login, and
// nothing else in the answer.

function healthHandler(db) {
  return function health(req, res) {
    res.set('Cache-Control', 'no-store');
    try {
      db.ping();
    } catch (e) {
      console.error(`[Health] Database check failed: ${e.message}`);
      return res.status(503).json({ ok: false });
    }
    res.json({ ok: true });
  };
}

module.exports = { healthHandler };
