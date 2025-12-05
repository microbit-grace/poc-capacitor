import MemoryMap from "nrf-intel-hex";
import { delay } from "../utils";
import { Device } from "./bluetooth";
import {
  PARTIAL_FLASH_CHARACTERISTIC,
  PARTIAL_FLASHING_SERVICE,
} from "./constants";
import { FlashProgressStage, Progress } from "./model";
import {
  PacketState,
  PartialFlashingService,
  RegionId,
} from "./partial-flashing-service";
import { findMakeCodeRegionInMemoryMap } from "./flashing-makecode";

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
  progress: Progress
): Promise<PartialFlashResult> => {
  await device.startNotifications(
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC
  );

  const result = await partialFlashInternal(device, appHex, progress);

  await device.stopNotifications(
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC
  );

  return result;
};

const partialFlashInternal = async (
  device: Device,
  appHex: string,
  progress: Progress
): Promise<PartialFlashResult> => {
  console.log("Partial flash");
  progress(FlashProgressStage.Partial);

  const memoryMap = MemoryMap.fromHex(appHex);
  try {
    const pf = new PartialFlashingService(device);

    const deviceCodeRegion = await pf.getRegionInfo(RegionId.MakeCode);
    if (deviceCodeRegion === null) {
      console.log("Could not read code region");
      return PartialFlashResult.AttemptFullFlash;
    }

    const deviceDalRegion = await pf.getRegionInfo(RegionId.Dal);
    if (deviceDalRegion === null) {
      console.log("Could not read DAL region");
      return PartialFlashResult.AttemptFullFlash;
    }

    const fileCodeRegion = findMakeCodeRegionInMemoryMap(
      memoryMap,
      deviceCodeRegion
    );
    if (fileCodeRegion === null) {
      console.log("No partial flash data");
      return PartialFlashResult.AttemptFullFlash;
    }

    if (fileCodeRegion.hash !== deviceDalRegion.hash) {
      console.log(
        `DAL hash comparison failed. Hex: ${fileCodeRegion.hash} vs device: ${deviceDalRegion}`
      );
      return PartialFlashResult.AttemptFullFlash;
    }
    if (deviceCodeRegion.start !== fileCodeRegion.start) {
      console.log("Code start address doesn't match");
      return PartialFlashResult.AttemptFullFlash;
    }

    let nextPacketNumber = 0;
    outer: for (
      let offset = fileCodeRegion.start;
      offset < fileCodeRegion.end;

    ) {
      const batchStartAddress = offset;

      for (let packetInBatch = 0; packetInBatch < 4; ++packetInBatch) {
        const packetNumber = nextPacketNumber++;
        const packetDataOffset = offset + packetInBatch * 16;

        if (packetInBatch < 3) {
          await pf.writeFlash(
            memoryMap,
            batchStartAddress,
            packetDataOffset,
            packetNumber,
            packetInBatch
          );
        } else {
          const result = await pf.writeFlashForNotification(
            memoryMap,
            batchStartAddress,
            packetDataOffset,
            packetNumber,
            packetInBatch
          );
          if (result === PacketState.Retransmit) {
            // Retry the whole 64 bytes.
            console.log(`Retransmit requested at offset ${offset}`);
            continue outer;
          } else {
            progress(
              FlashProgressStage.Partial,
              Math.round(
                ((offset - fileCodeRegion.start) /
                  (fileCodeRegion.end - fileCodeRegion.start)) *
                  100
              )
            );
          }
        }
      }
      offset += 64;
    }

    await delay(100); // allow time for write to complete
    await pf.writeEndOfFlashPacket();
    await delay(100); // allow time for write to complete
    progress(FlashProgressStage.Partial, 100);

    return PartialFlashResult.Success;
  } catch (e) {
    device.error(e);
    return PartialFlashResult.Failed;
  }
};

export default partialFlash;
