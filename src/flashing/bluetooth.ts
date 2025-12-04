import {
  BleClient,
  BleDevice,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import BluetoothNotificationManager from "./bluetooth-notifications";
import {
  MICROBIT_RESET_COMMAND,
  MICROBIT_STATUS_COMMAND,
  PARTIAL_FLASHING_SERVICE,
  PARTIAL_FLASH_CHARACTERISTIC,
} from "./constants";
import { delay } from "../utils";

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

export const bondingTimeoutInMs = 40_000;
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

class Device {
  private tag: string | undefined;
  private disconnectTracker:
    | { promise: Promise<void>; onDisconnect: () => void }
    | undefined;
  constructor(private deviceId: string) {}
  async connect(tag: string) {
    this.tag = tag;
    let onDisconnect: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      onDisconnect = () => {
        this.log("Disconnected");
        notificationManager.disconnectedCleanup().then(resolve);
      };
    });
    this.disconnectTracker = { promise, onDisconnect: onDisconnect! };
    this.log("Connecting");
    await BleClient.connect(this.deviceId, onDisconnect, {
      timeout: connectTimeoutInMs,
    });
    this.log("Connected");
  }
  async waitForDisconnect(timeout: number): Promise<void> {
    if (!this.disconnectTracker) {
      this.log("Waiting for disconnect but not connected");
      return;
    }
    this.log(`Waiting for disconnect (timeout ${timeout})`);
    const result = await Promise.race([
      this.disconnectTracker.promise,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), timeout)),
    ]);
    if (result === "timeout") {
      this.log("Timeout waiting for disconnect");
      throw new Error("Timeout waiting for disconnect");
    }
  }
  log(message: string) {
    console.log(`[${this.tag}] ${message}`);
  }
}

/**
 * Bonds with device and handles the post-bond device state only returning
 * when we can reattempt a connection with the device.
 *
 * @returns true if successful or false if unsuccessful.
 */
export async function connectHandlingBond(deviceId: string): Promise<boolean> {
  const device = new Device(deviceId);
  const startTime = Date.now();
  try {
    await device.connect("initial");
    const maybeJustBonded = await bondDeviceInternal(deviceId);
    if (maybeJustBonded) {
      // If we did just bond then the device disconnects after 2_000 and then
      // resets after a further 13_000 In future we'd like a firmware change
      // that means it doesn't reset when partial flashing is in progress.
      device.log(isAndroid() ? "New bond" : "Potential new bond");
      try {
        await device.waitForDisconnect(3000);
      } catch (e) {
        if (!isAndroid()) {
          device.log("No disconnect after bond, assuming connection is stable");
          return true;
        }
        throw e;
      }

      await device.connect("post-bond pre-reset");
      // TODO: check this is needed, potentially inline into connect if always needed
      await delay(500);
      device.log("Resetting to pairing mode");
      await resetToMode(deviceId, MicroBitMode.Pairing);
      await device.waitForDisconnect(10_000);
      await device.connect("post-bond-dance");
      device.log(`Connection ready; took ${Date.now() - startTime}`);
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function bondDeviceInternal(deviceId: string): Promise<boolean> {
  if (!isAndroid()) {
    // Just do something that requires a bond on iOS.
    await getMicroBitStatus(deviceId);
    // On iOS we now have to assume we just bonded as we can't tell.
    return true;
  }
  if (await BleClient.isBonded(deviceId)) {
    return false;
  }
  await BleClient.createBond(deviceId, { timeout: bondingTimeoutInMs });
  return true;
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

export async function disconnect(deviceId: string): Promise<void> {
  await BleClient.disconnect(deviceId);
  await notificationManager.disconnectedCleanup();
}

export enum MicroBitMode {
  Pairing = 0x00,
  Application = 0x01,
}

export async function getMicroBitStatus(
  deviceId: string
): Promise<{ mode: MicroBitMode; version: number } | null> {
  const result = await characteristicWriteNotificationWait(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    numbersToDataView([MICROBIT_STATUS_COMMAND]),
    WriteType.NoResponse,
    MICROBIT_STATUS_COMMAND
  );

  if (!result.status || !result.value) {
    console.log("Failed to get micro:bit status response");
    return null;
  }

  // Response format: [0xEE, version, mode]
  const version = result.value[1];
  const mode = result.value[2] as MicroBitMode;
  return { version, mode };
}

export async function resetToMode(
  deviceId: string,
  mode: MicroBitMode
): Promise<void> {
  await BleClient.writeWithoutResponse(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    numbersToDataView([MICROBIT_RESET_COMMAND, mode])
  );
}
