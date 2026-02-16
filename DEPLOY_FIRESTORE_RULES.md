# Fix "Missing or insufficient permissions" for store catalog

The store page and catalog write need **Firestore security rules** to be deployed. Your local `firestore.rules` file includes them, but they only take effect after you deploy.

## Deploy the rules (required once)

In a terminal, from the project folder:

```bash
npm run deploy:rules
```

Or directly:

```bash
firebase deploy --only firestore:rules
```

You must be logged in (`firebase login`) and the project must be set (`firebase use <project-id>` if you have multiple).

After this, the store catalog read (store page) and write (admin panel) should work.
