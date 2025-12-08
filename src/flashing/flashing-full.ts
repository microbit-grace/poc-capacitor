import {
  BleClient,
  BleDevice,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import MemoryMap from "nrf-intel-hex";
import { delay } from "../utils";
import {
  MICROBIT_DFU_CHARACTERISTIC,
  MICROBIT_DFU_SERVICE,
  NORDIC_DFU_SERVICE,
} from "./constants";
import { refreshServicesForV1IfDesiredServiceMissing } from "./flashing-v1";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { flashDfu } from "./nordic-dfu";

/**
 * Perform a full flash via Nordic's DFU service.
 *
 * The connection is closed before handing off to Nordic's service which will
 * connect again.
 *
 * The device is assumed to be bonded.
 */
export async function fullFlash(
  device: BleDevice,
  deviceVersion: DeviceVersion,
  appHex: string,
  progress: Progress
): Promise<FlashResult> {
  console.log("Full flash");
  progress(FlashProgressStage.Full);
  const { deviceId } = device;

  try {
    if (deviceVersion === DeviceVersion.V1) {
      const rebooted = await requestRebootToBootloaderV1Only(deviceId);
      if (!rebooted) {
        return FlashResult.FullFlashFailed;
      }
      await BleClient.disconnect(deviceId);
      await delay(500);
      await BleClient.connect(deviceId);

      await refreshServicesForV1IfDesiredServiceMissing(
        device.deviceId,
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
