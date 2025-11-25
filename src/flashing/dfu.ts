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
import { Capacitor } from "@capacitor/core";

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
class Dfu {
  constructor() {}

  async flash(
    device: BleDevice,
    deviceVersion: DeviceVersion,
    appBin: SizedHexData,
    initPacket: Uint8Array,
    progress: Progress
  ): Promise<FlashResult> {
    NordicDfu.addListener("DFUStateChanged", ({ state, data }) => {
      switch (state) {
        case DfuState.DFU_COMPLETED: {
          progress(FlashProgressStage.Complete);
          break;
        }
        case DfuState.DFU_ABORTED: {
          progress(FlashProgressStage.Cancelled);
          break;
        }
        case DfuState.DFU_PROGRESS: {
          progress(FlashProgressStage.Full, data.percent);
          break;
        }
        case DfuState.DFU_FAILED: {
          progress(FlashProgressStage.Failed);
          break;
        }
        default: {
          console.log(`DFU state: ${state}`);
        }
      }
    });
    const filePath = await this.getFilePath(deviceVersion, appBin, initPacket);
    const error = await NordicDfu.startDFU({
      deviceName: device.name,
      deviceAddress: device.deviceId,
      filePath: filePath,
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
      return FlashResult.FullFlashFailed;
    }
    return FlashResult.Success;
  }

  private getFilePath = async (
    deviceVersion: DeviceVersion,
    appBin: SizedHexData,
    initPacket: Uint8Array
  ) => {
    if (deviceVersion === DeviceVersion.V1) {
      return await this.createAppBinFile(appBin);
    }
    return await this.createDfuZipFile(appBin, initPacket);
  };

  private createDfuZipFile = async (
    appBin: SizedHexData,
    initPacket: Uint8Array
  ): Promise<string> => {
    const zip = new JSZip();
    zip.file(appDatFilename, initPacket);
    zip.file(appBinFilename, appBin.data);
    zip.file("manifest.json", manifestData);

    const zipDataAsUint8Array = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    const stat = await this.writeCacheFile({
      path: "dfu.zip",
      data: uint8ArrayToBase64(zipDataAsUint8Array),
    });
    return stat.uri;
  };

  private async createAppBinFile(appBin: SizedHexData): Promise<string> {
    const stat = await this.writeCacheFile({
      path: "dfu-app-bin.bin",
      data: uint8ArrayToBase64(appBin.data),
    });
    return stat.uri;
  }

  private async writeCacheFile(options: Omit<WriteFileOptions, "directory">) {
    await Filesystem.writeFile({ directory: Directory.Cache, ...options });
    const stat = await Filesystem.stat({
      directory: Directory.Cache,
      path: options.path,
    });
    return stat;
  }
}

const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
  let binary = "";
  const len = uint8Array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
};

export default Dfu;
