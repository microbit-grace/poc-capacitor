import { BleDevice } from "@capacitor-community/bluetooth-le";
import { DfuState, NordicDfu } from "capacitor-community-nordic-dfu";
import { DeviceVersion, FlashProgressStage, FlashResult, Progress } from "./model";
import { HexArrayBuffer, SizedHexData } from "./hexUtils";
import { Directory, Filesystem } from "@capacitor/filesystem";
import JSZip from "jszip";

class Dfu {
  constructor() {}

  async flash(
    device: BleDevice,
    deviceVersion: DeviceVersion,
    appBin: SizedHexData,
    initPacket: HexArrayBuffer,
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
    const error = await NordicDfu.startDFU({
      deviceName: device.name,
      deviceAddress: device.deviceId,
      filePath:
        deviceVersion === DeviceVersion.V1
          ? await this.createAppBinFile(appBin)
          : await this.createDfuZipFile(appBin, initPacket),
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
    })
    if (error) {
      console.log(`DFU Error: ${error.message}`)
      return FlashResult.FullFlashFailed
    }
    return FlashResult.Success;
  }

  private createDfuZipFile = async (
    appBin: SizedHexData,
    initPacket: HexArrayBuffer
  ): Promise<string> => {
    const zip = new JSZip();
    zip.file("application.dat", initPacket);
    zip.file("application.bin", appBin.data);

    const zipDataAsUint8Array = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    const path = "dfu.zip";
    const data = uint8ArrayToBase64(zipDataAsUint8Array);
    const directory = Directory.Cache;
    await Filesystem.writeFile({ path, data, directory });
    const stat = await Filesystem.stat({ directory, path });
    return stat.uri;
  };

  private createAppBinFile = async (appBin: SizedHexData): Promise<string> => {
    const path = "dfu-app-bin.bin";
    const data = uint8ArrayToBase64(appBin.data);
    const directory = Directory.Cache;
    await Filesystem.writeFile({ path, data, directory });
    const stat = await Filesystem.stat({ directory, path });
    return stat.uri;
  };
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
