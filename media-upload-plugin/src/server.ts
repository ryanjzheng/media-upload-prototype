import { createHash, randomUUID } from 'node:crypto';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  Plugin,
  toPlugin,
  type BasePluginConfig,
  type PluginManifest,
} from '@databricks/appkit';
import type { Application, Request, Response } from 'express';
import { raw } from 'express';
import sharp from 'sharp';
import manifest from '../manifest.json';
import type { MediaAsset } from './types';
import { MAX_UPLOAD_BYTES } from './types';
import {
  buildMediaPath,
  sanitizeCollection,
  sanitizeFileName,
  validateMediaBytes,
  validateMediaSize,
  validateMediaType,
} from './validation';

interface QueryResult {
  rows: Record<string, unknown>[];
}

interface VolumeDownload {
  'content-length'?: number;
  'content-type'?: string;
  contents?: NodeReadableStream<Uint8Array>;
  'last-modified'?: string;
}

interface VolumeApi {
  upload(
    filePath: string,
    contents: Buffer | string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  download(filePath: string): Promise<VolumeDownload>;
  delete(filePath: string): Promise<void>;
}

export interface MediaPluginAppKit {
  lakebase: {
    query(text: string, params?: unknown[]): Promise<QueryResult>;
  };
  files(volumeKey: string): {
    asUser(req: Request): VolumeApi;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

export interface MediaPluginOptions {
  volumeKey?: string;
}

const ASSET_COLUMNS = `
  id, collection, volume_path, file_name, mime_type, size_bytes, thumb_path,
  checksum, uploaded_by, created_at, updated_at
`;

const PDF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 200" role="img" aria-label="PDF document">
  <rect width="160" height="200" rx="16" fill="#f3f4f6"/>
  <path d="M38 0h58l26 26v126H38z" fill="#fff" stroke="#d1d5db" stroke-width="4"/>
  <path d="M96 0v28h26" fill="#e5e7eb"/>
  <rect x="18" y="118" width="124" height="50" rx="8" fill="#b91c1c"/>
  <text x="80" y="151" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">PDF</text>
</svg>`;

function mapAsset(row: Record<string, unknown>): MediaAsset {
  return {
    id: String(row.id),
    collection: String(row.collection),
    volumePath: String(row.volume_path),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    thumbPath: row.thumb_path ? String(row.thumb_path) : null,
    checksum: String(row.checksum),
    uploadedBy: String(row.uploaded_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function uploadedBy(req: Request): string {
  const identity =
    req.header('x-forwarded-email') ?? req.header('x-forwarded-user');
  if (identity) return identity;
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return 'local-developer';
  }
  throw new MediaHttpError(401, 'Forwarded user identity is required');
}

function mimeFromRequest(req: Request): string {
  return (req.header('content-type') ?? 'application/octet-stream')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

function requestBuffer(req: Request): Buffer {
  if (!Buffer.isBuffer(req.body)) {
    throw new MediaHttpError(400, 'Upload body must contain raw file bytes');
  }
  validateMediaSize(req.body.byteLength);
  return req.body;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

class MediaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getAsset(
  appkit: MediaPluginAppKit,
  id: string,
): Promise<MediaAsset> {
  if (!isUuid(id)) throw new MediaHttpError(400, 'Invalid media id');
  const result = await appkit.lakebase.query(
    `SELECT ${ASSET_COLUMNS}
     FROM media.media_assets
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new MediaHttpError(404, 'Media asset not found');
  return mapAsset(row);
}

async function createThumbnail(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { failOn: 'warning' })
    .autoOrient()
    .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

async function streamVolumeFile(
  volume: VolumeApi,
  filePath: string,
  fallbackMime: string,
  res: Response,
): Promise<void> {
  const download = await volume.download(filePath);
  if (!download.contents) {
    throw new MediaHttpError(502, 'Volume download returned no content');
  }
  res.setHeader('Content-Type', download['content-type'] ?? fallbackMime);
  if (download['content-length'] !== undefined) {
    res.setHeader('Content-Length', String(download['content-length']));
  }
  if (download['last-modified']) {
    res.setHeader('Last-Modified', download['last-modified']);
  }
  res.setHeader('Cache-Control', 'private, max-age=60');

  const reader = download.contents.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      res.write(Buffer.from(chunk.value));
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function sendError(error: unknown, res: Response): void {
  if (error instanceof MediaHttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof Error) {
    if (
      error.message.includes('20 MB') ||
      error.message.includes('allowed') ||
      error.message.includes('declared media type') ||
      error.message.includes('empty')
    ) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error.name === 'PayloadTooLargeError') {
      res.status(413).json({ error: 'File exceeds the 20 MB limit' });
      return;
    }
  }
  console.error('[media] request failed', error);
  res.status(500).json({ error: 'Media operation failed' });
}

export async function setupMediaTables(appkit: MediaPluginAppKit): Promise<void> {
  await appkit.lakebase.query('CREATE SCHEMA IF NOT EXISTS media');
  await appkit.lakebase.query(`
    CREATE TABLE IF NOT EXISTS media.media_assets (
      id UUID PRIMARY KEY,
      collection TEXT NOT NULL,
      volume_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      thumb_path TEXT,
      checksum TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await appkit.lakebase.query(`
    CREATE INDEX IF NOT EXISTS idx_media_assets_collection
    ON media.media_assets (collection)
    WHERE deleted_at IS NULL
  `);
}

export function registerMediaRoutes(
  appkit: MediaPluginAppKit,
  options: MediaPluginOptions = {},
): void {
  const volumeKey = options.volumeKey ?? 'files';
  const rawUpload = raw({ type: () => true, limit: MAX_UPLOAD_BYTES });

  appkit.server.extend((app) => {
    app.post('/api/media/upload', rawUpload, async (req, res) => {
      let uploadedPath: string | null = null;
      let thumbPath: string | null = null;
      try {
        const bytes = requestBuffer(req);
        const mimeType = mimeFromRequest(req);
        validateMediaType(mimeType);
        validateMediaBytes(bytes, mimeType);
        const collection = sanitizeCollection(
          firstQueryValue(req.query.collection) ?? '',
        );
        const fileName = sanitizeFileName(
          firstQueryValue(req.query.path) ??
            firstQueryValue(req.query.filename) ??
            'upload',
        );
        const id = randomUUID();
        uploadedPath = buildMediaPath(collection, id, fileName);
        const volume = appkit.files(volumeKey).asUser(req);
        await volume.upload(uploadedPath, bytes, { overwrite: false });

        if (mimeType.startsWith('image/')) {
          const thumbnail = await createThumbnail(bytes);
          thumbPath = `${collection}/${id}/_thumb.webp`;
          await volume.upload(thumbPath, thumbnail, { overwrite: true });
        }

        const result = await appkit.lakebase.query(
          `INSERT INTO media.media_assets (
             id, collection, volume_path, file_name, mime_type, size_bytes,
             thumb_path, checksum, uploaded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${ASSET_COLUMNS}`,
          [
            id,
            collection,
            uploadedPath,
            fileName,
            mimeType,
            bytes.byteLength,
            thumbPath,
            createHash('sha256').update(bytes).digest('hex'),
            uploadedBy(req),
          ],
        );
        res.status(201).json(mapAsset(result.rows[0]));
      } catch (error) {
        if (uploadedPath) {
          const volume = appkit.files(volumeKey).asUser(req);
          await volume.delete(uploadedPath).catch(() => undefined);
          if (thumbPath) await volume.delete(thumbPath).catch(() => undefined);
        }
        sendError(error, res);
      }
    });

    app.get('/api/media/:id/meta', async (req, res) => {
      try {
        res.json(await getAsset(appkit, req.params.id));
      } catch (error) {
        sendError(error, res);
      }
    });

    app.get('/api/media/:id/raw', async (req, res) => {
      try {
        const asset = await getAsset(appkit, req.params.id);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${asset.fileName.replace(/"/g, '')}"`,
        );
        await streamVolumeFile(
          appkit.files(volumeKey).asUser(req),
          asset.volumePath,
          asset.mimeType,
          res,
        );
      } catch (error) {
        if (!res.headersSent) sendError(error, res);
        else res.end();
      }
    });

    app.get('/api/media/:id/thumb', async (req, res) => {
      try {
        const asset = await getAsset(appkit, req.params.id);
        if (asset.thumbPath) {
          await streamVolumeFile(
            appkit.files(volumeKey).asUser(req),
            asset.thumbPath,
            'image/webp',
            res,
          );
          return;
        }
        if (asset.mimeType === 'application/pdf') {
          res
            .status(200)
            .set('Content-Type', 'image/svg+xml')
            .set('Cache-Control', 'private, max-age=300')
            .send(PDF_ICON);
          return;
        }
        await streamVolumeFile(
          appkit.files(volumeKey).asUser(req),
          asset.volumePath,
          asset.mimeType,
          res,
        );
      } catch (error) {
        if (!res.headersSent) sendError(error, res);
        else res.end();
      }
    });

    app.put('/api/media/:id', rawUpload, async (req, res) => {
      try {
        const asset = await getAsset(appkit, req.params.id);
        const bytes = requestBuffer(req);
        const mimeType = mimeFromRequest(req);
        validateMediaType(mimeType);
        validateMediaBytes(bytes, mimeType);
        const collection = sanitizeCollection(
          firstQueryValue(req.query.collection) ?? asset.collection,
        );
        const fileName = sanitizeFileName(
          firstQueryValue(req.query.path) ??
            firstQueryValue(req.query.filename) ??
            asset.fileName,
        );
        const volumePath = buildMediaPath(collection, asset.id, fileName);
        const volume = appkit.files(volumeKey).asUser(req);
        await volume.upload(volumePath, bytes, { overwrite: true });

        let thumbPath: string | null = null;
        if (mimeType.startsWith('image/')) {
          thumbPath = `${collection}/${asset.id}/_thumb.webp`;
          await volume.upload(thumbPath, await createThumbnail(bytes), {
            overwrite: true,
          });
        }

        const result = await appkit.lakebase.query(
          `UPDATE media.media_assets
           SET collection = $2, volume_path = $3, file_name = $4,
               mime_type = $5, size_bytes = $6, thumb_path = $7,
               checksum = $8, uploaded_by = $9, updated_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING ${ASSET_COLUMNS}`,
          [
            asset.id,
            collection,
            volumePath,
            fileName,
            mimeType,
            bytes.byteLength,
            thumbPath,
            createHash('sha256').update(bytes).digest('hex'),
            uploadedBy(req),
          ],
        );
        if (asset.volumePath !== volumePath) {
          await volume.delete(asset.volumePath).catch(() => undefined);
        }
        if (!thumbPath && asset.thumbPath) {
          await volume.delete(asset.thumbPath).catch(() => undefined);
        }
        res.json(mapAsset(result.rows[0]));
      } catch (error) {
        sendError(error, res);
      }
    });

    app.delete('/api/media/:id', async (req, res) => {
      try {
        if (!isUuid(req.params.id)) {
          throw new MediaHttpError(400, 'Invalid media id');
        }
        const result = await appkit.lakebase.query(
          `UPDATE media.media_assets
           SET deleted_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND deleted_at IS NULL
           RETURNING id`,
          [req.params.id],
        );
        if (!result.rows[0]) {
          throw new MediaHttpError(404, 'Media asset not found');
        }
        res.status(204).send();
      } catch (error) {
        sendError(error, res);
      }
    });
  });
}

export async function setupAndRegisterMedia(
  appkit: MediaPluginAppKit,
  options: MediaPluginOptions = {},
): Promise<void> {
  await setupMediaTables(appkit);
  registerMediaRoutes(appkit, options);
}

export interface MediaPluginConfig extends BasePluginConfig {
  /** Files-plugin volume key that stores media bytes. Defaults to `files`. */
  volumeKey?: string;
}

interface LakebaseExports {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
}

type FilesExports = (volumeKey: string) => {
  asUser(req: Request): VolumeApi;
};

interface ServerExports {
  extend(fn: (app: Application) => void): void;
}

/**
 * Formal AppKit plugin wrapper around the media server logic.
 *
 * Registers exactly the same `/api/media/*` routes and `media.media_assets`
 * table as {@link setupAndRegisterMedia}, but as a first-class AppKit `Plugin`
 * so it can be listed in `createApp({ plugins: [...] })`, ships a manifest for
 * `appkit plugin validate`/`sync`, and participates in framework telemetry.
 *
 * AppKit starts every plugin `setup()` concurrently — `phase = 'deferred'`
 * only changes *construct* order, not setup completion. Lakebase's pool is
 * assigned at the end of its `setup()`, so querying from this `setup()` races
 * and crashes with `Cannot read properties of null (reading 'query')`.
 * Routes are mounted here; schema/table DDL waits for `setup:complete`.
 */
export class MediaPlugin extends Plugin<MediaPluginConfig> {
  // JSON imports widen resource `fields` into a union tsc won't narrow to the
  // manifest's `Record<string, FieldEntry>`; the through-`unknown` cast is the
  // tsc-recommended fix and is isolated to this library.
  static manifest = manifest as unknown as PluginManifest<'media'>;
  static phase = 'deferred' as const;

  async setup(): Promise<void> {
    const volumeKey = this.config?.volumeKey ?? 'files';
    registerMediaRoutes(this.resolveAppKit(), { volumeKey });
    const context = this.context;
    if (!context) {
      throw new Error(
        'media plugin: plugin context is unavailable; register media() via createApp({ plugins: [...] })',
      );
    }
    context.onLifecycle('setup:complete', () =>
      setupMediaTables(this.resolveAppKit()),
    );
  }

  /**
   * Build the {@link MediaPluginAppKit} adapter the shared functions expect
   * from the sibling `lakebase`, `files`, and `server` plugin exports. Uses
   * only the public `PluginContext.getPlugins()` + `Plugin.exports()`;
   * `files(key).asUser(req)` keeps the on-behalf-of-user path intact.
   *
   * `exports()` is invoked at call time so Lakebase's bound `query` sees the
   * live pool, not a snapshot taken during concurrent plugin setup.
   */
  private resolveAppKit(): MediaPluginAppKit {
    const context = this.context;
    if (!context) {
      throw new Error(
        'media plugin: plugin context is unavailable; register media() via createApp({ plugins: [...] })',
      );
    }
    const plugins = context.getPlugins();
    const lakebasePlugin = plugins.get('lakebase');
    const filesPlugin = plugins.get('files');
    const serverPlugin = plugins.get('server');
    if (
      !lakebasePlugin?.exports ||
      !filesPlugin?.exports ||
      !serverPlugin?.exports
    ) {
      throw new Error(
        'media plugin requires the server(), files(), and lakebase() plugins to be registered alongside it',
      );
    }
    const lakebaseExports = lakebasePlugin.exports.bind(lakebasePlugin);
    const filesExports = filesPlugin.exports.bind(filesPlugin);
    const serverExports = serverPlugin.exports.bind(serverPlugin);
    return {
      lakebase: {
        query: (text, params) =>
          (lakebaseExports() as LakebaseExports).query(text, params),
      },
      files: (volumeKey) => (filesExports() as FilesExports)(volumeKey),
      server: {
        extend: (fn) => (serverExports() as ServerExports).extend(fn),
      },
    };
  }
}

/**
 * Register the media capability as a formal AppKit plugin:
 * `createApp({ plugins: [server(), files(...), lakebase(), media({ volumeKey: 'files' })] })`.
 *
 * The existing {@link setupMediaTables} / {@link registerMediaRoutes} /
 * {@link setupAndRegisterMedia} functions remain exported for back-compat.
 */
export const media = toPlugin(MediaPlugin);
