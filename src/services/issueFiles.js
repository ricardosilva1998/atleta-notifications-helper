'use strict';

// Issue screenshots live in data/issues/<issueId>/. They are private: only an
// admin or the streamer who reported the issue may read one, so they are not
// served by a public static route.

const path = require('path');
const db = require('../db');
const { setUserContentHeaders } = require('./userContentHeaders');

const ISSUES_DIR = path.join(__dirname, '..', '..', 'data', 'issues');
const FILE_NAME = /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/i;

function issueFileHandler(req, res) {
  const issueId = /^\d{1,12}$/.test(req.params.issueId) ? parseInt(req.params.issueId, 10) : null;
  const file = req.params.file;
  // The same answer for "no such file" and "not yours", so the route does not
  // tell a stranger which issues have screenshots.
  if (!req.streamer || !issueId || !FILE_NAME.test(file)) return res.status(404).end();
  const issue = db.getIssueById(issueId);
  if (!issue || !(issue.streamer_id === req.streamer.id || db.isAdmin(req.streamer.id))) {
    return res.status(404).end();
  }
  const listed = (issue.screenshots || '').split(',').filter(Boolean);
  if (!listed.includes(file)) return res.status(404).end();

  const full = path.join(ISSUES_DIR, String(issueId), file);
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(full, { dotfiles: 'deny' }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

function issueFileHeaders(req, res, next) {
  setUserContentHeaders(res, req.params.file || '');
  next();
}

module.exports = { issueFileHandler, issueFileHeaders, FILE_NAME };
