# POC Capacitor app

## Current status of what works

The tables below summarises what has been tested and the outcome.

✅ = Tested and works  
❌ = Implemented, but does not work  
❓ = Have not been implemented / tested

| Device platform | micro:bit version | Full flash | Partial flash                                  |
| --------------- | ----------------- | ---------- | ---------------------------------------------- |
| Android         | V1                | ❌         | ✅ (MakeCode project)<br />❓ (Python project) |
| Android         | V2                | ✅         | ✅ (MakeCode project)<br />❓ (Python project) |
| iOS             | V1                | ❓         | ❓ (MakeCode project)<br />❓ (Python project) |
| iOS             | V2                | ✅         | ✅ (MakeCode project)<br />❓ (Python project) |

## Running the app

> [!WARNING]  
> The app has not been tested on an iOS device. It may not run.

Clone repo and install dependencies.

```bash
git clone https://github.com/microbit-grace/poc-capacitor.git
cd poc-capacitor
npm i
```

Capacitor relies on a built version of the web app to create the mobile projects.
Build the project and then sync the mobile projects. You can run
`npx cap sync ios` too if you want to sync for iOS.

```bash
npm run build
npx cap sync android
```

Assuming you have Android Studio installed, open the project in Android studio
using the following command:

```bash
npx cap open android
```

Run the app via Android Studio. You will need to run it on a real mobile device
(not simulator) to test the Bluetooth and micro:bit flashing functionality.

## Known issues

### Full flashing is slow

An [issue](https://redirect.github.com/robsonos/nordic-dfu/issues/19) has been raised for the [capacitor-community-nordic-dfu plugin](https://github.com/robsonos/nordic-dfu). A workaround until the issue is resolved is to use a locally built version of the plugin.

Clone fork of the plugin repo, checkout the branch with the fix and build the plugin.

```
git clone https://github.com/microbit-grace/nordic-dfu/
cd nordic-dfu
git checkout remove-disabling-mtu
npm i
npm run build
```

Change directory back into poc-capacitor and install the local build of the plugin. Sync the changes. You can run `npx cap sync ios` too if you want to sync for iOS.

```
cd ../poc-capacitor
npm i ../nordic-dfu
npx cap sync android
```

Run the app.

### Other issues

- Connection is a bit flaky. Sometimes it would disconnect after connecting and before flashing starts.
- Text is not visible in dark mode.
