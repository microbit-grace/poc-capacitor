import { BleClient, ScanResult } from "@capacitor-community/bluetooth-le";

export async function scan(
  onScanResult: (res: ScanResult) => void
): Promise<void> {
  try {
    await BleClient.initialize({ androidNeverForLocation: true });

    await BleClient.requestLEScan({}, onScanResult);

    setTimeout(async () => {
      await BleClient.stopLEScan();
      console.log("stopped scanning");
    }, 5000);
  } catch (error) {
    console.error(error);
  }
}
