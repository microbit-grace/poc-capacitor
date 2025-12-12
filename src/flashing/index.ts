import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";
import {
  BluetoothInitializationResult,
  connectHandlingBond,
  Device,
  findMatchingDevice,
  initializeBluetooth,
} from "./bluetooth";
import {
  DEVICE_INFORMATION_SERVICE,
  MODEL_NUMBER_CHARACTERISTIC,
} from "./constants";
import { fullFlash } from "./flashing-full";
import partialFlash, { PartialFlashResult } from "./flashing-partial";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import {
  isUniversalHex,
  microbitBoardId,
  separateUniversalHex,
} from "@microbit/microbit-universal-hex";

/**
 * High-level flashing flow.
 */
export async function flash(
  deviceName: string,
  hexStr: string,
  progress: Progress
) {
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

  return flashDevice(device, hexStr, progress);
}

async function flashDevice(
  bleDevice: BleDevice,
  hexStr: string,
  progress: Progress
): Promise<FlashResult> {
  progress(FlashProgressStage.Connecting);
  const { deviceId, name } = bleDevice;
  const device = new Device(deviceId, name);
  const connected = await connectHandlingBond(device);
  if (!connected) {
    return FlashResult.FailedToConnect;
  }

  try {
    // Refresh services before using characteristics.
    await BleClient.discoverServices(deviceId);

    const deviceVersion = await getDeviceVersion(deviceId);
    console.log(`Detected device version as ${deviceVersion}`);

    const appHex = createHexFileFromUniversal(hexStr, deviceVersion);
    if (!appHex) {
      return FlashResult.InvalidHex;
    }

    const partialFlashResult = await partialFlash(device, appHex, progress);

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
        return fullFlash(device, deviceVersion, appHex, progress);
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

export const createHexFileFromUniversal = (
  hexStr: string,
  deviceVersion: DeviceVersion
): string | null => {
  try {
    if (isUniversalHex(hexStr)) {
      const parts = separateUniversalHex(hexStr);
      const boardId =
        deviceVersion === DeviceVersion.V1
          ? microbitBoardId.V1
          : microbitBoardId.V2;
      const separate = parts.find((p) => p.boardId === boardId);
      if (!separate) {
        return null;
      }
      return separate.hex;
    }
    return hexStr;
  } catch (e) {
    console.error(e);
    return null;
  }
};
