'use strict';

const fs = require('fs');
const path = require('path');

const logPath = path.join(require('os').homedir(), 'atleta-bridge.log');
try { fs.writeFileSync(logPath, ''); } catch(e) {}
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try { fs.appendFileSync(logPath, line); } catch(e) {}
}

let statusCallback = null;
let connected = false;
let pollInterval = null;
let connectInterval = null;

const { broadcastToChannel, getClientInfo } = require('./websocket');

// Fuel tracking
let fuelHistory = [];
let lastLap = -1;
let fuelAtLapStart = null;

function resetFuel() { fuelHistory = []; lastLap = -1; fuelAtLapStart = null; }

async function startTelemetry(onStatusChange) {
  statusCallback = onStatusChange;
  log('[Telemetry] Starting...');

  let IRSDK, VARS;
  try {
    const sdk = await import('@emiliosp/node-iracing-sdk');
    IRSDK = sdk.IRSDK;
    VARS = sdk.VARS;
    log('[Telemetry] SDK loaded. VARS: ' + Object.keys(VARS).length);
  } catch (e) {
    log('[Telemetry] SDK FAILED: ' + e.message);
    return;
  }

  let ir = null;
  let sessionInfoFound = false;
  let drivers = [];
  let playerCarIdx = 0;
  let pollCount = 0;

  connectInterval = setInterval(async () => {
    if (ir && connected) return;
    try {
      ir = await IRSDK.connect();
      if (ir && !connected) {
        connected = true;
        sessionInfoFound = false;
        drivers = [];
        playerCarIdx = 0;
        pollCount = 0;
        resetFuel();
        log('[Telemetry] Connected to iRacing!');
        broadcastToChannel('_all', { type: 'status', iracing: true });
        if (statusCallback) statusCallback({ iracing: true });
        startPolling();
      }
    } catch (e) {
      if (connected) {
        connected = false; ir = null;
        log('[Telemetry] Disconnected: ' + e.message);
        broadcastToChannel('_all', { type: 'status', iracing: false });
        if (statusCallback) statusCallback({ iracing: false });
        resetFuel();
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      }
    }
  }, 3000);

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(() => {
      try {
        if (!ir.isConnected()) {
          if (connected) {
            connected = false;
            log('[Telemetry] Disconnected during poll');
            broadcastToChannel('_all', { type: 'status', iracing: false });
            if (statusCallback) statusCallback({ iracing: false });
            resetFuel(); clearInterval(pollInterval); pollInterval = null;
          }
          return;
        }

        ir.refreshSharedMemory();
        pollCount++;

        // === Try to get session info (may take several polls to become available) ===
        if (!sessionInfoFound) {
          try {
            const si = ir.getSessionInfo();
            if (si && typeof si === 'object' && Object.keys(si).length > 0) {
              sessionInfoFound = true;
              drivers = si.DriverInfo?.Drivers || [];
              playerCarIdx = si.DriverInfo?.DriverCarIdx ?? 0;
              log('[SessionInfo] Found! Track: ' + (si.WeekendInfo?.TrackDisplayName || '?'));
              log('[SessionInfo] PlayerCarIdx: ' + playerCarIdx);
              log('[SessionInfo] Drivers: ' + drivers.length);
              drivers.slice(0, 3).forEach((d, i) => log('[SessionInfo] D[' + i + '] idx=' + d.CarIdx + ' ' + d.UserName + ' #' + d.CarNumber));
            } else if (pollCount % 50 === 0) {
              // Every 5 seconds, try alternative methods
              log('[SessionInfo] Still null after ' + pollCount + ' polls. Trying alternatives...');

              // Try getSessionInfoBinary
              try {
                const binary = ir.getSessionInfoBinary();
                if (binary) {
                  let str;
                  if (typeof binary === 'string') str = binary;
                  else if (Buffer.isBuffer(binary)) str = binary.toString('utf8');
                  else if (binary.buffer) str = Buffer.from(binary.buffer).toString('utf8');

                  if (str && str.length > 10) {
                    log('[SessionInfo] Binary data found, length: ' + str.length);
                    log('[SessionInfo] First 300 chars: ' + str.substring(0, 300).replace(/\n/g, '\\n'));

                    // Try to parse YAML
                    try {
                      const parsed = ir.parseYamlContent(str);
                      if (parsed && Object.keys(parsed).length > 0) {
                        sessionInfoFound = true;
                        drivers = parsed.DriverInfo?.Drivers || [];
                        playerCarIdx = parsed.DriverInfo?.DriverCarIdx ?? 0;
                        log('[SessionInfo] Parsed from binary! Drivers: ' + drivers.length);
                      }
                    } catch(pe) { log('[SessionInfo] YAML parse error: ' + pe.message); }
                  }
                }
              } catch(be) { log('[SessionInfo] Binary error: ' + be.message); }

              // Try reading sessionInfoDict directly
              if (!sessionInfoFound && ir.sessionInfoDict && Object.keys(ir.sessionInfoDict).length > 0) {
                log('[SessionInfo] Found in sessionInfoDict! Keys: ' + Object.keys(ir.sessionInfoDict).join(', '));
                drivers = ir.sessionInfoDict.DriverInfo?.Drivers || [];
                playerCarIdx = ir.sessionInfoDict.DriverInfo?.DriverCarIdx ?? 0;
                if (drivers.length > 0) sessionInfoFound = true;
              }
            }
          } catch(e) {
            if (pollCount % 100 === 0) log('[SessionInfo] Error: ' + e.message);
          }
        }

        // === Fuel ===
        const fuelLevel = ir.get(VARS.FUEL_LEVEL)?.[0] || 0;
        const fuelPct = ir.get(VARS.FUEL_LEVEL_PCT)?.[0] || 0;
        const fuelUsePerHour = ir.get(VARS.FUEL_USE_PER_HOUR)?.[0] || 0;
        const currentLap = ir.get(VARS.LAP)?.[0] || 0;
        const lapsCompleted = ir.get(VARS.LAP_COMPLETED)?.[0] || 0;
        const sessionLapsRemain = ir.get(VARS.SESSION_LAPS_REMAIN_EX)?.[0] || 0;

        if (currentLap > lastLap && lastLap >= 0 && fuelAtLapStart !== null) {
          const used = fuelAtLapStart - fuelLevel;
          if (used > 0.01) { fuelHistory.push(used); if (fuelHistory.length > 20) fuelHistory.shift(); }
          fuelAtLapStart = fuelLevel;
        }
        if (lastLap < 0 || currentLap > lastLap) { if (fuelAtLapStart === null) fuelAtLapStart = fuelLevel; lastLap = currentLap; }

        const avg5 = fuelHistory.length > 0 ? fuelHistory.slice(-5).reduce((a,b) => a+b, 0) / Math.min(fuelHistory.length, 5) : 0;
        const avg10 = fuelHistory.length > 0 ? fuelHistory.slice(-10).reduce((a,b) => a+b, 0) / Math.min(fuelHistory.length, 10) : 0;
        const avgAll = fuelHistory.length > 0 ? fuelHistory.reduce((a,b) => a+b, 0) / fuelHistory.length : 0;
        const minUsage = fuelHistory.length > 0 ? Math.min(...fuelHistory) : 0;
        const maxUsage = fuelHistory.length > 0 ? Math.max(...fuelHistory) : 0;
        const lapsOfFuel = avgAll > 0 ? fuelLevel / avgAll : 0;
        const isUnlimited = sessionLapsRemain >= 32767;
        const fuelToFinish = (!isUnlimited && avgAll > 0) ? sessionLapsRemain * avgAll : 0;
        const fuelToAdd = fuelToFinish > 0 ? Math.max(0, fuelToFinish - fuelLevel) : 0;

        broadcastToChannel('fuel', { type: 'data', channel: 'fuel', data: {
          fuelLevel, fuelPct, fuelUsePerHour, avgPerLap: avgAll, avg5Laps: avg5, avg10Laps: avg10,
          minUsage, maxUsage, lapsOfFuel, lapsRemaining: isUnlimited ? '∞' : sessionLapsRemain,
          fuelToFinish, fuelToAdd, lapsCompleted, lapCount: fuelHistory.length,
        }});

        // === Wind ===
        broadcastToChannel('wind', { type: 'data', channel: 'wind', data: {
          windDirection: ir.get(VARS.WIND_DIR)?.[0] || 0,
          windSpeed: ir.get(VARS.WIND_VEL)?.[0] || 0,
          carHeading: ir.get(VARS.YAW)?.[0] || 0,
        }});

        // === Proximity ===
        broadcastToChannel('proximity', { type: 'data', channel: 'proximity', data: {
          carLeftRight: ir.get(VARS.CAR_LEFT_RIGHT)?.[0] || 0,
        }});

        // === Standings (even without session info, use car indices) ===
        const positions = ir.get(VARS.CAR_IDX_POSITION) || [];
        const classPositions = ir.get(VARS.CAR_IDX_CLASS_POSITION) || [];
        const lapsCompletedArr = ir.get(VARS.CAR_IDX_LAP_COMPLETED) || [];
        const bestLaps = ir.get(VARS.CAR_IDX_BEST_LAP_TIME) || [];
        const lastLaps = ir.get(VARS.CAR_IDX_LAST_LAP_TIME) || [];
        const onPitRoad = ir.get(VARS.CAR_IDX_ON_PIT_ROAD) || [];
        const estTime = ir.get(VARS.CAR_IDX_EST_TIME) || [];
        const lapDistPct = ir.get(VARS.CAR_IDX_LAP_DIST_PCT) || [];

        broadcastToChannel('session', { type: 'data', channel: 'session', data: {
          playerCarIdx,
          trackName: '',
          drivers: drivers.map(d => ({ carIdx: d.CarIdx, driverName: d.UserName, carNumber: d.CarNumber })),
        }});

        const standings = [];
        for (let i = 0; i < lapsCompletedArr.length; i++) {
          if (lapsCompletedArr[i] === undefined || lapsCompletedArr[i] < 0) continue;

          // Find driver name from session info, or use "Car #idx"
          const driver = drivers.find(d => d.CarIdx === i);
          const name = driver?.UserName || ('Car ' + i);
          const number = driver?.CarNumber || String(i);

          standings.push({
            carIdx: i,
            position: positions[i] || 0,
            classPosition: classPositions[i] || 0,
            driverName: name,
            carNumber: number,
            lastLap: lastLaps[i] > 0 ? lastLaps[i].toFixed(3) : '',
            bestLap: bestLaps[i] > 0 ? bestLaps[i].toFixed(3) : '',
            inPit: !!onPitRoad[i],
            lapsCompleted: lapsCompletedArr[i] || 0,
            estTime: estTime[i] || 0,
            lapDistPct: lapDistPct[i] || 0,
            isPlayer: i === playerCarIdx,
          });
        }
        standings.sort((a, b) => {
          if (a.position > 0 && b.position > 0) return a.position - b.position;
          if (a.position > 0) return -1;
          if (b.position > 0) return 1;
          if (a.lapsCompleted !== b.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
          return b.lapDistPct - a.lapDistPct;
        });

        // Log standings count periodically
        if (pollCount === 10) {
          log('[Standings] Built: ' + standings.length + ' cars (sessionInfo: ' + (sessionInfoFound ? 'yes' : 'no') + ', drivers: ' + drivers.length + ')');
          if (standings.length > 0) log('[Standings] First: ' + JSON.stringify(standings[0]));
          if (standings.length === 0) {
            log('[Standings] LapsCompleted active: ' + lapsCompletedArr.filter(l => l >= 0).length);
            log('[Standings] LapsCompleted[0..9]: ' + JSON.stringify(lapsCompletedArr.slice(0, 10)));
          }
        }

        broadcastToChannel('standings', { type: 'data', channel: 'standings', data: standings });

        // === Relative ===
        const playerEst = estTime[playerCarIdx] || 0;
        const relative = standings
          .filter(s => s.carIdx !== playerCarIdx && s.estTime > 0)
          .map(s => {
            let gap = s.estTime - playerEst;
            if (gap > 50) gap -= 100;
            if (gap < -50) gap += 100;
            return { ...s, gap };
          })
          .sort((a, b) => a.gap - b.gap)
          .filter(s => Math.abs(s.gap) < 30);

        broadcastToChannel('relative', { type: 'data', channel: 'relative', data: {
          playerCarIdx, cars: relative,
        }});

      } catch (e) {
        if (pollCount % 100 === 0) log('[Telemetry] Poll error: ' + e.message);
      }
    }, 100);
  }
}

function stopTelemetry() {
  connected = false;
  if (pollInterval) clearInterval(pollInterval);
  if (connectInterval) clearInterval(connectInterval);
}

module.exports = { startTelemetry, stopTelemetry, getStatus: () => ({ iracing: connected }) };
