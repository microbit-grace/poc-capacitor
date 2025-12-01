import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";
import {
  BluetoothInitializationResult,
  initializeBluetooth,
  findMatchingDevice,
  bondDevice,
  checkBondState,
  connectTimeoutInMs,
  disconnect,
} from "./bluetooth";
import { MICROBIT_DFU_SERVICE, MICROBIT_SECURE_DFU_SERVICE } from "./constants";
import { refreshServicesForV1IfDesiredServiceMissing } from "./flashing-v1";
import { createHexFileFromUniversal, hexStrToByte } from "./irmHexUtils";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { delay } from "../utils";
import partialFlash, { PartialFlashResult } from "./flashing-partial";
import { fullFlash } from "./flashing-full";

/**
 * High-level flashing flow.
 */
export async function flash(
  deviceName: string,
  hexStr: string,
  progress: Progress
) {
  const hex = hexStrToByte(hexStr);

  progress(FlashProgressStage.Initialize);
  const initialiseResult = await initializeBluetooth();
  switch (initialiseResult) {
    case BluetoothInitializationResult.BluetoothDisabled: {
      return FlashResult.BluetoothDisabled;
    }
    case BluetoothInitializationResult.MissingPermissions: {
      return FlashResult.MissingPermissions;
    }
    default: {
      break;
    }
  }

  progress(FlashProgressStage.FindDevice);
  const device = await findMatchingDevice(`BBC micro:bit [${deviceName}]`);
  if (!device) {
    return FlashResult.DeviceNotFound;
  }

  return flashDevice(device, hex, progress);
}

async function flashDevice(
  device: BleDevice,
  inputHex: Uint8Array,
  progress: Progress
): Promise<FlashResult> {
  const { deviceId } = device;
  progress(FlashProgressStage.Connecting);
  const bonded = await bondDevice(device);
  if (!bonded) {
    return FlashResult.FailedToConnect;
  }
  try {
    await BleClient.connect(
      device.deviceId,
      async (deviceId: string) => {
        console.log(`Disconnected with device id: ${deviceId}`);
      },
      { timeout: connectTimeoutInMs }
    );
  } catch (error) {
    console.error(error);
    return FlashResult.FailedToConnect;
  }

  try {
    // Taken from Nordic. See reasoning here: https://github.com/NordicSemiconductor/Android-DFU-Library/blob/e0ab213a369982ae9cf452b55783ba0bdc5a7916/dfu/src/main/java/no/nordicsemi/android/dfu/DfuBaseService.java#L888 */
    console.log(
      "Waiting for service changed notification before discovering services"
    );
    // We could short-circuit this by racing it with the GATT callback on
    // Android 12+ and the equivalent on iOS
    await delay(1600);

    await refreshServicesForV1IfDesiredServiceMissing(
      device.deviceId,
      MICROBIT_DFU_SERVICE
    );

    // The iOS app does this differently, via the device information service
    // Perhaps that would let us make a more positive V1 ID.
    const deviceVersion = await getDeviceVersion(device);
    console.log(`Detected device version as ${deviceVersion}`);

    const appHex = createHexFileFromUniversal(inputHex, deviceVersion);
    if (!appHex?.data) {
      return FlashResult.InvalidHex;
    }

    const partialFlashResult = await partialFlash(
      device,
      appHex.data,
      deviceVersion,
      progress
    );

    switch (partialFlashResult) {
      case PartialFlashResult.Success: {
        return FlashResult.Success;
      }
      case PartialFlashResult.Failed: {
        return FlashResult.PartialFlashFailed;
      }
      case PartialFlashResult.FailedToConnect: {
        return FlashResult.FailedToConnect;
      }
      case PartialFlashResult.InvalidHex: {
        return FlashResult.InvalidHex;
      }
      case PartialFlashResult.AttemptFullFlash: {
        const isBonded = await checkBondState(device);
        // TODO: This doesn't seem to work on V1, perhaps customise UI flow?
        if (deviceVersion === DeviceVersion.V1) {
          return FlashResult.PartialFlashFailed;
        }
        if (!isBonded) {
          // User opted not to pair when asked
          return FlashResult.Cancelled;
        }
        return fullFlash(device, deviceVersion, appHex.data, progress);
      }
      default: {
        return FlashResult.Cancelled;
      }
    }
  } catch (e) {
    console.error("Failed to Connect", e);
    return FlashResult.FailedToConnect;
  } finally {
    await disconnect(deviceId);
  }
}

async function getDeviceVersion(device: BleDevice) {
  // The iOS app does this differently, via the device information service
  // Perhaps that would let us make a more positive V1 ID.
  const services = await BleClient.getServices(device.deviceId);
  const dfuService = services.find(
    (s) => s.uuid === MICROBIT_SECURE_DFU_SERVICE
  );
  return dfuService ? DeviceVersion.V2 : DeviceVersion.V1;
}
