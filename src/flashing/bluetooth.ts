import {
  BleClient,
  BleDevice,
  TimeoutOptions,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import {
  PARTIAL_FLASHING_SERVICE,
  PARTIAL_FLASH_CHARACTERISTIC,
} from "./constants";
import { delay } from "../utils";
import {
  MicroBitMode,
  PartialFlashingService,
} from "./partial-flashing-service";

export enum BluetoothInitializationResult {
  MissingPermissions = "MissingPermissions",
  BluetoothDisabled = "BluetoothDisabled",
  Success = "Success",
}

export enum WriteType {
  NoResponse = "NoResponse",
  Default = "Default",
}

export const bondingTimeoutInMs = 40_000;
export const connectTimeoutInMs = 10_000;
const scanningTimeoutInMs = 10_000;

const isAndroid = () => Capacitor.getPlatform() === "android";

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

  console.log(`Scanning for device - ${namePrefix}`);
  const scanPromise: Promise<BleDevice> = new Promise(
    (res) =>
      // This only resolves when we stop the scan.
      void BleClient.requestLEScan({ namePrefix }, async (result) => {
        await BleClient.stopLEScan();
        res(result.device);
      })
  );
  const scanTimeoutPromise: Promise<undefined> = new Promise((resolve) =>
    setTimeout(async () => {
      await BleClient.stopLEScan();
      console.log("Timeout scanning for device");
      resolve(undefined);
    }, scanningTimeoutInMs)
  );
  return await Promise.race([scanPromise, scanTimeoutPromise]);
}

export class Device {
  private tag: string | undefined;
  private disconnectTracker:
    | { promise: Promise<void>; onDisconnect: () => void }
    | undefined;
  private notificationListeners = new Map<
    string,
    Set<(data: Uint8Array) => void>
  >();

  constructor(public deviceId: string) {}

  async connect(tag: string) {
    this.tag = tag;
    let onDisconnect: (() => void) | undefined;
    const promise = new Promise<void>((resolve) => {
      onDisconnect = () => {
        this.log("Disconnected");
        this.notificationListeners = new Map();
        resolve();
      };
    });
    this.disconnectTracker = { promise, onDisconnect: onDisconnect! };
    this.log("Connecting");
    await BleClient.connect(this.deviceId, onDisconnect, {
      timeout: connectTimeoutInMs,
    });
    this.log("Connected");
  }

  async startNotifications(
    serviceId: string,
    characteristicId: string,
    options?: TimeoutOptions
  ): Promise<void> {
    const key = this.getNotificationKey(serviceId, characteristicId);
    await BleClient.startNotifications(
      this.deviceId,
      serviceId,
      characteristicId,
      (value: DataView) => {
        const bytes = new Uint8Array(value.buffer);
        // Notify all registered callbacks.
        this.notificationListeners.get(key)?.forEach((cb) => cb(bytes));
      },
      options
    );
  }

  private subscribe(
    serviceId: string,
    characteristicId: string,
    callback: (data: Uint8Array) => void
  ): void {
    const key = this.getNotificationKey(serviceId, characteristicId);
    if (!this.notificationListeners.has(key)) {
      this.notificationListeners.set(key, new Set());
    }
    this.notificationListeners.get(key)!.add(callback);
  }

  private unsubscribe(
    serviceId: string,
    characteristicId: string,
    callback: (data: Uint8Array) => void
  ): void {
    const key = this.getNotificationKey(serviceId, characteristicId);
    this.notificationListeners.get(key)?.delete(callback);
  }

  async stopNotifications(
    serviceId: string,
    characteristicId: string
  ): Promise<void> {
    await BleClient.stopNotifications(
      this.deviceId,
      serviceId,
      characteristicId
    );
    const key = this.getNotificationKey(serviceId, characteristicId);
    this.notificationListeners.delete(key);
  }

  /**
   * Write to characteristic and wait for a notification response.
   *
   * It is the responsibility of the caller to have started notifications
   * for the characteristic.
   */
  async writeForNotification(
    serviceId: string,
    characteristicId: string,
    value: DataView,
    writeType: WriteType,
    notificationId: number,
    isFinalNotification: (p: Uint8Array) => boolean = () => true
  ): Promise<Uint8Array> {
    let notificationListener: ((bytes: Uint8Array) => void) | undefined;
    const notificationPromise = new Promise<Uint8Array>((resolve) => {
      notificationListener = (bytes: Uint8Array) => {
        if (bytes[0] === notificationId && isFinalNotification(bytes)) {
          resolve(bytes);
        }
      };
      this.subscribe(serviceId, characteristicId, notificationListener);
    });

    try {
      if (writeType === WriteType.Default) {
        await BleClient.write(
          this.deviceId,
          serviceId,
          characteristicId,
          value
        );
      } else {
        await BleClient.writeWithoutResponse(
          this.deviceId,
          serviceId,
          characteristicId,
          value
        );
      }
      return await notificationPromise;
    } finally {
      if (notificationListener) {
        this.unsubscribe(serviceId, characteristicId, notificationListener);
      }
    }
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

  error(e: unknown) {
    console.error(e);
  }

  private getNotificationKey(
    serviceId: string,
    characteristicId: string
  ): string {
    return `${serviceId}:${characteristicId}`;
  }
}

/**
 * Bonds with device and handles the post-bond device state only returning
 * when we can reattempt a connection with the device.
 *
 * @returns true if successful or false if unsuccessful.
 */
export async function connectHandlingBond(device: Device): Promise<boolean> {
  const startTime = Date.now();
  try {
    const maybeJustBonded = await bondConnectDeviceInternal(device);
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
      const pf = new PartialFlashingService(device);
      await pf.resetToMode(MicroBitMode.Pairing);
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

async function bondConnectDeviceInternal(device: Device): Promise<boolean> {
  const { deviceId } = device;
  if (isAndroid()) {
    let justBonded = false;
    // This gets us a nicer pairing dialog than just going straight for the characteristic.
    if (!(await BleClient.isBonded(deviceId))) {
      await BleClient.createBond(deviceId, { timeout: bondingTimeoutInMs });
      justBonded = true;
    }
    await device.connect("initial");
    return justBonded;
  } else {
    // Long timeout as this is the point that the pairing dialog will show.
    // If this responds very quickly maybe we could assume there was a bond?
    // At the moment we always do the disconnect dance so subsequent code will
    // need to call startNotifications again. We need to be connected to
    // startNotifications.
    await device.connect("initial");
    await device.startNotifications(
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      { timeout: bondingTimeoutInMs }
    );
    return true;
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
