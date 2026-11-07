# Open the updated GQX Fit portal

The files in your existing `outputs/gqx-enquiries` folder have already been updated. Your `.env` and `data` folder were left untouched. The database migrates automatically when the new server starts; previous enquiries remain.

1. In the Command Prompt window where the app is running, press **Ctrl+C**.
2. Optional but recommended: while stopped, copy the entire `data` folder to a private backup location. Keep `.env` private too.
3. In the same project folder, run:

```cmd
npm.cmd start
```

4. Visit `http://localhost:3000` and press **Ctrl+F5** to load the updated page.
5. Visit `http://localhost:3000/admin` and sign in with your existing password.
6. Open **Clothing products → Add a product**. Enter name, description, INR price, discount percentage, comma-separated sizes and colours. Optionally add a direct HTTPS image URL and SKU.
7. Tick **Publish on the public portal**, then **Save product**. Refresh the public portal to see the item. Leave publication unticked to save a draft.
8. Submit test enquiries for each of your services. Confirm each one appears with its relevant details in the admin dashboard. Use the service/status filters and team notes to manage follow-ups.

If using the new ZIP on a different computer, extract it and create a fresh `.env` using `.env.example`. The ZIP deliberately contains no passwords or customer database. To move your existing enquiries, stop the old app and transfer its complete database files privately, or use the SQLite backup instructions in README.md. Never upload `.env` or `data` to GitHub.

Before public launch, replace the password and secrets you previously pasted into the chat. Generate new values locally and keep them out of messages and screenshots.
