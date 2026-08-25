import type { Application } from 'express';
import { z } from 'zod';

interface DemoAppKit {
  lakebase: {
    query(
      text: string,
      params?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
  };
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

const RecordId = z.string().uuid();
const UpdatePhotoBody = z.object({
  mediaId: z.string().uuid().nullable(),
});
const UpdateRecordBody = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  status: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(200),
  photo_media_id: z.string().uuid().nullable(),
});

export async function setupRecordRoutes(appkit: DemoAppKit): Promise<void> {
  await appkit.lakebase.query('CREATE SCHEMA IF NOT EXISTS media_demo');
  await appkit.lakebase.query(`
    CREATE TABLE IF NOT EXISTS media_demo.records (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL,
      location TEXT NOT NULL,
      photo_media_id UUID REFERENCES media.media_assets(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await appkit.lakebase.query(`
    INSERT INTO media_demo.records (id, name, category, status, location)
    VALUES
      ('11111111-1111-4111-8111-111111111111', 'Main Street Tower', 'Network site', 'Active', 'Chicago, IL'),
      ('22222222-2222-4222-8222-222222222222', 'Service Cabinet 101', 'Street cabinet', 'Inspection due', 'Denver, CO'),
      ('33333333-3333-4333-8333-333333333333', 'Central Office 5', 'Facility', 'Active', 'Austin, TX'),
      ('44444444-4444-4444-8444-444444444444', 'Relay Station 3', 'Network site', 'Maintenance', 'Seattle, WA')
    ON CONFLICT (id) DO NOTHING
  `);

  appkit.server.extend((app) => {
    app.get('/api/records', async (_req, res) => {
      try {
        const result = await appkit.lakebase.query(`
          SELECT id, name, category, status, location, photo_media_id, updated_at
          FROM media_demo.records
          ORDER BY name
        `);
        res.json(result.rows);
      } catch (error) {
        console.error('[records] list failed', error);
        res.status(500).json({ error: 'Unable to load records' });
      }
    });

    // Action-form save: update editable fields + attach media in one request.
    app.patch('/api/records/:id', async (req, res) => {
      try {
        const id = RecordId.safeParse(req.params.id);
        const body = UpdateRecordBody.safeParse(req.body);
        if (!id.success || !body.success) {
          res.status(400).json({ error: 'Invalid record payload' });
          return;
        }
        const result = await appkit.lakebase.query(
          `UPDATE media_demo.records
           SET name = $2, category = $3, status = $4, location = $5,
               photo_media_id = $6, updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, category, status, location, photo_media_id, updated_at`,
          [
            id.data,
            body.data.name,
            body.data.category,
            body.data.status,
            body.data.location,
            body.data.photo_media_id,
          ],
        );
        if (!result.rows[0]) {
          res.status(404).json({ error: 'Record not found' });
          return;
        }
        res.json(result.rows[0]);
      } catch (error) {
        console.error('[records] update failed', error);
        res.status(500).json({ error: 'Unable to update record' });
      }
    });

    app.patch('/api/records/:id/photo', async (req, res) => {
      try {
        const id = RecordId.safeParse(req.params.id);
        const body = UpdatePhotoBody.safeParse(req.body);
        if (!id.success || !body.success) {
          res.status(400).json({ error: 'Invalid record or media id' });
          return;
        }
        const result = await appkit.lakebase.query(
          `UPDATE media_demo.records
           SET photo_media_id = $2, updated_at = NOW()
           WHERE id = $1
           RETURNING id, name, category, status, location, photo_media_id, updated_at`,
          [id.data, body.data.mediaId],
        );
        if (!result.rows[0]) {
          res.status(404).json({ error: 'Record not found' });
          return;
        }
        res.json(result.rows[0]);
      } catch (error) {
        console.error('[records] photo update failed', error);
        res.status(500).json({ error: 'Unable to update record photo' });
      }
    });
  });
}
