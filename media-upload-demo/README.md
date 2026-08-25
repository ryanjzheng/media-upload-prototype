# Media Upload Demo

Consumer AppKit 0.58.0 application for `media-upload-plugin`. The runnable app is this directory (not a nested scaffold).
The dependency is the locally packed `media-upload-plugin-0.2.1.tgz`, so the app source remains deployable without copying plugin implementation into the demo.

Infrastructure is pinned in `databricks.yml`:

- Profile for commands: your Databricks CLI profile
- Volume: `/Volumes/your_catalog/your_schema/your_volume` (set `files_id` variable in `databricks.yml`)
- Lakebase branch: `projects/media-upload-demo/branches/production`
- Database: `projects/media-upload-demo/branches/production/databases/databricks-postgres`

Local build gates:

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Deployment is intentionally not performed here. The app service principal must initialize `media` and `media_demo` schemas on its first deployed startup. End users need `READ VOLUME` and `WRITE VOLUME` on the managed volume because file operations use AppKit Files OBO.
