import { BleDevice } from "@capacitor-community/bluetooth-le";
import { DfuState, NordicDfu } from "capacitor-community-nordic-dfu";
import {
  DeviceVersion,
  FlashProgressStage,
  FlashResult,
  Progress,
} from "./model";
import { SizedHexData } from "./irmHexUtils";
import { Directory, Filesystem, WriteFileOptions } from "@capacitor/filesystem";
import JSZip from "jszip";
import { Capacitor, PluginListenerHandle } from "@capacitor/core";

const appBinFilename = "application.bin";
const appDatFilename = "application.dat";
const manifestData = JSON.stringify({
  manifest: {
    application: {
      bin_file: appBinFilename,
      dat_file: appDatFilename,
    },
  },
});

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

async function createAppBinFile(appBin: SizedHexData): Promise<string> {
  return await writeCacheFile({
    path: "dfu-app-bin.bin",
    data: uint8ArrayToBase64(appBin.data),
  });
}

async function createDfuZipFile(
  appBin: SizedHexData,
  initPacket: Uint8Array
): Promise<string> {
  const zip = new JSZip();
  zip.file(appDatFilename, initPacket);
  zip.file(appBinFilename, appBin.data);
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
  appBin: SizedHexData,
  initPacket: Uint8Array
): Promise<{ uri: string; filename: string }> {
  if (deviceVersion === DeviceVersion.V1) {
    const uri = await createAppBinFile(appBin);
    return { uri, filename: "dfu-app-bin.bin" };
  }
  const uri = await createDfuZipFile(appBin, initPacket);
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
  device: BleDevice,
  deviceVersion: DeviceVersion,
  appBin: SizedHexData,
  initPacket: Uint8Array,
  progress: Progress
): Promise<FlashResult> {
  const { uri: filePath, filename } = await getFilePath(
    deviceVersion,
    appBin,
    initPacket
  );
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
        dfuOptions:
          Capacitor.getPlatform() === "android"
            ? {
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
              }
            : {},
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
