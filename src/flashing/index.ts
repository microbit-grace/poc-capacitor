import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";
import {
  isUniversalHex,
  microbitBoardId,
  separateUniversalHex,
} from "@microbit/microbit-universal-hex";
import {
  BluetoothInitializationResult,
  connectHandlingBond,
  Device,
  findMatchingDevice,
  initializeBluetooth,
} from "./bluetooth";
import { DeviceInformationService } from "./device-information-service";
import { fullFlash } from "./flashing-full";
import partialFlash, { PartialFlashResult } from "./flashing-partial";
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

    const deviceInformationService = new DeviceInformationService(device);
    const deviceVersion = await deviceInformationService.getDeviceVersion();
    device.log(`Detected device version as ${deviceVersion}`);

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
        return fullFlash(device, deviceVersion, appHex, progress);
      }
      default: {
        return FlashResult.Cancelled;
      }
    }
  } catch (e) {
    device.log("Failed to connect");
    device.error(e);
    return FlashResult.FailedToConnect;
  } finally {
    await device.disconnect();
  }
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
