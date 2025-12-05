import {
  BleClient,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import {
  MICROBIT_RESET_COMMAND,
  PARTIAL_FLASH_CHARACTERISTIC,
  PARTIAL_FLASHING_SERVICE,
} from "./constants";
import { Device, WriteType } from "./bluetooth";

const REGION_INFO_COMMAND = 0x0;
const REGION_MAKECODE = 2;
const REGION_DAL = 1;
const FLASH_COMMAND = 0x1;

export const enum PacketState {
  Waiting = 0x00,
  Retransmit = 0xaa,
}

export const enum WriteFlashResult {
  Success,
  Retransmit,
}

export enum MicroBitMode {
  Pairing = 0x00,
  Application = 0x01,
}

export interface AddressRange {
  start: number;
  end: number;
}

export class PartialFlashingService {
  constructor(private device: Device) {}

  async resetToMode(mode: MicroBitMode): Promise<void> {
    await BleClient.writeWithoutResponse(
      this.device.deviceId,
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      numbersToDataView([MICROBIT_RESET_COMMAND, mode])
    );
  }

  async getMakeCodeRegion(): Promise<AddressRange | null> {
    return parseMakeCodeRegionCommandResponse(
      await this.getRegionInfo(REGION_MAKECODE)
    );
  }

  async getDALRegionHash(): Promise<string | null> {
    return parseDalRegionCommandResponse(await this.getRegionInfo(REGION_DAL));
  }

  /**
   * Writes a flash chunk.
   * Use writeFlashForNotification for every 4th chunk.
   *
   * @param chunk
   * @returns
   */
  async writeFlash(chunk: DataView) {
    return await BleClient.writeWithoutResponse(
      this.device.deviceId,
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      chunk
    );
  }

  /**
   * Write a chunk and wait for a success/retransmit response.
   * The micro:bit notifies on every 4th chunk.
   */
  async writeFlashForNotification(chunk: DataView): Promise<WriteFlashResult> {
    const result = await this.device.writeForNotification(
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      chunk,
      WriteType.NoResponse,
      FLASH_COMMAND,
      (notificationValue: Uint8Array) =>
        notificationValue[1] !== PacketState.Waiting
    );
    const packetState = result[1];
    return packetState === PacketState.Retransmit
      ? WriteFlashResult.Retransmit
      : WriteFlashResult.Success;
  }

  async writeEndOfFlashPacket() {
    this.writeFlash(numbersToDataView([0x02]));
  }

  private async getRegionInfo(
    region: typeof REGION_MAKECODE | typeof REGION_DAL
  ) {
    return await this.device.writeForNotification(
      PARTIAL_FLASHING_SERVICE,
      PARTIAL_FLASH_CHARACTERISTIC,
      numbersToDataView([REGION_INFO_COMMAND, region]),
      WriteType.NoResponse,
      REGION_INFO_COMMAND
    );
  }
}

const parseMakeCodeRegionCommandResponse = (
  value: Uint8Array
): AddressRange | null => {
  let offset = 2; // Skip first 2 bytes
  const dataView = new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength
  );
  const start = dataView.getUint32(offset, false);
  offset += 4;
  const end = dataView.getUint32(offset, false);
  if (start === 0 || start >= end) {
    return null;
  }

  return { start, end };
};

const parseDalRegionCommandResponse = (value: Uint8Array): string => {
  const hash = value.slice(10, 18);
  return bytesToHex(hash);
};

const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("");
};
