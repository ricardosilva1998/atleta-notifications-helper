const { Router } = require('express');
const db = require('../db');

const router = Router();

router.get('/:token', (req, res) => {
  const streamer = db.getStreamerByOverlayToken(req.params.token);
  if (!streamer) return res.status(404).send('Invalid token');

  const mode = req.query.mode || 'dashboard';
  const model = streamer.vtuber_model_id ? db.getVtuberModel(streamer.vtuber_model_id) : null;

  let modelUrl = null;
  if (model) {
    modelUrl = model.is_bundled
      ? `/vtuber/models/${model.filename}`
      : `/vtuber-models/${streamer.id}/${model.filename}`;
  }

  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.render('vtuber', { mode, modelUrl, streamerName: streamer.twitch_username || 'Streamer' });
});

module.exports = router;
