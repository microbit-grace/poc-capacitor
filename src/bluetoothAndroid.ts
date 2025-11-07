import {
  BleClient,
  BleClientInterface,
  BleDevice,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import { BluetoothInitializationResult, BluetoothDevice } from "./bluetooth";

const scanningTimeoutInMs = 5000;
const bondingTimeoutInMs = 10_000;
const connectTimeoutInMs = 5000;

class BluetoothAndroid implements BluetoothDevice {
  client: BleClientInterface = BleClient;

  constructor() {}

  async initialize(): Promise<BluetoothInitializationResult> {
    // Check if location is enabled.
    if (Capacitor.getPlatform() === "android") {
      const isLocationEnabled = await BleClient.isLocationEnabled();
      if (!isLocationEnabled) {
        return BluetoothInitializationResult.MissingPermissions;
      }
    }
    await BleClient.initialize({ androidNeverForLocation: true });
    // Check if Bluetooth is enabled.
    const isBluetoothEnabled = await BleClient.isEnabled();
    if (!isBluetoothEnabled) {
      return BluetoothInitializationResult.BluetoothDisabled;
    }
    return BluetoothInitializationResult.Success;
  }

  private async checkBondedDevices(predicate: (device: BleDevice) => boolean) {
    const bondedDevices = await BleClient.getBondedDevices();
    const result = bondedDevices.find(predicate);
    console.log(
      result === null
        ? "No matching bonded device"
        : "Found matching bonded device"
    );
    return result;
  }

  async findMatchingDevice(namePrefix: string): Promise<BleDevice | undefined> {
    // Check for existing bonded devices.
    const bonded = await this.checkBondedDevices(
      getDevicePredicate(namePrefix)
    );
    if (bonded) {
      return bonded;
    }

    // Scan for matching device.
    const scanPromise: Promise<BleDevice> = new Promise((res) =>
      BleClient.requestLEScan({ namePrefix }, async (result) => {
        await BleClient.stopLEScan();
        res(result.device);
      })
    );
    const timeoutPromise: Promise<undefined> = new Promise((res) =>
      setTimeout(async () => {
        await BleClient.stopLEScan();
        res(undefined);
      }, scanningTimeoutInMs)
    );
    return await Promise.race([scanPromise, timeoutPromise]);
  }

  async bond(device: BleDevice): Promise<boolean> {
    try {
      const deviceId = device.deviceId;
      const isAlreadyBonded = await BleClient.isBonded(deviceId);
      if (isAlreadyBonded) {
        return true;
      }
      await BleClient.createBond(deviceId, { timeout: bondingTimeoutInMs });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  async connect(device: BleDevice): Promise<boolean> {
    try {
      const onDisconnected = (deviceId: string) => {
        console.log(`Disconnected with device id: ${deviceId}`);
      };
      await BleClient.connect(device.deviceId, onDisconnected, {
        timeout: connectTimeoutInMs,
      });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}

const getDevicePredicate = (namePrefix: string) => {
  return (device: BleDevice) => {
    const name = device.name;
    return !!name && name.startsWith(namePrefix);
  };
};

export default BluetoothAndroid;
