import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ClamdJobsitePhotoScanner } from './jobsitePhotoScanner';

describe('Jobsite photo scanner connection', () => {
  it.each([
    ['stream: OK', 'clean'],
    ['stream: Fixture.Signature FOUND', 'infected'],
    ['stream: INSTREAM size limit exceeded. ERROR', 'failed'],
  ])('streams the original bytes and classifies %s', async (response, state) => {
    const bytes = Buffer.alloc(64 * 1024 + 5, 7);
    const first = Buffer.alloc(4);
    first.writeUInt32BE(64 * 1024);
    const second = Buffer.alloc(4);
    second.writeUInt32BE(5);
    const wire = Buffer.concat([
      Buffer.from('zINSTREAM\0'),
      first,
      bytes.subarray(0, 64 * 1024),
      second,
      bytes.subarray(64 * 1024),
      Buffer.alloc(4),
    ]);
    let received = Buffer.alloc(0);
    const server = createServer((socket) => {
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length >= wire.length) {
          socket.write(response.slice(0, 8));
          socket.end(response.slice(8) + '\0');
        }
      });
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const { port } = server.address() as AddressInfo;
      const scanner = new ClamdJobsitePhotoScanner({ host: '127.0.0.1', port });
      expect(await scanner.scan(bytes)).toBe(state);
      expect(received).toEqual(wire);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
