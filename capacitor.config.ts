import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "apps.poc.capacitor",
  appName: "poc-capacitor",
  webDir: "dist",
  plugins: {
    BluetoothLe: {
      displayStrings: {
        scanning: "Scanning...",
        cancel: "Cancel",
        availableDevices: "Available devices",
        noDeviceFound: "No device found",
      },
    },
    StatusBar: {
      style: "Light",
      backgroundColor: "#000000",
      overlaysWebView: false,
    },
  },
};

export default config;
