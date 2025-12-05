import MemoryMap from "nrf-intel-hex";
import { delay } from "../utils";
import { Device } from "./bluetooth";
import {
  PARTIAL_FLASH_CHARACTERISTIC,
  PARTIAL_FLASHING_SERVICE,
} from "./constants";
import { DeviceVersion, FlashProgressStage, Progress } from "./model";
import {
  PartialFlashingService,
  WriteFlashResult,
} from "./partial-flashing-service";

export enum PartialFlashResult {
  Success = "Success",
  InvalidHex = "InvalidHex",
  Failed = "Failed",
  AttemptFullFlash = "AttemptFullFlash",
  FailedToConnect = "FailedToConnect",
}

const partialFlash = async (
  device: Device,
  appHex: string,
  deviceVersion: DeviceVersion,
  progress: Progress
): Promise<PartialFlashResult> => {
  await device.startNotifications(
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC
  );

  const result = await attemptPartialFlash(
    device,
    appHex,
    deviceVersion,
    progress
  );

  await device.stopNotifications(
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC
  );

  return result;
};

const attemptPartialFlash = async (
  device: Device,
  appHex: string,
  deviceVersion: DeviceVersion,
  progress: Progress
): Promise<PartialFlashResult> => {
  console.log("Partial flash");
  progress(FlashProgressStage.Partial);

  const memoryMap = MemoryMap.fromHex(appHex);
  const flashSize = {
    [DeviceVersion.V1]: 256 * 1024,
    [DeviceVersion.V2]: 512 * 1024,
  }[deviceVersion];
  const source = memoryMap.slicePad(0, flashSize);
  try {
    const fileCodeData = findMakeCodeDataBin(source);
    // We can reinstate Python support here in future.
    if (fileCodeData === null) {
      console.log("No partial flash data");
      return PartialFlashResult.AttemptFullFlash;
    }
    console.log(
      `Found MakeCode partial flash data at offset ${fileCodeData.offset}`
    );

    const pf = new PartialFlashingService(device);
    const deviceCodeRange = await pf.getMakeCodeRegion();
    if (deviceCodeRange === null) {
      console.log("Could not read code region");
      return PartialFlashResult.AttemptFullFlash;
    }
    const deviceDalHash = await pf.getDALRegionHash();

    // Compare DAL hash
    if (fileCodeData.hash !== deviceDalHash) {
      console.log(
        `DAL hash comparison failed. Hex: ${fileCodeData.hash} vs device: ${deviceDalHash}`
      );
      return PartialFlashResult.AttemptFullFlash;
    }
    console.log(
      `Code start ${deviceCodeRange.start} end ${deviceCodeRange.end}`
    );
    if (deviceCodeRange.start !== fileCodeData.offset) {
      console.log("Code start address doesn't match");
      return PartialFlashResult.AttemptFullFlash;
    }

    let nextPacketNumber = 0;
    outer: for (let offset = fileCodeData.offset; offset < source.length; ) {
      for (let i = 0; i < 4; ++i) {
        const packetNumber = nextPacketNumber++;
        const packetOffset = offset + i * 16;
        if (i < 3) {
          await pf.writeFlash(source, packetOffset, packetNumber);
        } else {
          const result = await pf.writeFlashForNotification(
            source,
            packetOffset,
            packetNumber
          );
          if (result === WriteFlashResult.Retransmit) {
            // Retry the whole 64 bytes.
            break outer;
          } else {
            progress(
              FlashProgressStage.Partial,
              Math.round((offset / source.length) * 100)
            );
          }
        }
        offset += 64;
      }
    }

    delay(100); // allow time for write to complete
    await pf.writeEndOfFlashPacket();
    delay(100); // allow time for write to complete
    progress(FlashProgressStage.Partial, 100);

    return PartialFlashResult.Success;
  } catch (e) {
    device.error(e);
    return PartialFlashResult.Failed;
  }
};

const PXT_MAGIC_HEX = "708E3B92C615A841C49866C975EE5197";

interface CodeDataBin {
  offset: number;
  hash: string;
}

const findMakeCodeDataBin = (data: Uint8Array): CodeDataBin | null => {
  const offset = findByteSequence(data, PXT_MAGIC_HEX);
  if (offset < 0) {
    return null;
  }
  const hashOffset = offset + PXT_MAGIC_HEX.length / 2;
  const hash = bytesToHex(data.slice(hashOffset, hashOffset + 8));
  return { offset, hash };
};

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
};

function findByteSequence(data: Uint8Array, hexTarget: string): number {
  const target = new Uint8Array(
    hexTarget.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  outer: for (let i = 0; i <= data.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (data[i + j] !== target[j]) continue outer;
    }
    return i;
  }

  return -1;
}

export default partialFlash;
