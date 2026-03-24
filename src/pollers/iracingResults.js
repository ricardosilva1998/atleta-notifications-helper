const iracing = require('../services/iracing');

async function check(customerId, db) {
  if (!iracing.isConfigured()) return null;

  try {
    const recentRaces = await iracing.getRecentRaces(customerId);
    if (!recentRaces || recentRaces.length === 0) return null;

    const newRaces = [];
    for (const race of recentRaces) {
      if (db.isRaceCached(String(race.subsession_id), String(customerId))) continue;

      try {
        const result = await iracing.getRaceResult(race.subsession_id);
        if (!result) continue;

        // Find this driver's result in the session
        // The result structure has session_results array, each with results array
        // Find the entry matching customerId
        let driverResult = null;
        for (const session of (result.session_results || [])) {
          const found = (session.results || []).find(r => r.cust_id === parseInt(customerId));
          if (found) { driverResult = found; break; }
        }
        if (!driverResult) continue;

        const raceData = {
          subsession_id: String(race.subsession_id),
          customer_id: String(customerId),
          driver_name: driverResult.display_name || 'Unknown',
          series_name: result.series_name || 'Unknown Series',
          track_name: result.track?.track_name || 'Unknown Track',
          car_name: driverResult.car_name || 'Unknown Car',
          category: result.license_category || 'road',
          finish_position: driverResult.finish_position + 1,
          starting_position: driverResult.starting_position + 1,
          incidents: driverResult.incidents || 0,
          irating_change: driverResult.newi_rating - driverResult.oldi_rating,
          new_irating: driverResult.newi_rating,
          laps_completed: driverResult.laps_complete || 0,
          fastest_lap_time: driverResult.best_lap_time > 0 ? driverResult.best_lap_time / 10000 : null,
          qualifying_time: driverResult.best_qual_lap_time > 0 ? driverResult.best_qual_lap_time / 10000 : null,
          field_size: result.num_drivers || 0,
          strength_of_field: result.event_strength_of_field || 0,
          race_date: result.start_time || new Date().toISOString(),
        };

        newRaces.push(raceData);
      } catch (e) {
        console.error(`[iRacing] Failed to get result for subsession ${race.subsession_id}: ${e.message}`);
      }
    }

    if (newRaces.length === 0) return null;

    return { notify: true, races: newRaces };
  } catch (e) {
    console.error(`[iRacing] Error checking ${customerId}: ${e.message}`);
    return null;
  }
}

module.exports = { check };
