import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";
import { delay } from "../utils";
import {
  BluetoothInitializationResult,
  connectHandlingBond,
  findMatchingDevice,
  initializeBluetooth,
} from "./bluetooth";
import {
  DEVICE_INFORMATION_SERVICE,
  MODEL_NUMBER_CHARACTERISTIC,
} from "./constants";
import { fullFlash } from "./flashing-full";
import partialFlash, { PartialFlashResult } from "./flashing-partial";
import { createHexFileFromUniversal, hexStrToByte } from "./irmHexUtils";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";

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
  progress(FlashProgressStage.Connecting);
  const { deviceId } = device;
  const connected = await connectHandlingBond(deviceId);
  if (!connected) {
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
    await BleClient.discoverServices(deviceId);

    const deviceVersion = await getDeviceVersion(deviceId);
    console.log(`Detected device version as ${deviceVersion}`);

    const appHex = createHexFileFromUniversal(inputHex, deviceVersion);
    if (!appHex?.data) {
      return FlashResult.InvalidHex;
    }

    const partialFlashResult = await partialFlash(
      deviceId,
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
        // We can also end up here because of cancellation of pairing.
        // Can we detect this nicely?
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
    await BleClient.disconnect(deviceId);
  }
}

async function getDeviceVersion(deviceId: string): Promise<DeviceVersion> {
  // Read model number from Device Information Service to determine version
  const modelNumber = await BleClient.read(
    deviceId,
    DEVICE_INFORMATION_SERVICE,
    MODEL_NUMBER_CHARACTERISTIC
  );
  const decoder = new TextDecoder();
  const modelString = decoder.decode(modelNumber);
  console.log(`Model number from Device Information Service: ${modelString}`);
  if (modelString.includes("V2")) {
    return DeviceVersion.V2;
  }
  return DeviceVersion.V1;
}
