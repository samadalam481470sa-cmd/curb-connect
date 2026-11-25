import { describe, expect, it } from 'vitest';
import { canonicalJson, controlPacketDigest } from './controlPacket';

describe('control audit packet digest', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    expect(
      canonicalJson({
        z: 1,
        a: { y: 2, b: [{ d: 4, c: 3 }] },
        list: [{ b: 2, a: 1 }],
      }),
    ).toBe('{"a":{"b":[{"c":3,"d":4}],"y":2},"list":[{"a":1,"b":2}],"z":1}');
  });

  it('produces the same digest for the same content in a different key order', () => {
    const left = {
      packetVersion: '1.0',
      summary: { satisfied: 3, missing: 2 },
      modules: [{ key: 'accounting', requirements: [{ gateKey: 'product-contract' }] }],
    };
    const right = {
      modules: [{ requirements: [{ gateKey: 'product-contract' }], key: 'accounting' }],
      summary: { missing: 2, satisfied: 3 },
      packetVersion: '1.0',
    };
    expect(controlPacketDigest(left)).toBe(controlPacketDigest(right));
    expect(controlPacketDigest(left)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the digest when any recorded value changes', () => {
    const base = { summary: { satisfied: 3 }, modules: [{ status: 'satisfied' }] };
    expect(controlPacketDigest({ ...base, summary: { satisfied: 4 } })).not.toBe(
      controlPacketDigest(base),
    );
    expect(controlPacketDigest({ ...base, modules: [{ status: 'expiring' }] })).not.toBe(
      controlPacketDigest(base),
    );
  });
});
