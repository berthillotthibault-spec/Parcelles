import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTE_PROVIDERS, routeUrl} from './utils.js';

test('itinéraire : Plans Apple, Google Maps et Waze', () => {
  assert.deepEqual(ROUTE_PROVIDERS.map(([value]) => value), ['apple', 'google', 'waze']);
  assert.equal(routeUrl('apple', 46.34, 5.13), 'https://maps.apple.com/?daddr=46.34,5.13');
  assert.equal(routeUrl('google', 46.34, 5.13), 'https://www.google.com/maps/dir/?api=1&destination=46.34,5.13');
  assert.equal(routeUrl('waze', 46.34, 5.13), 'https://waze.com/ul?ll=46.34%2C5.13&navigate=yes');
  assert.equal(routeUrl('waze', 46.34140000000001, 5.132), 'https://waze.com/ul?ll=46.3414%2C5.132&navigate=yes');
  assert.equal(routeUrl(undefined, 46.34, 5.13), 'https://maps.apple.com/?daddr=46.34,5.13');
});
