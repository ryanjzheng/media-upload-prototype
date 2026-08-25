import { createApp, files, lakebase, server } from '@databricks/appkit';
import { media, setupMediaTables } from 'media-upload-plugin/server';
import { setupRecordRoutes } from './records';

// AppKit 0.58.0 types the configured Files plugin name as `string`; retain its
// runtime name as a literal so createApp exposes the documented `appkit.files`.
const mediaFiles = {
  ...files({
    maxUploadSize: 20 * 1024 * 1024,
    volumes: {
      files: {
        auth: 'on-behalf-of-user',
        policy: files.policy.allowAll(),
      },
    },
  }),
  name: 'files' as const,
};

createApp({
  plugins: [
    server(),
    mediaFiles,
    lakebase(),
    media({ volumeKey: 'files' }),
  ],
  async onPluginsReady(appkit) {
    // media() mounts routes in setup() and creates media.media_assets on
    // setup:complete. Re-run DDL here so a swallowed lifecycle error still
    // cannot leave the records FK pointing at a missing table.
    await setupMediaTables(appkit);
    await setupRecordRoutes(appkit);
  },
}).catch((error: unknown) => {
  console.error('Failed to start media upload demo', error);
  process.exitCode = 1;
});
