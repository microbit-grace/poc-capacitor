import {
  BleClient,
  BleDevice,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import { Capacitor } from "@capacitor/core";
import { delay } from "../utils";
import BluetoothNotificationManager from "./bluetooth-notifications";
import {
  PARTIAL_FLASH_CHARACTERISTIC,
  PARTIAL_FLASHING_SERVICE,
} from "./constants";

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
const isIos = () => Capacitor.getPlatform() === "ios";
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

export async function disconnect(deviceId: string): Promise<void> {
  await notificationManager.cleanupAll();
  await BleClient.disconnect(deviceId);
}

export async function connect(deviceId: string) {
  // Wait ~2s for disconnect. This occurs when pairing with micro:bit the first
  // time. micro:bit disconnects as it shows tick icon.
  const connectThenMaybeDisconnect = new Promise<boolean>((resolve, reject) => {
    const onDisconnect = (id: string) => {
      console.log(`Disconnected with device id: ${id}`);
      resolve(false);
    };
    BleClient.connect(deviceId, onDisconnect, {
      timeout: connectTimeoutInMs,
    })
      .then(async () => {
        // For iOS, connect promise resolves even when user has not interacted
        // with the pairing dialog so we need to manually check and implement
        // connect timeout.
        if (isIos()) {
          const bonded = await pollingCheckIsIosBonded(
            deviceId,
            connectTimeoutInMs
          );
          if (!bonded) {
            reject("Connection timeout");
          }
        }
        // Wait for disconnect, otherwise assume that disconnect will not occur.
        await delay(3000);
        resolve(true);
      })
      .catch(reject);
  });

  const connected = await connectThenMaybeDisconnect;

  if (!connected) {
    console.log("Attempt reconnect");
    await BleClient.connect(
      deviceId,
      (id: string) => console.log(`Disconnected with device id: ${id}`),
      { timeout: 12_000 }
    );

    // Reset micro:bit so that there is sufficient time available for micro:bit
    // to partial flash without it auto-resetting.
    console.log("Reset micro:bit");
    await BleClient.writeWithoutResponse(
      deviceId,
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      numbersToDataView([0xff])
    );
    // Wait for reboot.
    await delay(2000);

    await BleClient.connect(
      deviceId,
      (id: string) => console.log(`Disconnected with device id: ${id}`),
      { timeout: 12_000 }
    );
  }
}

async function pollingCheckIsIosBonded(
  deviceId: string,
  timeoutInMs: number
): Promise<boolean> {
  const startMs = Date.now();
  while (Date.now() - startMs < timeoutInMs) {
    // Check if connected by seeing if subscribe works.
    if (await checkIsIosBonded(deviceId)) {
      return true;
    }
    // Delay to not check so frequently.
    await delay(2);
  }
  return await checkIsIosBonded(deviceId);
}

/**
 * Check if device is bonded when using iOS.
 * There is no callback for whether bonding is successful, so we test if
 * notification can be set successfully as an indicator.
 *
 * See https://stackoverflow.com/questions/27836416/corebluetooth-pairing-feedback-callback.
 * @param deviceId
 * @returns true if device is bonded, otherwise returns false.
 */
async function checkIsIosBonded(deviceId: string): Promise<boolean> {
  try {
    const callback = () => {};
    await notificationManager.subscribe(
      deviceId,
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      callback
    );
    await notificationManager.cleanup(
      deviceId,
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC
    );
    return true;
  } catch (err) {
    console.log("Not bonded yet", err);
    return false;
  }
}
