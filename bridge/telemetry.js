'use strict';

const fs = require('fs');
const path = require('path');

const logPath = path.join(require('os').homedir(), 'atleta-bridge.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try { fs.appendFileSync(logPath, line); } catch(e) {}
}

let statusCallback = null;
let connected = false;
let pollInterval = null;
let connectInterval = null;

const { broadcastToChannel } = require('./websocket');
const FuelCalculator = require('./fuel-calculator');

const fuelCalc = new FuelCalculator();

async function startTelemetry(onStatusChange) {
  statusCallback = onStatusChange;
  log('[Telemetry] Starting telemetry reader...');
  log('[Telemetry] Log file: ' + logPath);

  let IRSDK, VARS;
  try {
    log('[Telemetry] Loading @emiliosp/node-iracing-sdk...');
    const sdk = await import('@emiliosp/node-iracing-sdk');
    IRSDK = sdk.IRSDK;
    VARS = sdk.VARS;
    log('[Telemetry] SDK loaded. IRSDK type: ' + typeof IRSDK + ', VARS keys: ' + (VARS ? Object.keys(VARS).length : 0));
  } catch (e) {
    log('[Telemetry] SDK FAILED: ' + e.message);
    log('[Telemetry] Running in stub mode');
    return;
  }

  if (!IRSDK || !VARS) {
    log('[Telemetry] IRSDK or VARS not available');
    return;
  }

  let ir = null;

  // Try to connect periodically
  connectInterval = setInterval(async () => {
    if (ir && connected) return;

    try {
      ir = await IRSDK.connect();
      if (ir && !connected) {
        connected = true;
        log('[Telemetry] Connected to iRacing!');
        broadcastToChannel('_all', { type: 'status', iracing: true });
        if (statusCallback) statusCallback({ iracing: true });
        startPolling(ir, VARS);
      }
    } catch (e) {
      if (connected) {
        connected = false;
        ir = null;
        log('[Telemetry] iRacing disconnected: ' + e.message);
        broadcastToChannel('_all', { type: 'status', iracing: false });
        if (statusCallback) statusCallback({ iracing: false });
        fuelCalc.reset();
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      }
    }
  }, 3000);
}

function startPolling(ir, VARS) {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(() => {
    try {
      if (!ir || !ir.isConnected()) {
        if (connected) {
          connected = false;
          log('[Telemetry] iRacing disconnected during poll');
          broadcastToChannel('_all', { type: 'status', iracing: false });
          if (statusCallback) statusCallback({ iracing: false });
          fuelCalc.reset();
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return;
      }

      ir.refreshSharedMemory();

      // Fuel
      const fuelLevel = ir.get(VARS.FUEL_LEVEL)?.[0] || 0;
      const lap = ir.get(VARS.LAP)?.[0] || 0;
      const lapsRemaining = ir.get(VARS.SESSION_LAPS_REMAIN_EX)?.[0] || ir.get(VARS.SESSION_LAPS_REMAIN)?.[0] || 0;
      fuelCalc.update({ FuelLevel: fuelLevel, Lap: lap, SessionLapsRemain: lapsRemaining });
      broadcastToChannel('fuel', { type: 'data', channel: 'fuel', data: fuelCalc.getData() });

      // Wind
      const windDir = ir.get(VARS.WIND_DIR)?.[0] || 0;
      const windVel = ir.get(VARS.WIND_VEL)?.[0] || 0;
      const yaw = ir.get(VARS.YAW)?.[0] || 0;
      broadcastToChannel('wind', { type: 'data', channel: 'wind', data: {
        windDirection: windDir,
        windSpeed: windVel,
        carHeading: yaw,
      }});

      // Proximity
      const carLeftRight = ir.get(VARS.CAR_LEFT_RIGHT)?.[0] || 0;
      broadcastToChannel('proximity', { type: 'data', channel: 'proximity', data: {
        carLeftRight,
      }});

      // Session + Standings (read from session info)
      const sessionInfo = ir.getSessionInfo?.();
      if (sessionInfo) {
        const drivers = sessionInfo.DriverInfo?.Drivers || [];
        const playerCarIdx = sessionInfo.DriverInfo?.DriverCarIdx || 0;
        const trackName = sessionInfo.WeekendInfo?.TrackDisplayName || '';

        broadcastToChannel('session', { type: 'data', channel: 'session', data: {
          playerCarIdx,
          trackName,
          drivers: drivers.map(d => ({
            carIdx: d.CarIdx,
            driverName: d.UserName,
            carNumber: d.CarNumber,
            classColor: '#fff',
          })),
        }});

        // Standings from telemetry arrays
        const positions = ir.get(VARS.CAR_IDX_POSITION);
        const lastLaps = ir.get(VARS.CAR_IDX_LAST_LAP_TIME);
        const bestLaps = ir.get(VARS.CAR_IDX_BEST_LAP_TIME);
        const onPitRoad = ir.get(VARS.CAR_IDX_ON_PIT_ROAD);

        if (positions) {
          const standings = [];
          for (let i = 0; i < positions.length; i++) {
            if (positions[i] <= 0) continue;
            standings.push({
              carIdx: i,
              position: positions[i],
              driverName: drivers[i]?.UserName || '',
              carNumber: drivers[i]?.CarNumber || '',
              interval: '',
              lastLap: lastLaps?.[i] > 0 ? lastLaps[i].toFixed(3) : '',
              bestLap: bestLaps?.[i] > 0 ? bestLaps[i].toFixed(3) : '',
              inPit: !!onPitRoad?.[i],
              onLeadLap: true,
              classColor: '#fff',
            });
          }
          standings.sort((a, b) => a.position - b.position);
          broadcastToChannel('standings', { type: 'data', channel: 'standings', data: standings });
        }
      }

    } catch (e) {
      if (Math.random() < 0.01) log('[Telemetry] Poll error: ' + e.message);
    }
  }, 100);
}

function stopTelemetry() {
  connected = false;
  if (pollInterval) clearInterval(pollInterval);
  if (connectInterval) clearInterval(connectInterval);
}

function getStatus() {
  return { iracing: connected };
}

module.exports = { startTelemetry, stopTelemetry, getStatus };
