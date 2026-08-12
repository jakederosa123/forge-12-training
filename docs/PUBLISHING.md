# Publishing without a paid database

The folder `public/training-app/` is a standalone HTML, CSS, and JavaScript website. It has no server database and no required API key.

To put it on an existing website:

1. Upload every file inside `public/training-app/` to one public folder on your host.
2. Keep the filenames and folder relationships unchanged.
3. Make sure the host serves `index.html` for that folder.
4. Open the published page once while online so its offline cache can be installed.
5. Enter a test set, refresh the page, and confirm the entry remains.
6. Download a JSON backup from Settings.

The saved workout history stays on each visitor's browser and device. It does not synchronize between a phone and computer. Moving data between devices requires Download backup on the first device and Restore backup on the second.

For a local test before uploading:

```bash
npm run static
```

Then open `http://localhost:8080`.

