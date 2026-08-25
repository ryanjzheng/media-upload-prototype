# Media Upload Plugin — Consumer Quick Start

Drop governed image and PDF attachments into an **AppKit 0.58.0** app. End users pick a file; Unity Catalog governs the bytes; your record stores a media id.

This is a how-to. Target: productive in about 15 minutes. Plugin version: **0.2.1**.

---

## What you get

- A `media()` AppKit plugin that owns `/api/media/*` and the Lakebase table `media.media_assets`.
- React widgets: `<MediaUpload>`, `<MediaCell>`, `<MediaPreview>`.
- PNG, JPEG, WebP, GIF, and PDF, 20 MB max. The server checks MIME type and file signature. Images get a WebP thumbnail; PDFs get an icon and open in the browser viewer.

### How it fits together

```
Browser                  App server                         Storage
<MediaUpload>  ──POST──▶  /api/media/upload  ──bytes──▶     UC Volume  (on-behalf-of-user)
                         /api/media/upload  ──row────▶     Lakebase   (media.media_assets)

returns { id, … }  ──▶  you store that id on YOUR record   (the media reference)
```

- **Bytes** live in a Unity Catalog **Volume**, through AppKit **Files**, as the **signed-in user**.
- **Metadata** lives in the app-owned Lakebase table **`media.media_assets`** (created at startup).
- **Your tables point at media by id.** The browser never talks to Databricks — only to `/api/media/*`.

---

## Prerequisites: permissions & grants

Before deploying, provision the following. Everything is Unity Catalog and Lakebase — no extra service accounts needed beyond the app service principal Databricks creates automatically.

### Unity Catalog Volume

The app uses **on-behalf-of-user (OBO)** for file operations, meaning uploads and reads go through the signed-in user's own identity — not the app SP. Because of this, every end user needs volume grants directly.

| Grant | On | To whom |
|---|---|---|
| `READ_VOLUME` | Your UC Volume (`catalog.schema.volume`) | Every end user |
| `WRITE_VOLUME` | Same volume | Every end user |

The app SP does **not** need volume grants for OBO operations.

### Lakebase (Postgres)

The app SP creates the `media` schema and `media.media_assets` table on first startup. It needs permission to do so:

| Grant | On | To whom |
|---|---|---|
| `CAN_CONNECT_AND_CREATE` | Your Lakebase database | App service principal |

### App resource declarations (`databricks.yml`)

Two resource blocks are required on the app — these wire the volume and Lakebase into the app's identity:

```yaml
resources:
  apps:
    app:
      user_api_scopes:
        - files.files           # enables OBO file access
      resources:
        - name: files
          uc_securable:
            securable_full_name: catalog.schema.volume
            securable_type: VOLUME
            permission: WRITE_VOLUME
        - name: postgres
          postgres:
            branch: <your-lakebase-branch-resource-name>
            database: <your-lakebase-database-resource-name>
            permission: CAN_CONNECT_AND_CREATE
```

### On-behalf-of-user (OBO)

OBO is enabled by two things in combination: `auth: 'on-behalf-of-user'` in the `files()` plugin config, and `user_api_scopes: [files.files]` in `databricks.yml`. No separate OBO grant is required — Databricks forwards the signed-in user's identity automatically when those two are set.

**OBO only works when the app is deployed.** Locally, uploads fall back to `local-developer` and no OBO token is used.

### Summary

| Resource | Grant | Granted to |
|---|---|---|
| UC Volume | `READ_VOLUME`, `WRITE_VOLUME` | Every end user |
| Lakebase database | `CAN_CONNECT_AND_CREATE` | App service principal |
| App `databricks.yml` — volume resource | `WRITE_VOLUME` | App (for OBO brokering) |
| App `databricks.yml` — postgres resource | `CAN_CONNECT_AND_CREATE` | App |
| App `databricks.yml` — app definition | `user_api_scopes: files.files` | App |

---

## What you must wire

The plugin manifest declares a volume and a Lakebase database. You still provision them on the app:

| Need | Where to set it |
|---|---|
| UC **Volume**, bound as `files` | `app.yaml`: `DATABRICKS_VOLUME_FILES` → `valueFrom: files`. `databricks.yml`: volume resource, `WRITE_VOLUME`. |
| **Lakebase**, bound as `postgres` | `app.yaml`: `LAKEBASE_ENDPOINT` → `valueFrom: postgres`. `databricks.yml`: postgres resource, `CAN_CONNECT_AND_CREATE`. |
| **`user_api_scopes: [files.files]`** | `databricks.yml` on the **app** (not in the plugin manifest). |
| App service principal: **`CAN_CONNECT_AND_CREATE`** | so it can create the `media` schema and table on first start. |
| **Each end user**: UC **`READ VOLUME`** + **`WRITE VOLUME`** | required because Files runs **on-behalf-of-user**, not as the app SP. |

Copy the working wiring from `media-upload-demo/app.yaml` and `media-upload-demo/databricks.yml`.

---

## Install and register

```jsonc
// package.json
{
  "dependencies": {
    "media-upload-plugin": "0.2.1",
    "@databricks/appkit": "0.58.0"
  }
}
```

Until this is on a registry, the demo consumes a packed tarball: `file:media-upload-plugin-0.2.1.tgz` (from `cd media-upload-plugin && npm pack`).

Register `media()` **after** `files()` and `lakebase()`:

```ts
import { createApp, files, lakebase, server } from '@databricks/appkit';
import { media } from 'media-upload-plugin/server';

const mediaFiles = {
  ...files({
    maxUploadSize: 20 * 1024 * 1024,
    volumes: {
      files: { auth: 'on-behalf-of-user', policy: files.policy.allowAll() },
    },
  }),
  name: 'files' as const, // keeps appkit.files typed; volumeKey below must match
};

await createApp({
  plugins: [
    server(),
    mediaFiles,
    lakebase(),
    media({ volumeKey: 'files' }),
  ],
});
```

That mounts the media routes and creates `media.media_assets` at startup. You do **not** register those routes yourself.

If **your** tables have a foreign key to `media.media_assets`, create that schema in `onPluginsReady` **after** calling `setupMediaTables` (idempotent) so the media table exists first:

```ts
import { media, setupMediaTables } from 'media-upload-plugin/server';

await createApp({
  plugins: [server(), mediaFiles, lakebase(), media({ volumeKey: 'files' })],
  async onPluginsReady(appkit) {
    await setupMediaTables(appkit);
    // then CREATE your records table with REFERENCES media.media_assets(id)
  },
});
```

Use **0.2.1 or later**. Do not call `appkit.lakebase.query` from another plugin’s `setup()` — AppKit starts plugins together, and the Lakebase pool is not ready yet.

---

## Use the React components

Import the stylesheet once, then use the widgets. They only call `/api/media/*`.

```css
/* index.css */
@import "media-upload-plugin/styles.css";
```

```tsx
import { MediaUpload, MediaCell, MediaPreview, type MediaAsset }
  from 'media-upload-plugin/react';
```

**`<MediaUpload>`** — dropzone. Uploads on file select and returns the asset:

```tsx
<MediaUpload
  collection="record-photos"
  mediaId={currentId} // omit for a new upload; pass an id to replace
  onUploaded={(asset: MediaAsset) => setMediaId(asset.id)}
  onError={(e) => console.error(e.message)}
/>
```

**`<MediaCell>`** — thumbnail in a table. With `editable`, users can replace or remove:

```tsx
<MediaCell
  mediaId={record.photo_media_id}
  collection="record-photos"
  editable
  onChange={(asset) => saveMediaId(record.id, asset?.id ?? null)}
/>
```

**`<MediaPreview>`** — modal (image inline, PDF in an iframe):

```tsx
{open && <MediaPreview mediaId={id} onClose={() => setOpen(false)} />}
```

Also exported from `/react`: `uploadMedia`, `replaceMedia`, `getMediaMeta`, `deleteMedia`, `mediaRawUrl(id)`, `mediaThumbUrl(id)`, `MAX_UPLOAD_BYTES`.

---

## Attach media to your own table

1. Add a nullable UUID column. Optionally FK to the metadata table:

   ```sql
   ALTER TABLE my_schema.my_records
     ADD COLUMN photo_media_id UUID REFERENCES media.media_assets(id);
   ```

2. Save the id from `onUploaded` / `onChange`.

**Action-form pattern** (what the demo does): Edit opens a form with the record fields plus an embedded `<MediaUpload>`. Save PATCHes the record with the fields and `photo_media_id`. See `media-upload-demo/client/src/App.tsx` (`RecordActionForm`) and `media-upload-demo/server/records.ts`.

```ts
await appkit.lakebase.query(
  `UPDATE my_schema.my_records
      SET name = $2, photo_media_id = $3, updated_at = NOW()
    WHERE id = $1
    RETURNING *`,
  [id, name, photoMediaId],
);
```

---

## HTTP API

Uploads are a **raw body**, not multipart.

```
POST /api/media/upload?collection=record-photos&path=photo.jpg
Content-Type: image/jpeg
<file bytes>
```

| Method & path | Purpose |
|---|---|
| `POST /api/media/upload?collection=&path=` | Upload. `201` + `MediaAsset`. |
| `GET /api/media/:id/meta` | Metadata JSON. |
| `GET /api/media/:id/raw` | Original bytes (image or PDF). |
| `GET /api/media/:id/thumb` | WebP thumbnail, or a PDF icon. |
| `PUT /api/media/:id?collection=&path=` | Replace bytes. |
| `DELETE /api/media/:id` | Soft delete (`deleted_at`). Volume bytes stay. |

---

## Local vs deployed

On-behalf-of-user **only works when the app is deployed**. Databricks forwards the user identity and token. Locally there is no forwarded user, so uploads are attributed to `local-developer` and Files does not use an OBO token.

```bash
cd media-upload-demo
npm install
npm run dev
```

Full local upload still needs Lakebase env (`PGHOST`, `LAKEBASE_ENDPOINT`, …) and a reachable volume.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| App crashes at start: `Cannot read properties of null (reading 'query')` | You are on a plugin older than **0.2.1**, or something queries Lakebase inside plugin `setup()`. Upgrade to **0.2.1** and move your DDL to `onPluginsReady`. |
| **401** on upload | Production request has no forwarded user. Confirm app identity headers and `user_api_scopes: [files.files]`. |
| **403** from the Volume | The signed-in user is missing UC **READ VOLUME** / **WRITE VOLUME**. Grants are per user, not the app SP. |
| **413** | File is over 20 MB. |
| **400** | Not PNG/JPEG/WebP/GIF/PDF, or the bytes do not match `Content-Type`. |
| PDF thumbnail is an icon | Expected. Open `/raw` (or Preview) for the document. |
| Deleted media still on the Volume | Expected. Delete is soft; bytes are kept. |

---

## Repo map

```
media-upload-plugin/     reusable package (media-upload-plugin 0.2.1)
media-upload-demo/       sample AppKit app that consumes the packed tarball
```

Plugin: `cd media-upload-plugin && npm run typecheck && npm test && npm run build`  
Pack for the demo: `npm pack`  
Manifest: `npx appkit plugin validate ./manifest.json`
