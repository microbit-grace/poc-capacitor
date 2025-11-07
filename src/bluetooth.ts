import { BleClientInterface, BleDevice } from "@capacitor-community/bluetooth-le";

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
   * Connects with device.
   * 
   * @returns true if successful or false if unsuccessful.
   */
  connect(device: BleDevice): Promise<boolean>;
}
