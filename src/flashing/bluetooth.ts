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

/**
 * Wait for a disconnect event to fire with timeout.
 *
 * @param disconnectedRef Object with boolean flag that gets set to true on disconnect
 * @param timeoutMs Maximum time to wait in milliseconds
 * @param description Description for error messages
 * @returns Promise that resolves when disconnected or rejects on timeout
 */
async function waitForDisconnect(
  disconnectedRef: { current: boolean },
  timeoutMs: number,
  description: string
): Promise<void> {
  const startTime = Date.now();
  while (!disconnectedRef.current && Date.now() - startTime < timeoutMs) {
    await delay(100);
  }
  if (!disconnectedRef.current) {
    throw new Error(
      `Timeout waiting for disconnect (${description}) after ${timeoutMs}ms`
    );
  }
  const elapsed = Date.now() - startTime;
  console.log(`Disconnect confirmed after ${elapsed}ms (${description})`);
}

/**
 * Bonds with device and handles the post-bond device state only returning
 * when we can reattempt a connection with the device.
 *
 * @returns true if successful or false if unsuccessful.
 */
export async function connectHandlingBond(device: BleDevice): Promise<boolean> {
  try {
    const disconnectedPreBondDance = { current: false };
    await BleClient.connect(device.deviceId, () => {
      console.log("Disconnected from pre-bond-dance connection");
      disconnectedPreBondDance.current = true;
    });

    const maybeJustBonded = await bondDeviceInternal(device);
    if (maybeJustBonded) {
      console.log("Potential new bond. Waiting for disconnect...");

      try {
        await waitForDisconnect(
          disconnectedPreBondDance,
          5000,
          "post-bond automatic disconnect"
        );
      } catch (e) {
        // At this point on iOS we could return.
        if (!isAndroid()) {
          console.log(
            "iOS: No disconnect after bond, assuming connection is stable"
          );
          return true;
        }
        throw e;
      }

      console.log("Reconnecting after post-bond disconnect");
      const disconnectedPostBondPreReset = { current: false };
      await BleClient.connect(device.deviceId, () => {
        console.log("Disconnected from post-bond, pre-reset connection");
        disconnectedPostBondPreReset.current = true;
      });

      await delay(500);
      console.log("Resetting to pairing mode");
      await resetToMode(device.deviceId, MicroBitMode.Pairing);
      await waitForDisconnect(
        disconnectedPostBondPreReset,
        10000,
        "post-reset disconnect"
      );

      console.log("Reconnecting after reset to pairing mode");
      await BleClient.connect(device.deviceId, () => {
        console.log("Disconnected from post-bond-dance connection");
      });
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function bondDeviceInternal(device: BleDevice): Promise<boolean> {
  if (!isAndroid()) {
    // Just do something that requires a bond on iOS.
    await getMicroBitStatus(device.deviceId);
    // On iOS we now have to assume we just bonded as we can't tell.
    return true;
  }
  const { deviceId } = device;
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
  await notificationManager.cleanupAll();
  await BleClient.disconnect(deviceId);
}

export enum MicroBitMode {
  Pairing = 0x00,
  Application = 0x01,
}

export async function getMicroBitStatus(
  deviceId: string
): Promise<{ mode: MicroBitMode; version: number } | null> {
  console.log("Querying micro:bit status...");
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

  console.log(
    `Micro:bit status - Version: ${version}, Mode: ${
      mode === MicroBitMode.Pairing ? "PAIRING" : "APPLICATION"
    }`
  );
  return { version, mode };
}

export async function resetToMode(
  deviceId: string,
  mode: MicroBitMode
): Promise<void> {
  console.log(
    `Sending MICROBIT_RESET command (mode=${
      mode === MicroBitMode.Pairing ? "PAIRING" : "APPLICATION"
    })`
  );
  await BleClient.writeWithoutResponse(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    numbersToDataView([MICROBIT_RESET_COMMAND, mode])
  );
}
