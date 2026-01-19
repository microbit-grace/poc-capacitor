# POC Capacitor app

## Running the app

Clone repo and install dependencies.

```bash
git clone https://github.com/microbit-grace/poc-capacitor.git
cd poc-capacitor
npm i
```

Capacitor relies on a built version of the web app to create the mobile projects.
Build the project, sync the mobile projects, and then run the server:

```bash
npm run build
npx cap sync
npm run dev
```

Use e.g. `npx cap open ios` to open the IDE and run from there.

The vite dev server run by dev:apps will be running inside the app.
