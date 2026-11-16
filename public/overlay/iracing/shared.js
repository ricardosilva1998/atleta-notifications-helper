'use strict';

const settings = window.OVERLAY_SETTINGS || {};
function getSetting(key, defaultValue) {
  return settings[key] !== undefined ? settings[key] : defaultValue;
}
