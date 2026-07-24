import { describe, expect, it } from 'vitest';
import { ACTION_MAP } from '../skills/pw-browse/scripts/actions.js';
import { CHAINABLE_ACTIONS } from '../skills/pw-browse/scripts/chain-utils.js';
import { KNOWN_ACTIONS } from '../skills/pw-browse/scripts/sequence-validate.js';

// An action name has to be registered in three separate places to actually work:
// ACTION_MAP (execution), CHAINABLE_ACTIONS (`::` chains), and KNOWN_ACTIONS
// (sequence validation). They were kept in sync by a code comment, which is how
// `press` shipped chainable-but-unrunnable. These tests fail loudly on drift.

// Actions the chain/sequence runners implement inline rather than through ACTION_MAP.
const SPECIAL_CASED = new Set(['dialog']);

describe('action registry sync', () => {
  it('every chainable action is executable via ACTION_MAP', () => {
    const missing = CHAINABLE_ACTIONS.filter(a => !SPECIAL_CASED.has(a) && !(a in ACTION_MAP));
    expect(missing).toEqual([]);
  });

  it('every chainable action passes sequence validation', () => {
    const missing = CHAINABLE_ACTIONS.filter(a => !KNOWN_ACTIONS.has(a));
    expect(missing).toEqual([]);
  });

  it('every ACTION_MAP action is known to the sequence validator', () => {
    const missing = Object.keys(ACTION_MAP).filter(a => !KNOWN_ACTIONS.has(a));
    expect(missing).toEqual([]);
  });
});
