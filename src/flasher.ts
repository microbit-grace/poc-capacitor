import { BleDevice } from "@capacitor-community/bluetooth-le";
import { BluetoothDevice, BluetoothInitializationResult } from "./bluetooth";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";

const microbitSecureDFUServiceUuid = "0000fe59-0000-1000-8000-00805f9b34fb";

class Flasher {
  private bluetooth;
  constructor(bluetooth: BluetoothDevice) {
    this.bluetooth = bluetooth;
  }

  async flash(progress: Progress) {
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

    return this.flashDevice(device, progress);
  }

  private async flashDevice(device: BleDevice, progress: Progress) {
    progress(FlashProgressStage.Connecting);
    const bonded = await this.bluetooth.bond(device);
    if (!bonded) {
      return FlashResult.FailedToConnect;
    }
    const connected = await this.bluetooth.connect(device);
    if (!connected) {
      return FlashResult.FailedToConnect;
    }

    const deviceVersion = await this.getDeviceVersion(device);
    console.log(`Detected device version ${deviceVersion}`);
    return FlashResult.Success
  }

  private async getDeviceVersion(device: BleDevice) {
    const services = await this.bluetooth.client.getServices(device.deviceId);
    const dfuService = services.find(
      (s) => s.uuid === microbitSecureDFUServiceUuid
    );
    return dfuService ? DeviceVersion.V2 : DeviceVersion.V1;
  }
}

export default Flasher;
