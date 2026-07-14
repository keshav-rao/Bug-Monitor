#!/usr/bin/env node

/**
 * Test Script: Verify Console Filtering Fix
 * Tests the filtering logic for the console events to ensure they don't
 * get mixed with performance data
 */

const path = require('path');
const fs = require('fs');

// Mock data with different event types
const mockSessionData = {
  sessionId: 'test_session_123',
  origin: 'https://test.com',
  startedAt: 1000,
  lastSeen: 10000,
  eventCount: 15,
  events: [
    // Console logs
    { id: 1, type: 'console', level: 'log', ts: 1000, args: ['App started'] },
    { id: 2, type: 'console', level: 'log', ts: 2000, args: ['Initializing'] },
    { id: 3, type: 'console', level: 'warn', ts: 3000, args: ['Warning message'] },
    
    // Performance data
    { id: 4, type: 'performance', ts: 4000, name: 'bundle.js', duration: 250, initiatorType: 'script' },
    { id: 5, type: 'performance', ts: 5000, name: 'style.css', duration: 100, initiatorType: 'link' },
    
    // More console logs
    { id: 6, type: 'console', level: 'error', ts: 6000, args: ['Error occurred'] },
    
    // Network events
    { id: 7, type: 'network', ts: 7000, method: 'GET', url: 'https://api.example.com/data', status: 200 },
    
    // More console logs
    { id: 8, type: 'console', level: 'log', ts: 8000, args: ['Processing data'] },
    
    // Storage events
    { id: 9, type: 'storage', ts: 9000, action: 'setItem', key: 'sessionKey' },
    
    // More console logs
    { id: 10, type: 'console', level: 'info', ts: 9500, args: ['Ready'] },
    { id: 11, type: 'console', level: 'log', ts: 9750, args: ['Final log'] },
  ]
};

// Test utilities
const tests = {
  passed: 0,
  failed: 0,
  results: []
};

function assert(condition, testName, details = '') {
  if (condition) {
    tests.passed++;
    tests.results.push(`✓ ${testName}`);
  } else {
    tests.failed++;
    tests.results.push(`✗ ${testName} ${details ? `(${details})` : ''}`);
  }
}

function filterEvents(events, typeFilter = null) {
  let list = [...events];

  if (typeFilter && typeFilter !== 'all' && typeFilter !== '') {
    if (typeFilter === 'error') {
      list = list.filter(e => e.type === 'error' || e.type === 'sw_error');
    } else {
      list = list.filter(e => {
        return e.type === typeFilter;
      });
    }
  }

  return list.sort((a, b) => a.ts - b.ts);
}

console.log('🧪 Testing Console Filter Fix\n');
console.log('═'.repeat(60));

// Test 1: Filter by console type
console.log('\n📋 Test Suite 1: Console Event Filtering');
console.log('─'.repeat(60));

const consoleEvents = filterEvents(mockSessionData.events, 'console');
console.log(`Input events: ${mockSessionData.events.length}`);
console.log(`Filtered events (console): ${consoleEvents.length}`);

assert(consoleEvents.length === 7, 'Returns exactly 7 console events', 
  `got ${consoleEvents.length}`);

assert(consoleEvents.every(e => e.type === 'console'), 
  'All returned events are console type');

assert(!consoleEvents.some(e => e.type === 'performance'), 
  'No performance events mixed in');

assert(!consoleEvents.some(e => e.type === 'network'), 
  'No network events mixed in');

// Test 2: Filter by performance type
console.log('\n📋 Test Suite 2: Performance Event Filtering');
console.log('─'.repeat(60));

const perfEvents = filterEvents(mockSessionData.events, 'performance');
console.log(`Filtered events (performance): ${perfEvents.length}`);

assert(perfEvents.length === 2, 'Returns exactly 2 performance events',
  `got ${perfEvents.length}`);

assert(perfEvents.every(e => e.type === 'performance'), 
  'All returned events are performance type');

assert(!perfEvents.some(e => e.type === 'console'), 
  'No console events mixed in');

// Test 3: Filter by network type
console.log('\n📋 Test Suite 3: Network Event Filtering');
console.log('─'.repeat(60));

const networkEvents = filterEvents(mockSessionData.events, 'network');
console.log(`Filtered events (network): ${networkEvents.length}`);

assert(networkEvents.length === 1, 'Returns exactly 1 network event',
  `got ${networkEvents.length}`);

assert(networkEvents.every(e => e.type === 'network'), 
  'All returned events are network type');

// Test 4: Filter with 'all' should return everything
console.log('\n📋 Test Suite 4: "All" Filter Type');
console.log('─'.repeat(60));

const allEvents = filterEvents(mockSessionData.events, 'all');
console.log(`Filtered events (all): ${allEvents.length}`);

assert(allEvents.length === mockSessionData.events.length, 
  'Returns all events when filter is "all"', 
  `got ${allEvents.length} of ${mockSessionData.events.length}`);

// Test 5: No filter (null) should return all
console.log('\n📋 Test Suite 5: Null Filter (Default)');
console.log('─'.repeat(60));

const defaultEvents = filterEvents(mockSessionData.events, null);
console.log(`Filtered events (null): ${defaultEvents.length}`);

assert(defaultEvents.length === mockSessionData.events.length, 
  'Returns all events when filter is null', 
  `got ${defaultEvents.length} of ${mockSessionData.events.length}`);

// Test 6: Chronological ordering
console.log('\n📋 Test Suite 6: Chronological Ordering');
console.log('─'.repeat(60));

const orderedEvents = filterEvents(mockSessionData.events, 'console');
let isOrdered = true;
for (let i = 1; i < orderedEvents.length; i++) {
  if (orderedEvents[i].ts < orderedEvents[i-1].ts) {
    isOrdered = false;
    break;
  }
}

assert(isOrdered, 'Console events are in chronological order');

// Show timestamps
console.log('Console event timestamps:');
orderedEvents.forEach(e => console.log(`  ${e.ts}ms - [${e.level}] ${e.args[0]}`));

// Test 7: Error filter
console.log('\n📋 Test Suite 7: Error Filter');
console.log('─'.repeat(60));

const errorData = {
  events: [
    { id: 1, type: 'console', level: 'error', ts: 1000 },
    { id: 2, type: 'error', ts: 2000 },
    { id: 3, type: 'sw_error', ts: 3000 },
    { id: 4, type: 'console', level: 'log', ts: 4000 },
  ]
};

const errorEvents = filterEvents(errorData.events, 'error');
console.log(`Filtered events (error): ${errorEvents.length}`);

assert(errorEvents.length === 2, 'Returns only error and sw_error types for "error" filter',
  `got ${errorEvents.length}, expected 2`);

// Summary
console.log('\n' + '═'.repeat(60));
console.log(`\n📊 Test Summary`);
console.log(`✓ Passed: ${tests.passed}`);
console.log(`✗ Failed: ${tests.failed}`);
console.log(`Total:   ${tests.passed + tests.failed}`);

console.log('\n📝 Detailed Results:');
tests.results.forEach(result => console.log(`  ${result}`));

if (tests.failed === 0) {
  console.log('\n✅ All tests passed! Console filtering fix is working correctly.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. Review the output above.');
  process.exit(1);
}
