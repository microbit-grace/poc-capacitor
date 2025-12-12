import MemoryMap from "nrf-intel-hex";
import { Device } from "./bluetooth";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { flashDfu } from "./nordic-dfu";
import {
  BleClient,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import { refreshServicesForV1IfDesiredServiceMissing } from "./flashing-v1";
import {
  MICROBIT_DFU_CHARACTERISTIC,
  MICROBIT_DFU_SERVICE,
  NORDIC_DFU_SERVICE,
} from "./constants";
import { delay } from "../utils";

/**
 * Perform a full flash via Nordic's DFU service.
 *
 * The connection is closed before handing off to Nordic's service which will
 * connect again.
 *
 * The device is assumed to be bonded.
 */
export async function fullFlash(
  device: Device,
  deviceVersion: DeviceVersion,
  appHex: string,
  progress: Progress
): Promise<FlashResult> {
  console.log("Full flash");
  progress(FlashProgressStage.Full);
  const { deviceId } = device;

  try {
    if (deviceVersion === DeviceVersion.V1) {
      const rebootRequested = await requestRebootToBootloaderV1Only(deviceId);
      if (!rebootRequested) {
        return FlashResult.FullFlashFailed;
      }

      // Wait for device to automatically disconnect as it reboots into bootloader
      device.log("Waiting for device to reboot and disconnect");
      try {
        await device.waitForDisconnect(3000);
      } catch {
        device.log(
          "Device did not disconnect automatically, disconnecting manually"
        );
        await BleClient.disconnect(deviceId);
      }

      // Give device time to disconnect and reboot into bootloader mode
      await delay(2500);

      // Reconnect to device now in bootloader mode
      await device.connect("bootloader-mode");
      await refreshServicesForV1IfDesiredServiceMissing(
        deviceId,
        NORDIC_DFU_SERVICE
      );
    }
  } finally {
    // The service opens its own connection.
    await BleClient.disconnect(deviceId);
  }

  const appBin = createAppBin(appHex, deviceVersion);
  if (appBin === null) {
    console.log("Invalid hex (app bin case)");
    return FlashResult.InvalidHex;
  }
  console.log(`Extracted app bin: ${appBin.length} bytes`);
  return flashDfu(device, deviceVersion, appBin, progress);
}

async function requestRebootToBootloaderV1Only(deviceId: string) {
  try {
    await BleClient.write(
      deviceId,
      MICROBIT_DFU_SERVICE,
      MICROBIT_DFU_CHARACTERISTIC,
      numbersToDataView([0x01])
    );
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

const createAppBin = (
  appHex: string,
  deviceVersion: DeviceVersion
): Uint8Array | null => {
  const memoryMap = MemoryMap.fromHex(appHex);

  const appRegionBoundaries = {
    [DeviceVersion.V1]: { start: 0x18000, end: 0x3c000 },
    [DeviceVersion.V2]: { start: 0x1c000, end: 0x77000 },
  }[deviceVersion];

  // Calculate data size within the app region
  let maxAddress = appRegionBoundaries.start;
  for (const [blockAddr, block] of memoryMap) {
    const blockEnd = blockAddr + block.length;
    if (
      blockEnd > appRegionBoundaries.start &&
      blockAddr < appRegionBoundaries.end
    ) {
      maxAddress = Math.max(
        maxAddress,
        Math.min(blockEnd, appRegionBoundaries.end)
      );
    }
  }

  let size = maxAddress - appRegionBoundaries.start;
  // 4-byte alignment required by DFU
  size = Math.ceil(size / 4) * 4;

  return memoryMap.slicePad(appRegionBoundaries.start, size);
};
