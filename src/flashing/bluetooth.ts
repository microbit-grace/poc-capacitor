import { BleClient, BleDevice } from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import BluetoothNotificationManager from "./bluetooth-notifications";

export enum BluetoothInitializationResult {
  MissingPermissions = "MissingPermissions",
  BluetoothDisabled = "BluetoothDisabled",
  Success = "Success",
}

export enum WriteType {
  NoResponse = "NoResponse",
  Default = "Default",
}

export type BluetoothResult = {
  status: boolean;
  value: Uint8Array | null;
};

export const bondingTimeoutInMs = 10_000;
export const connectTimeoutInMs = 10_000;

const isAndroid = () => Capacitor.getPlatform() === "android";
const notificationManager = new BluetoothNotificationManager();
/**
 * Initializes BLE.
 */
export async function initializeBluetooth(): Promise<BluetoothInitializationResult> {
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

async function checkBondedDevices(predicate: (device: BleDevice) => boolean) {
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

/**
 * Finds device with specified name prefix.
 *
 * @returns device or undefined if none can be found.
 */
export async function findMatchingDevice(
  namePrefix: string
): Promise<BleDevice | undefined> {
  // Check for existing bonded devices.
  const bonded = await checkBondedDevices((device: BleDevice) => {
    const name = device.name;
    return !!name && name.startsWith(namePrefix);
  });
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

/**
 * Bonds with device.
 *
 * @returns true if successful or false if unsuccessful.
 */
export async function bondDevice(device: BleDevice): Promise<boolean> {
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

/**
 * Check bond state with device.
 *
 * @returns true if bonded or false if not bonded.
 */
export async function checkBondState(device: BleDevice): Promise<boolean> {
  if (!isAndroid()) {
    // Handled by the OS.
    return true;
  }
  return BleClient.isBonded(device.deviceId);
}

/**
 * Write to characteristic and wait for notification response.
 */
export async function characteristicWriteNotificationWait(
  deviceId: string,
  serviceId: string,
  characteristicId: string,
  value: DataView,
  writeType: WriteType,
  notificationId: number | null = null,
  isFinalNotification: (p: Uint8Array) => boolean = () => true
): Promise<BluetoothResult> {
  let notificationPromise: Promise<Uint8Array> | null = null;
  let notificationListener: ((data: Uint8Array) => void) | null = null;

  if (notificationId !== null) {
    notificationPromise = new Promise<Uint8Array>((resolve, reject) => {
      notificationListener = (bytes: Uint8Array) => {
        if (bytes[0] === notificationId && isFinalNotification(bytes)) {
          resolve(bytes);
        }
      };

      notificationManager
        .subscribe(deviceId, serviceId, characteristicId, notificationListener)
        .catch(reject);
    });
  }

  try {
    if (writeType === WriteType.Default) {
      await BleClient.write(deviceId, serviceId, characteristicId, value);
    } else {
      await BleClient.writeWithoutResponse(
        deviceId,
        serviceId,
        characteristicId,
        value
      );
    }

    // Wait for notification if expected
    const notificationValue = notificationPromise
      ? await notificationPromise
      : null;
    return { status: true, value: notificationValue };
  } catch (error) {
    console.error("Write or notification failed:", error);
    return { status: false, value: null };
  } finally {
    if (notificationId !== null && notificationListener) {
      notificationManager.unsubscribe(
        deviceId,
        serviceId,
        characteristicId,
        notificationListener
      );
    }
  }
}

export async function cleanupCharacteristicNotifications(
  deviceId: string,
  serviceId: string,
  characteristicId: string
): Promise<void> {
  await notificationManager.cleanup(deviceId, serviceId, characteristicId);
}
