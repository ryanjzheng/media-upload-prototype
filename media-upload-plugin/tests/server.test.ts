import { once } from 'node:events';
import { type Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MediaPlugin,
  type MediaPluginAppKit,
  registerMediaRoutes,
} from '../src/server';

let server: Server | undefined;

afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        server = undefined;
        if (error) reject(error);
        else resolve();
      });
    }),
);

describe('media upload route', () => {
  it('rejects malformed image bytes before writing to the Volume', async () => {
    const upload = vi.fn();
    const app = express();
    const appkit: MediaPluginAppKit = {
      lakebase: { query: vi.fn() },
      files: () => ({
        asUser: () => ({
          upload,
          download: vi.fn(),
          delete: vi.fn(),
        }),
      }),
      server: { extend: (register) => register(app) },
    };
    registerMediaRoutes(appkit);

    const listeningServer = app.listen(0, '127.0.0.1');
    server = listeningServer;
    await once(listeningServer, 'listening');
    const address = listeningServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not bind to a TCP port');
    }

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/media/upload?collection=test&filename=bad.png`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: 'not a png',
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'File contents do not match the declared media type',
    });
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('MediaPlugin startup', () => {
  it('does not query Lakebase during setup; creates tables on setup:complete', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const extend = vi.fn();
    let onComplete: (() => void | Promise<void>) | undefined;
    const plugins = new Map([
      ['lakebase', { exports: () => ({ query }) }],
      ['files', { exports: () => () => ({ asUser: vi.fn() }) }],
      ['server', { exports: () => ({ extend }) }],
    ]);
    const plugin = new MediaPlugin({
      name: 'media',
      volumeKey: 'files',
      context: {
        getPlugins: () => plugins,
        onLifecycle: (event: string, fn: () => void | Promise<void>) => {
          if (event === 'setup:complete') onComplete = fn;
        },
      },
    });

    await plugin.setup();

    expect(query).not.toHaveBeenCalled();
    expect(extend).toHaveBeenCalledOnce();
    expect(onComplete).toBeTypeOf('function');
    await onComplete?.();
    expect(
      query.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('media.media_assets'),
      ),
    ).toBe(true);
  });
});
