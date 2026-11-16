const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');

// The request gives up after 2 minutes and is tried once more, so an analysis ends
// well inside the 15 minutes after which an issue still marked "analyzing" counts as
// abandoned (ANALYSIS_STALE_MS in issueAnalysis.js). The SDK's own limits, 10 minutes
// and 2 retries, could keep it running past that.
const REQUEST_OPTIONS = { timeout: 120_000, maxRetries: 1 };

function loadScreenshots(issueId, screenshotNames) {
  const images = [];
  const issueDir = path.join(__dirname, '..', '..', 'data', 'issues', String(issueId));
  if (!screenshotNames || !fs.existsSync(issueDir)) return images;

  const files = screenshotNames.split(',').filter(Boolean);
  for (const file of files) {
    const filePath = path.join(issueDir, file);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(file).slice(1).toLowerCase();
      const mediaType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      images.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: data.toString('base64') },
      });
    }
  }
  return images;
}

const SYSTEM_PROMPT = `You are a senior developer triaging a problem reported by a streamer using Atleta, a web platform of Twitch, YouTube and Discord tools for streamers. It posts go-live messages, clips, recaps, milestones and weekly digests to Discord; runs a Twitch chatbot (thank-you messages, custom and built-in commands, chat moderation, giveaways, polls and predictions, shoutouts); shows animated alerts in an OBS browser source overlay (with an Overlay Builder, goal bars and trackers); takes PayPal tips; reads tips aloud; handles channel point rewards; and books paid coaching sessions through Discord. Streamers configure everything on a server-rendered dashboard.

Your job:
1. Analyze the report and any screenshots provided
2. Say what the likely cause is: a setting the streamer has not made, a missing Twitch or Discord permission, a limit of Twitch, Discord or PayPal, or a bug in Atleta
3. Say what the streamer or the owner should check or do next

You have no source code. Do not invent file names, line numbers or code.

Respond with ONLY valid JSON (no markdown fences):
{
  "summary": "Brief 1-2 sentence diagnosis",
  "root_cause": "The most likely cause and why",
  "can_fix": false,
  "confidence": "high" or "medium" or "low",
  "patch": [],
  "notes": "What to check or do next, and anything that would confirm the cause"
}`;

async function analyzeIssue(issueId) {
  const issue = db.getIssueById(issueId);
  if (!issue) throw new Error('Issue not found');

  console.log(`[AgentTriage] Analyzing issue #${issueId}: ${issue.subject}`);
  db.updateIssueAgentStatus(issueId, 'analyzing');

  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  const content = [];

  const screenshots = loadScreenshots(issueId, issue.screenshots);
  for (const img of screenshots) {
    content.push(img);
  }

  content.push({
    type: 'text',
    text: `## Bug Report\n\n**Subject:** ${issue.subject}\n\n**Description:** ${issue.description}\n\n**Reported by:** ${issue.discord_username}`,
  });

  const response = await client.messages.create({
    model: config.anthropic.triageModel,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  }, REQUEST_OPTIONS);

  const text = response.content.find(b => b.type === 'text')?.text || '';

  let analysis;
  try {
    const cleaned = text.replace(/^```json?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    analysis = JSON.parse(cleaned);
  } catch (e) {
    analysis = { summary: 'Failed to parse AI response', root_cause: text, can_fix: false, confidence: 'low', patch: [], notes: 'Raw response saved' };
  }

  db.updateIssueAnalysis(issueId, JSON.stringify(analysis), 'done');
  console.log(`[AgentTriage] Issue #${issueId} analyzed: can_fix=${analysis.can_fix}, confidence=${analysis.confidence}`);
  return analysis;
}

module.exports = { analyzeIssue };
