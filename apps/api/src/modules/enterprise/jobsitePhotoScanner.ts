import { createConnection } from 'node:net';
import type { MediaScanStatus } from '@fieldline/contracts';
import type { MalwareScanner } from '../media/processing';

const chunkSize = 64 * 1024;
const maximumReply = 4096;
const scanTimeoutMs = 45_000;

/** ClamAV INSTREAM over the configured private scanner connection. */
export class ClamdJobsitePhotoScanner implements MalwareScanner {
  readonly name = 'clamd';
  constructor(private readonly endpoint: { host: string; port: number }) {}

  scan(bytes: Buffer): Promise<MediaScanStatus> {
    return new Promise((resolve) => {
      const socket = createConnection(this.endpoint);
      const finish = (status: MediaScanStatus) => {
        clearTimeout(timer);
        socket.destroy();
        resolve(status);
      };
      const timer = setTimeout(() => finish('failed'), scanTimeoutMs);
      let reply = Buffer.alloc(0);

      socket.once('connect', () => {
        socket.cork();
        socket.write('zINSTREAM\0');
        for (let start = 0; start < bytes.length; start += chunkSize) {
          const chunk = bytes.subarray(start, start + chunkSize);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
        socket.uncork();
      });
      socket.on('data', (chunk: Buffer) => {
        if (reply.length + chunk.length > maximumReply) {
          finish('failed');
          return;
        }
        reply = Buffer.concat([reply, chunk]);
        const end = reply.indexOf(0);
        if (end === -1) return;
        const result = reply.toString('utf8', 0, end);
        if (result === 'stream: OK') finish('clean');
        else if (/^stream: .+ FOUND$/.test(result)) finish('infected');
        else finish('failed');
      });
      socket.once('error', () => finish('failed'));
      socket.once('end', () => finish('failed'));
    });
  }
}
