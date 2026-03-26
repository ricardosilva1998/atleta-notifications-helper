const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(100); // Support many concurrent overlay connections

module.exports = bus;
