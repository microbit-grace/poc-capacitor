import { PluginListenerHandle } from "@capacitor/core";
import { Directory, Filesystem, WriteFileOptions } from "@capacitor/filesystem";
import { DfuState, NordicDfu } from "@microbit/capacitor-community-nordic-dfu";
import JSZip from "jszip";
import { Device } from "./bluetooth";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";

const appBinFilename = "application.bin";
const appDatFilename = "application.dat";

function uint8ArrayToBase64(uint8Array: Uint8Array): string {
  let binary = "";
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

async function writeCacheFile(options: Omit<WriteFileOptions, "directory">) {
  const directory = Directory.Cache;
  const { uri } = await Filesystem.writeFile({ directory, ...options });
  return uri;
}

async function createDfuZipFile(
  appBin: Uint8Array,
  deviceVersion: DeviceVersion
): Promise<string> {
  const manifest: { manifest: { application: Record<string, string> } } = {
    manifest: {
      application: {
        // Added below
      },
    },
  };

  const zip = new JSZip();
  if (deviceVersion == DeviceVersion.V2) {
    manifest.manifest.application.dat_file = appDatFilename;
    zip.file(appDatFilename, createInitPacket(appBin.length));
  }
  manifest.manifest.application.bin_file = appBinFilename;
  zip.file(appBinFilename, appBin);
  const manifestData = JSON.stringify(manifest);
  zip.file("manifest.json", manifestData);

  const zipDataAsUint8Array = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return await writeCacheFile({
    path: "dfu.zip",
    data: uint8ArrayToBase64(zipDataAsUint8Array),
  });
}

async function getFilePath(
  deviceVersion: DeviceVersion,
  appBin: Uint8Array
): Promise<{ uri: string; filename: string }> {
  if (deviceVersion === DeviceVersion.V1) {
    // const uri = await createAppBinFile(appBin);
    // return { uri, filename: "dfu-app-bin.bin" };
  }
  const uri = await createDfuZipFile(appBin, deviceVersion);
  return { uri, filename: "dfu.zip" };
}

async function cleanupTemporaryFile(filename: string): Promise<void> {
  try {
    await Filesystem.deleteFile({
      directory: Directory.Cache,
      path: filename,
    });
  } catch (error) {
    // File might not exist or already deleted, ignore errors
    console.log(`Could not delete temporary file ${filename}:`, error);
  }
}

export async function flashDfu(
  device: Device,
  deviceVersion: DeviceVersion,
  appBin: Uint8Array,
  progress: Progress
): Promise<FlashResult> {
  const { uri: filePath, filename } = await getFilePath(deviceVersion, appBin);
  let listener: PluginListenerHandle | undefined;
  try {
    // eslint-disable-next-line no-async-promise-executor
    return await new Promise(async (resolve) => {
      // Note this doesn't await the whole DFU process, just its initialization
      listener = await NordicDfu.addListener(
        "DFUStateChanged",
        ({ state, data }) => {
          switch (state) {
            case DfuState.DFU_COMPLETED: {
              resolve(FlashResult.Success);
              break;
            }
            case DfuState.DFU_ABORTED: {
              resolve(FlashResult.Cancelled);
              break;
            }
            case DfuState.DFU_PROGRESS: {
              progress(FlashProgressStage.Full, data.percent);
              break;
            }
            case DfuState.DFU_FAILED: {
              console.error(data);
              resolve(FlashResult.FullFlashFailed);
              break;
            }
            default: {
              console.log(`DFU state: ${state}`);
            }
          }
        }
      );
      const error = await NordicDfu.startDFU({
        deviceName: device.name,
        deviceAddress: device.deviceId,
        filePath,
        dfuOptions: {
          ...{
            [DeviceVersion.V1]: { forceDfu: true },
            [DeviceVersion.V2]: {
              unsafeExperimentalButtonlessServiceInSecureDfuEnabled: true,
              disableNotification: true,
              restoreBond: true,
            },
          }[deviceVersion],
          startAsForegroundService: false,
          keepBond: true,
          packetReceiptNotificationsEnabled: true,
        },
      });
      if (error) {
        console.log(`DFU Error: ${error.message}`);
        resolve(FlashResult.FullFlashFailed);
      }
      // Final resolution will come from listener callbacks.
    });
  } finally {
    await listener?.remove();
    await cleanupTemporaryFile(filename);
  }
}

const createInitPacket = (appSize: number): Uint8Array => {
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
};
