import { BleDevice } from "@capacitor-community/bluetooth-le";
import { BluetoothDevice, BluetoothInitializationResult } from "./bluetooth";
import {
  MICROBIT_DFU_SERVICE,
  MICROBIT_SECURE_DFU_SERVICE,
} from "./flashingConstants";
import { refreshServicesForV1IfDesiredServiceMissing } from "./flashingV1";
import FullFlasher from "./flashingFull";
import { createHexFileFromUniversal, hexStrToByte } from "./irmHexUtils";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { delay } from "../utils";
import partialFlash, { PartialFlashResult } from "./flashingPartial";

class Flasher {
  private bluetooth;
  private fullFlasher;
  constructor(bluetooth: BluetoothDevice, fullFlasher: FullFlasher) {
    this.bluetooth = bluetooth;
    this.fullFlasher = fullFlasher;
  }

  /**
   * High-level flashing flow.
   * TODO: Add device name as prop and use it for findMatchingDevice.
   */
  async flash(hexStr: string, progress: Progress) {
    const hex = hexStrToByte(hexStr);

    progress(FlashProgressStage.Initialize);
    const initialiseResult = await this.bluetooth.initialize();
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
    const device = await this.bluetooth.findMatchingDevice("BBC micro:bit");
    if (!device) {
      return FlashResult.DeviceNotFound;
    }

    return this.flashDevice(device, hex, progress);
  }

  private async flashDevice(
    device: BleDevice,
    inputHex: Uint8Array,
    progress: Progress
  ): Promise<FlashResult> {
    progress(FlashProgressStage.Connecting);
    const bonded = await this.bluetooth.bond(device);
    if (!bonded) {
      return FlashResult.FailedToConnect;
    }
    const connection = await this.bluetooth.connect(device);
    if (connection === null) {
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
        connection,
        MICROBIT_DFU_SERVICE
      );

      // The iOS app does this differently, via the device information service
      // Perhaps that would let us make a more positive V1 ID.
      const deviceVersion = await this.getDeviceVersion(device);
      console.log(`Detected device version as ${deviceVersion}`);

      const appHex = createHexFileFromUniversal(inputHex, deviceVersion);
      if (!appHex?.data) {
        return FlashResult.InvalidHex;
      }

      const partialFlashResult = await partialFlash(
        connection,
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
          const isBonded = await this.bluetooth.checkBondState(device);
          // TODO: This doesn't seem to work on V1, perhaps customise UI flow?
          if (deviceVersion === DeviceVersion.V1) {
            return FlashResult.PartialFlashFailed;
          }
          if (!isBonded) {
            // User opted not to pair when asked
            return FlashResult.Cancelled;
          }
          return this.fullFlasher.fullFlash(
            connection,
            deviceVersion,
            appHex.data,
            progress
          );
        }
        default: {
          return FlashResult.Cancelled;
        }
      }
    } finally {
      await connection.disconnect();
    }
  }

  private async getDeviceVersion(device: BleDevice) {
    // The iOS app does this differently, via the device information service
    // Perhaps that would let us make a more positive V1 ID.
    const services = await this.bluetooth.client.getServices(device.deviceId);
    const dfuService = services.find(
      (s) => s.uuid === MICROBIT_SECURE_DFU_SERVICE
    );
    return dfuService ? DeviceVersion.V2 : DeviceVersion.V1;
  }
}

export default Flasher;
