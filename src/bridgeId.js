// A bridge id as the Atleta Racing app makes it (crypto.randomUUID(),
// bridge/settings.js): 8 to 64 letters, digits and dashes.
const BRIDGE_ID = /^[A-Za-z0-9-]{8,64}$/;
const isBridgeId = (value) => typeof value === 'string' && BRIDGE_ID.test(value);

module.exports = { isBridgeId };
