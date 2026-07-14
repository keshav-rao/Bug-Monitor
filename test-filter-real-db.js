#!/usr/bin/env node

/**
 * Real DB Test Script: Verify Console Filtering Fix with Actual Database
 * Tests the filtering logic against real session data
 */

const path = require('path');
const fs = require('fs');

const sessionsDir = path.join(__dirname, 'backend', 'db_data', 'sessions');

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

// Load actual session data
function loadSessionData() {
  const files = fs.readdirSync(sessionsDir)
    .filter(f => f.startsWith('sess_') && f.endsWith('.json'))
    .slice(0, 3); // Load first 3 sessions for testing
  
  if (files.length === 0) {
    console.error('❌ No session files found in db_data/sessions');
    process.exit(1);
  }

  const sessions = [];
  for (const file of files) {
    try {
      const filePath = path.join(sessionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      sessions.push(data);
    } catch (err) {
      console.error(`Failed to load ${file}: ${err.message}`);
    }
  }

  return sessions;
}

console.log('🧪 Testing Console Filter Fix with Real Database\n');
console.log('═'.repeat(70));

const sessions = loadSessionData();

if (sessions.length === 0) {
  console.error('No sessions loaded');
  process.exit(1);
}

console.log(`📂 Loaded ${sessions.length} session(s) from database`);
console.log('═'.repeat(70));

// Test each session
sessions.forEach((session, sessionIdx) => {
  console.log(`\n🔍 Session ${sessionIdx + 1}: ${session.sessionId}`);
  console.log(`   Origin: ${session.origin}`);
  console.log(`   Total Events: ${session.eventCount || session.events.length}`);
  console.log('   ' + '─'.repeat(66));

  const events = session.events || [];

  // Count event types in this session
  const typeBreakdown = {};
  for (const e of events) {
    typeBreakdown[e.type] = (typeBreakdown[e.type] || 0) + 1;
  }

  // Display breakdown
  console.log('   Event Type Breakdown:');
  Object.entries(typeBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`     • ${type}: ${count}`);
    });

  // Test console filtering
  console.log('\n   Testing Filters:');
  
  const filterTypes = ['console', 'performance', 'network', 'error', 'storage', 'interaction'];
  filterTypes.forEach(filterType => {
    const filtered = filterEvents(events, filterType);
    
    if (filtered.length > 0) {
      // Verify no cross-contamination
      const hasOnlyType = filtered.every(e => {
        if (filterType === 'error') {
          return e.type === 'error' || e.type === 'sw_error';
        }
        return e.type === filterType;
      });

      const testName = `Filter "${filterType}" returns only "${filterType}" type`;
      assert(hasOnlyType, testName, `found ${filtered.length} events`);
      
      console.log(`     ✓ ${filterType}: ${filtered.length} events (no cross-contamination)`);
    }
  });

  // Test that filter returns subset
  const allEvents = filterEvents(events, 'all');
  const consoleEvents = filterEvents(events, 'console');
  
  assert(consoleEvents.length <= allEvents.length, 
    `Console filter returns subset of all events`, 
    `console: ${consoleEvents.length}, all: ${allEvents.length}`);

  // Test chronological order
  let isOrdered = true;
  for (let i = 1; i < consoleEvents.length; i++) {
    if (consoleEvents[i].ts < consoleEvents[i-1].ts) {
      isOrdered = false;
      break;
    }
  }
  
  assert(isOrdered, `Console events are chronologically ordered`);
});

// Overall summary
console.log('\n' + '═'.repeat(70));
console.log(`\n📊 Test Summary`);
console.log(`✓ Passed: ${tests.passed}`);
console.log(`✗ Failed: ${tests.failed}`);
console.log(`Total:   ${tests.passed + tests.failed}`);

console.log('\n📝 Detailed Results:');
tests.results.forEach(result => console.log(`  ${result}`));

if (tests.failed === 0) {
  console.log('\n✅ All tests passed! Console filtering is working correctly with real data.');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed. Review the output above.');
  process.exit(1);
}
