const { EventEmitter } = require('events');

/**
 * Simple in-process event bus for SSE.
 *
 * Events:
 *   progress  - { phase, agents }
 *   log       - { agent, line }
 *   finding   - { agent, count }
 *   cost      - { totalCost, totalTokens }
 *   done      - { phase }
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
