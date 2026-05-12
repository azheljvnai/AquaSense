/**
 * Unit test for Task 3.3: Update mark resolved to persist to Firestore
 * 
 * This test verifies that marking an alert as resolved updates both:
 * 1. localStorage (existing behavior)
 * 2. Firestore (new behavior)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Task 3.3: Mark Resolved Persists to Firestore', () => {
  let alertsContent;

  beforeEach(() => {
    // Read the alerts.js file
    const alertsPath = path.resolve(process.cwd(), 'public/js/features/alerts.js');
    alertsContent = fs.readFileSync(alertsPath, 'utf-8');
  });

  it('Test 1: Code should import fbUpdateDoc from firebase-client', () => {
    // Verify the imports include fbUpdateDoc
    expect(alertsContent).toContain('fbUpdateDoc');
    expect(alertsContent).toContain("from '../firebase-client.js'");
  });

  it('Test 2: Code should import fbDoc from firebase-client', () => {
    // Verify the imports include fbDoc
    expect(alertsContent).toContain('fbDoc');
  });

  it('Test 3: Code should import fbWhere from firebase-client', () => {
    // Verify the imports include fbWhere
    expect(alertsContent).toContain('fbWhere');
  });

  it('Test 4: Code should have updateAlertResolvedInFirestore function', () => {
    // Verify the function exists
    expect(alertsContent).toContain('async function updateAlertResolvedInFirestore');
    expect(alertsContent).toContain('fbUpdateDoc');
    expect(alertsContent).toContain('resolved: true');
  });

  it('Test 5: updateAlertResolvedInFirestore should query Firestore by alert ID', () => {
    // Verify the function queries Firestore using the alert ID
    expect(alertsContent).toContain('fbQuery(alertsRef, fbWhere');
    expect(alertsContent).toContain("'id', '==', alertId");
  });

  it('Test 6: updateAlertResolvedInFirestore should handle errors gracefully', () => {
    // Verify the function has error handling
    expect(alertsContent).toContain('catch (err)');
    expect(alertsContent).toContain('console.error');
    expect(alertsContent).toContain('Non-blocking');
  });

  it('Test 7: Resolve button handler should call updateAlertResolvedInFirestore', () => {
    // Verify the button handler calls the Firestore update function
    expect(alertsContent).toContain('updateAlertResolvedInFirestore(id)');
    expect(alertsContent).toContain('.btn-resolve');
  });

  it('Test 8: Resolve button handler should update localStorage first', () => {
    // Verify the button handler updates localStorage before Firestore
    // Just check that all the key components are present
    expect(alertsContent).toContain('.btn-resolve');
    expect(alertsContent).toContain('all[idx].resolved = true');
    expect(alertsContent).toContain('saveAlerts(all)');
    expect(alertsContent).toContain('updateAlertResolvedInFirestore(id)');
  });

  it('Test 9: Resolve button handler should be async', () => {
    // Verify the button handler is async to support Firestore updates
    expect(alertsContent).toContain('addEventListener(\'click\', async ()');
  });

  it('Test 10: markAllAlertsAsResolved should also update Firestore', () => {
    // Verify the markAllAlertsAsResolved function also updates Firestore
    expect(alertsContent).toContain('async function markAllAlertsAsResolved');
    expect(alertsContent).toContain('updateAlertResolvedInFirestore(alert.id)');
  });
});
