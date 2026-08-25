# Media Upload Plugin

Reusable AppKit 0.58.0 media capability: a formal `media()` plugin (routes + `media.media_assets` table) plus React upload/preview components. File bytes stay in a Unity Catalog Volume through AppKit Files (on-behalf-of-user); metadata stays in the app-owned Lakebase `media.media_assets` table.

## Consumer setup

```json
{
  "dependencies": {
    "media-upload-plugin": "file:../media-upload-plugin"
  }
}
```

```ts
import { createApp, files, lakebase, server } from '@databricks/appkit';
import { media } from 'media-upload-plugin/server';

createApp({
  plugins: [
    server(),
    files({
      maxUploadSize: 20 * 1024 * 1024,
      volumes: {
        files: {
          auth: 'on-behalf-of-user',
          policy: files.policy.allowAll(),
        },
      },
    }),
    lakebase(),
    media({ volumeKey: 'files' }),
  ],
});
```

`media()` mounts `/api/media/*` during plugin `setup()`, then creates
`media.media_assets` on AppKit's `setup:complete` lifecycle (after `lakebase`
has assigned its pool). AppKit runs plugin `setup()` concurrently, so querying
Lakebase from `setup()` itself races. No `onPluginsReady` glue required for
media routes; consumers that also create FKs onto `media.media_assets` can
call `setupMediaTables` from `onPluginsReady` (idempotent).

**Back-compat:** the original plain functions are still exported for consumers not
yet on the plugin — call them from `onPluginsReady` instead:

```ts
import { setupMediaTables, registerMediaRoutes } from 'media-upload-plugin/server';
// onPluginsReady(appkit): await setupMediaTables(appkit); registerMediaRoutes(appkit, { volumeKey: 'files' });
```

Import `media-upload-plugin/styles.css`, then use `MediaUpload`, `MediaCell`, or `MediaPreview` from `media-upload-plugin/react`. Components only call `/api/media`; they never use Databricks SDKs.

## Required app resources

- `DATABRICKS_VOLUME_FILES` wired with `valueFrom: files`
- `LAKEBASE_ENDPOINT` wired with `valueFrom: postgres`
- `user_api_scopes: [files.files]`
- App service principal: Lakebase `CAN_CONNECT_AND_CREATE`
- Each end user: UC `READ VOLUME` and `WRITE VOLUME` on the configured volume

Uploads use a raw request body:

```text
POST /api/media/upload?collection=record-photos&path=photo.jpg
Content-Type: image/jpeg
<file bytes>
```

Allowed types are `image/*` and `application/pdf`; size is capped at 20 MB. Paths are `{collection}/{uuid}/{sanitized-file-name}`. Deletes are soft deletes; volume bytes are retained. PDF thumbnails are a generic icon and `/raw` opens in the browser viewer. Antivirus scanning and metadata/byte authorization parity are intentionally outside this prototype.
