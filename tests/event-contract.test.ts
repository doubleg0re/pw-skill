// event-contract.test.ts — Verify core and pw-monitor tab event contracts stay in sync
import { describe, it, expect } from 'vitest';
import {
  TAB_EVENTS,
  TAB_EVENT_REQUIRED_FIELDS,
  buildTabEvent,
  type TabEventPayload,
} from '../skills/pw-browse/scripts/tab-registry.js';
import {
  TAB_EVENTS as MONITOR_TAB_EVENTS,
  type TabEventPayload as MonitorTabEventPayload,
} from '../extensions/pw-monitor/src/tab-sync.js';

// --- Event name contract ---

describe('TAB_EVENTS contract', () => {
  it('core defines created, closed, navigated, activated, deactivated', () => {
    expect(TAB_EVENTS.CREATED).toBe('tab:created');
    expect(TAB_EVENTS.CLOSED).toBe('tab:closed');
    expect(TAB_EVENTS.NAVIGATED).toBe('tab:navigated');
    expect(TAB_EVENTS.ACTIVATED).toBe('tab:activated');
    expect(TAB_EVENTS.DEACTIVATED).toBe('tab:deactivated');
  });

  it('pw-monitor mirrors core event names exactly', () => {
    expect(MONITOR_TAB_EVENTS.CREATED).toBe(TAB_EVENTS.CREATED);
    expect(MONITOR_TAB_EVENTS.CLOSED).toBe(TAB_EVENTS.CLOSED);
    expect(MONITOR_TAB_EVENTS.NAVIGATED).toBe(TAB_EVENTS.NAVIGATED);
    expect(MONITOR_TAB_EVENTS.ACTIVATED).toBe(TAB_EVENTS.ACTIVATED);
    expect(MONITOR_TAB_EVENTS.DEACTIVATED).toBe(TAB_EVENTS.DEACTIVATED);
  });

  it('core and pw-monitor have the same event set', () => {
    const coreKeys = Object.keys(TAB_EVENTS).sort();
    const monitorKeys = Object.keys(MONITOR_TAB_EVENTS).sort();
    expect(monitorKeys).toEqual(coreKeys);
  });
});

// --- Payload shape contract ---

describe('TabEventPayload contract', () => {
  it('buildTabEvent produces all required fields', () => {
    const entry = { tabId: 1, url: 'http://test.com', title: 'Test', createdAt: '2026-01-01T00:00:00Z' };
    const payload = buildTabEvent(TAB_EVENTS.NAVIGATED, 'my-session', entry);

    for (const field of TAB_EVENT_REQUIRED_FIELDS) {
      expect(payload).toHaveProperty(field);
      expect(payload[field as keyof TabEventPayload]).toBeDefined();
    }
  });

  it('buildTabEvent uses canonical shape', () => {
    const entry = { tabId: 42, url: 'http://example.com', title: 'Example', createdAt: '2026-01-01T00:00:00Z' };
    const payload = buildTabEvent(TAB_EVENTS.CREATED, 'dev', entry);

    expect(payload.event).toBe('tab:created');
    expect(payload.session).toBe('dev');
    expect(payload.tabId).toBe(42);
    expect(payload.url).toBe('http://example.com');
    expect(payload.title).toBe('Example');
    expect(typeof payload.timestamp).toBe('string');
  });

  it('pw-monitor payload shape matches core required fields', () => {
    // Simulate a pw-monitor event payload
    const monitorPayload: MonitorTabEventPayload = {
      event: MONITOR_TAB_EVENTS.CREATED,
      session: 'test',
      tabId: 1,
      url: 'http://test.com',
      title: 'Test',
      timestamp: new Date().toISOString(),
    };

    for (const field of TAB_EVENT_REQUIRED_FIELDS) {
      expect(monitorPayload).toHaveProperty(field);
    }
  });

  it('required fields list is complete', () => {
    expect(TAB_EVENT_REQUIRED_FIELDS).toContain('event');
    expect(TAB_EVENT_REQUIRED_FIELDS).toContain('session');
    expect(TAB_EVENT_REQUIRED_FIELDS).toContain('tabId');
    expect(TAB_EVENT_REQUIRED_FIELDS).toContain('url');
    expect(TAB_EVENT_REQUIRED_FIELDS).toContain('timestamp');
    // title is optional
    expect(TAB_EVENT_REQUIRED_FIELDS).not.toContain('title');
  });
});
