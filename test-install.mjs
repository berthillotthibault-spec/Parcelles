import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installPromptDue, visitPatch, shownPatch, installPromptState, INSTALL_RETRY_MS} from './install-prompt.js';
import {detectInstallState} from './runtime.js';

const NOW = Date.UTC(2026, 9, 8, 9);
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const media = standalone => query => ({matches: standalone && query === '(display-mode: standalone)'});

test('install state: standalone, installable, ios-safari, unsupported', () => {
  assert.equal(detectInstallState({nav: {userAgent: IPHONE, standalone: true}, media: media(false)}), 'standalone');
  assert.equal(detectInstallState({nav: {userAgent: 'Android Chrome'}, media: media(true)}), 'standalone');
  assert.equal(detectInstallState({nav: {userAgent: 'Android Chrome'}, media: media(false), prompt: {prompt() {}}}), 'installable');
  assert.equal(detectInstallState({nav: {userAgent: IPHONE}, media: media(false)}), 'ios-safari');
  assert.equal(detectInstallState({nav: {userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5}, media: media(false)}), 'ios-safari', 'iPadOS presents itself as a Mac');
  assert.equal(detectInstallState({nav: {userAgent: IPHONE.replace('Version/18.0', 'CriOS/129.0')}, media: media(false)}), 'unsupported');
  assert.equal(detectInstallState({nav: {userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0'}, media: media(false)}), 'unsupported');
});

test('the sheet waits for the second day of use or the first work', () => {
  const day1 = visitPatch({}, '2026-10-08');
  assert.deepEqual({visits: day1.visits, lastVisitDay: day1.lastVisitDay}, {visits: 1, lastVisitDay: '2026-10-08'});
  assert.equal(visitPatch({installPrompt: day1}, '2026-10-08'), null, 'a reload the same day is not a new visit');
  assert.equal(installPromptDue({installState: 'ios-safari', preferences: {installPrompt: day1}, now: NOW}), false);
  assert.equal(installPromptDue({installState: 'ios-safari', preferences: {installPrompt: day1}, hasWork: true, now: NOW}), true);
  const day2 = visitPatch({installPrompt: day1}, '2026-10-09');
  assert.equal(day2.visits, 2);assert.equal(visitPatch({installPrompt: day2}, '2026-10-10'), null, 'counting stops after the second visit');
  assert.equal(installPromptDue({installState: 'installable', preferences: {installPrompt: day2}, now: NOW}), true);
  for (const state of ['standalone', 'unsupported']) assert.equal(installPromptDue({installState: state, preferences: {installPrompt: day2}, hasWork: true, now: NOW}), false);
});

test('« Plus tard » waits 14 days and stops after two reminders', () => {
  let prefs = {installPrompt: {visits: 2}};
  const shows = [];
  for (let day = 0; day < 80; day++) {
    const now = NOW + day * 864e5;
    if (installPromptDue({installState: 'ios-safari', preferences: prefs, now})) {shows.push(day);prefs = {installPrompt: shownPatch(prefs, now)};}
  }
  assert.deepEqual(shows, [0, 14, 28]);
  assert.equal(installPromptState(prefs).shownCount, 3);
  assert.equal(shownPatch({}, NOW).nextAt, NOW + INSTALL_RETRY_MS);
});

test('malformed stored values are ignored safely', () => {
  assert.deepEqual(installPromptState({installPrompt: [1, 2]}), {visits: 0, lastVisitDay: '', shownCount: 0, nextAt: 0});
  assert.deepEqual(installPromptState({installPrompt: {visits: 'x', shownCount: -4, nextAt: null, lastVisitDay: 3}}), {visits: 0, lastVisitDay: '', shownCount: 0, nextAt: 0});
});
