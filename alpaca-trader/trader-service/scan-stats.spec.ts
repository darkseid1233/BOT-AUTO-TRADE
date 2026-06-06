import { describe, it, expect, beforeEach } from 'vitest';
import { recordGate, beginScan, endScan, getScanStats, gateFromReason } from './scan-stats.js';

describe('scan-stats', () => {
  beforeEach(() => { beginScan(); });

  it('accumulates gate counts within a scan', () => {
    recordGate('regime');
    recordGate('regime');
    recordGate('opened');
    endScan();
    const { lastScan } = getScanStats();
    expect(lastScan.regime).toBe(2);
    expect(lastScan.opened).toBe(1);
  });

  it('resets the per-scan accumulator on beginScan', () => {
    recordGate('volume');
    endScan();
    beginScan();
    recordGate('quality');
    endScan();
    const { lastScan } = getScanStats();
    expect(lastScan.volume).toBe(0);
    expect(lastScan.quality).toBe(1);
  });

  it('keeps cumulative totals across scans', () => {
    const before = getScanStats().cumulative.fearGreed;
    recordGate('fearGreed');
    endScan();
    expect(getScanStats().cumulative.fearGreed).toBe(before + 1);
  });
});

describe('gateFromReason', () => {
  it('maps insufficient bars', () => {
    expect(gateFromReason('Insufficient bars')).toBe('insufficientBars');
  });
  it('maps volume reasons', () => {
    expect(gateFromReason('low volume ratio')).toBe('volume');
  });
  it('maps quality reasons', () => {
    expect(gateFromReason('quality score 40 < 70')).toBe('quality');
  });
  it('defaults unknown reasons to regime', () => {
    expect(gateFromReason('something weird')).toBe('regime');
  });
});
