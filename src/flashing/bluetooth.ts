import {
  BleClient,
  BleClientInterface,
  BleDevice,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import BluetoothConnection from "./bluetoothConnection";

export enum BluetoothInitializationResult {
  MissingPermissions = "MissingPermissions",
  BluetoothDisabled = "BluetoothDisabled",
  Success = "Success",
}

export interface BluetoothDevice {
  /**
   * BLE client.
   */
  client: BleClientInterface;

  /**
   * Initializes BLE.
   */
  initialize(): Promise<BluetoothInitializationResult>;

  /**
   * Finds device with specified name prefix.
   *
   * @returns device or undefined if none can be found.
   */
  findMatchingDevice(namePrefix: string): Promise<BleDevice | undefined>;

  /**
   * Bonds with device.
   *
   * @returns true if successful or false if unsuccessful.
   */
  bond(device: BleDevice): Promise<boolean>;

  /**
   * Check bond state with device.
   *
   * @returns true if bonded or false if not bonded.
   */
  checkBondState(device: BleDevice): Promise<boolean>;

  /**
   * Connects with device.
   *
   * @returns BluetoothConnection if successful, otherwise null.
   */
  connect(device: BleDevice): Promise<BluetoothConnection | null>;

  disconnect(deviceId: string): Promise<void>;
}

const bondingTimeoutInMs = 10_000;
const connectTimeoutInMs = 10_000;

class Bluetooth implements BluetoothDevice {
  client: BleClientInterface = BleClient;

  constructor() {}

  async initialize(): Promise<BluetoothInitializationResult> {
    // Check if location is enabled.
    if (isAndroid()) {
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
    if (!isAndroid()) {
      // Not supported.
      return undefined;
    }
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

    // TODO: Scan needs timing out.
    const scanPromise: Promise<BleDevice> = new Promise(
      (res) =>
        // This only resolves when we stop the scan.
        void BleClient.requestLEScan({ namePrefix }, async (result) => {
          await BleClient.stopLEScan();
          res(result.device);
        })
    );
    return await scanPromise;
  }

  async bond(device: BleDevice): Promise<boolean> {
    if (!isAndroid()) {
      // Handled by the OS.
      return true;
    }
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

  async checkBondState(device: BleDevice): Promise<boolean> {
    if (!isAndroid()) {
      // Handled by the OS.
      return true;
    }
    return BleClient.isBonded(device.deviceId);
  }

  async connect(device: BleDevice): Promise<BluetoothConnection | null> {
    try {
      const onDisconnected = (deviceId: string) => {
        console.log(`Disconnected with device id: ${deviceId}`);
      };
      await BleClient.connect(device.deviceId, onDisconnected, {
        timeout: connectTimeoutInMs,
      });
      return new BluetoothConnection(device);
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    await BleClient.disconnect(deviceId);
  }
}

const getDevicePredicate = (namePrefix: string) => {
  return (device: BleDevice) => {
    const name = device.name;
    return !!name && name.startsWith(namePrefix);
  };
};

const isAndroid = () => Capacitor.getPlatform() === "android";

export default Bluetooth;
