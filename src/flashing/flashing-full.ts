import {
  WriteType,
  characteristicWriteNotificationWait,
  cleanupCharacteristicNotifications,
  disconnect,
} from "./bluetooth";
import { createAppBin } from "./irmHexUtils";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { flashDfu } from "./nordic-dfu";
import { refreshServicesForV1IfDesiredServiceMissing } from "./flashing-v1";
import { delay } from "../utils";
import {
  MICROBIT_DFU_CHARACTERISTIC,
  MICROBIT_DFU_SERVICE,
  NORDIC_DFU_SERVICE,
} from "./constants";
import {
  BleClient,
  BleDevice,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";

/**
 * Perform a full flash via Nordic's DFU service.
 *
 * The connection is closed before handing off to Nordic's service which will
 * connect again.
 *
 * The device is assumed to be bonded.
 */
export async function fullFlash(
  device: BleDevice,
  deviceVersion: DeviceVersion,
  appHexData: Uint8Array,
  progress: Progress
): Promise<FlashResult> {
  console.log("Full flash");
  progress(FlashProgressStage.Full);

  try {
    if (deviceVersion === DeviceVersion.V1) {
      const rebooted = await requestRebootToBootloaderV1Only(device.deviceId);
      if (!rebooted) {
        return FlashResult.FullFlashFailed;
      }
      await disconnect(device.deviceId);
      await delay(500);
      await BleClient.connect(device.deviceId);

      await refreshServicesForV1IfDesiredServiceMissing(
        device.deviceId,
        NORDIC_DFU_SERVICE
      );
    }
  } finally {
    // The service opens its own connection.
    await disconnect(device.deviceId);
  }

  const appBin = createAppBin(appHexData, deviceVersion);
  if (appBin === null) {
    console.log("Invalid hex (app bin case)");
    return FlashResult.InvalidHex;
  }
  console.log("Extracted app bin");
  const initPacket = createInitPacketAppDatFile(appBin.size);
  return flashDfu(device, deviceVersion, appBin, initPacket, progress);
}

function createInitPacketAppDatFile(appSize: number): Uint8Array {
  //typedef struct {
  //    uint8_t  magic[12];                 // identify this struct "microbit_app"
  //    uint32_t version;                   // version of this struct == 1
  //    uint32_t app_size;                  // only used for DFU_FW_TYPE_APPLICATION
  //    uint32_t hash_size;                 // 32 => DFU_HASH_TYPE_SHA256 or zero to bypass hash check
  //    uint8_t  hash_bytes[32];            // hash of whole DFU download
  //} microbit_dfu_app_t;
  const magic = "microbit_app";
  const version = 1;
  const hashSize = 0;
  const hash = new Uint8Array(32).fill(0);

  const buffer = new ArrayBuffer(12 + 4 + 4 + 4 + 32); // total: 56 bytes
  const view = new DataView(buffer);
  const uint8View = new Uint8Array(buffer);

  let offset = 0;

  // Write magic string (12 bytes)
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(magic);
  uint8View.set(magicBytes, offset);
  offset += 12;

  // Write version (4 bytes, little-endian)
  view.setUint32(offset, version, true);
  offset += 4;

  // Write appSize (4 bytes, little-endian)
  view.setUint32(offset, appSize, true);
  offset += 4;

  // Write hashSize (4 bytes, little-endian)
  view.setUint32(offset, hashSize, true);
  offset += 4;

  // Write hash (32 bytes)
  uint8View.set(hash, offset);

  return uint8View;
}

async function requestRebootToBootloaderV1Only(deviceId: string) {
  const { status } = await characteristicWriteNotificationWait(
    deviceId,
    MICROBIT_DFU_SERVICE,
    MICROBIT_DFU_CHARACTERISTIC,
    numbersToDataView([0x01]),
    WriteType.Default
  );
  // TODO: correct to just log this?
  console.log(`Request DFU result ${status}`);

  await cleanupCharacteristicNotifications(
    deviceId,
    MICROBIT_DFU_SERVICE,
    MICROBIT_DFU_CHARACTERISTIC
  );
  return true;
}
