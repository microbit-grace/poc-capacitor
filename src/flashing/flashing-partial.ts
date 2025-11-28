import {
  BleDevice,
  numbersToDataView,
} from "@capacitor-community/bluetooth-le";
import {
  characteristicWriteNotificationWait,
  cleanupCharacteristicNotifications,
  WriteType,
} from "./bluetooth";
import {
  PARTIAL_FLASH_CHARACTERISTIC,
  PARTIAL_FLASHING_SERVICE,
} from "./constants";
import HexUtils, { forByteArray, recordToByteArray } from "./hex-utils";
import { DeviceVersion, FlashProgressStage, Progress } from "./model";
import { delay } from "../utils";

export enum PartialFlashResult {
  Success = "Success",
  InvalidHex = "InvalidHex",
  Failed = "Failed",
  AttemptFullFlash = "AttemptFullFlash",
  FailedToConnect = "FailedToConnect",
}

const REGION_INFO_COMMAND = 0x0;
const REGION_MAKECODE = 2;
const REGION_DAL = 1;
const FLASH_COMMAND = 0x1;
const PACKET_STATE_WAITING = 0;
const PACKET_STATE_RETRANSMIT = 0xaa;

const partialFlash = async (
  device: BleDevice,
  appHexData: Uint8Array,
  deviceVersion: DeviceVersion,
  progress: Progress
): Promise<PartialFlashResult> => {
  console.log("partial flash");
  progress(FlashProgressStage.Partial);
  const { deviceId } = device;
  const hex = forByteArray(appHexData);
  let python = false; // Not seem to be used.
  let codeData = findMakeCodeData(hex);
  if (codeData === null) {
    codeData = findPythonData(deviceVersion, hex);
    if (codeData !== null) {
      python = true;
    }
  }
  if (codeData === null) {
    console.log("No partial flash data");
    return PartialFlashResult.AttemptFullFlash;
  }

  const { pos: dataPos, hash: fileHash } = codeData;
  console.log(
    `Found${python ? " python " : " "}partial flash data at ${
      dataPos.line
    } at offset ${dataPos.part}`
  );
  const deviceCodeResult = await characteristicWriteNotificationWait(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    numbersToDataView([REGION_INFO_COMMAND, REGION_MAKECODE]),
    // The Android app writes this with response but iOS objects as we don't
    // advertise support for that
    WriteType.NoResponse,
    REGION_INFO_COMMAND
  );
  const deviceCodeRange = deviceCodeResult.value
    ? parseMakeCodeRegionCommandResponse(deviceCodeResult.value)
    : null;
  if (deviceCodeRange === null) {
    console.log("Could not read code region");
    return PartialFlashResult.AttemptFullFlash;
  }

  const deviceHashResult = await characteristicWriteNotificationWait(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    numbersToDataView([REGION_INFO_COMMAND, REGION_DAL]),
    // The Android app writes this with response but iOS objects as we don't
    // advertise support for that
    WriteType.NoResponse,
    REGION_INFO_COMMAND
  );
  const deviceHash = deviceHashResult.value
    ? parseDalRegionCommandResponse(deviceHashResult.value)
    : null;
  if (deviceHash == null) {
    console.log("Could not read DAL region");
    return PartialFlashResult.AttemptFullFlash;
  }

  // Compare DAL hash
  if (fileHash !== deviceHash) {
    console.log(
      `DAL hash comparison failed. Hex: ${fileHash} vs device: ${deviceHash}`
    );
    return PartialFlashResult.AttemptFullFlash;
  }
  let writeCounter = 0;
  const numOfLines = hex.numOfLines() - dataPos.line;
  console.log(`Total lines: ${numOfLines}`);
  let packetNum = 0;
  let lineCount = 0;
  let part = dataPos.part;
  let line0 = 0;
  let part0 = part;
  let addrLo = hex.getRecordAddressFromIndex(dataPos.line + lineCount);
  let addrHi = hex.getSegmentAddress(dataPos.line + lineCount);
  let addr = addrLo + addrHi * 256 * 256;
  let hexData: string;
  let partData: string;
  console.log(`Code start ${deviceCodeRange.start} end ${deviceCodeRange.end}`);
  console.log(`First line ${addr}`);

  // Ready to flash!
  // Loop through data
  console.log("enter flashing loop");
  let addr0 = addr + part / 2; // two hex digits per byte
  let addr0Lo = addr0 % (256 * 256);
  let addr0Hi = addr0 / (256 * 256);
  if (deviceCodeRange.start !== addr0) {
    console.log("Code start address doesn't match");
    return PartialFlashResult.AttemptFullFlash;
  }

  // TODO - check size of code in file matches micro:bit
  let endOfFile = false;
  while (true) {
    // Timeout if total is > 30 seconds
    //if (SystemClock.elapsedRealtime() - startTime > 60000) {
    //    log.i("Partial flashing has timed out")
    //    return PartialFlashResult.AttemptFullFlash
    // }
    // Check if EOF
    if (
      endOfFile ||
      hex.getRecordTypeFromIndex(dataPos.line + lineCount) != 0
    ) {
      if (writeCounter === 0) {
        break;
      }
      endOfFile = true;
    }
    if (endOfFile) {
      // complete the batch of 4 packets with FF
      const c32 = new Array(32).fill("F");
      hexData = c32.join("");
      partData = hexData;
    } else {
      addrLo = hex.getRecordAddressFromIndex(dataPos.line + lineCount);
      addrHi = hex.getSegmentAddress(dataPos.line + lineCount);
      addr = addrLo + addrHi * 256 * 256;
      hexData = hex.getDataFromIndex(dataPos.line + lineCount);
      partData =
        part + 32 > hexData.length
          ? hexData.substring(part)
          : hexData.substring(part, part + 32);
    }
    let offsetToSend = 0;
    if (writeCounter === 0) {
      line0 = lineCount;
      part0 = part;
      addr0 = addr + part / 2; // two hex digits per byte
      addr0Lo = addr0 % (256 * 256);
      addr0Hi = addr0 / (256 * 256);
      offsetToSend = addr0Lo;
    } else if (writeCounter === 1) {
      offsetToSend = addr0Hi;
    }
    console.log(
      `${packetNum} ${writeCounter} addr0 ${addr0} offsetToSend ${offsetToSend} line ${lineCount} addr ${addr} part ${part} data ${partData} endOfFile ${endOfFile}`
    );
    const chunk = recordToByteArray(partData, offsetToSend, packetNum);
    // The micro:bit waits for 4 of our 16 byte writes and then sends a notification
    // so we need to track which write we're on.
    writeCounter++;
    let packetState = -1;
    if (writeCounter === 4) {
      const result = await characteristicWriteNotificationWait(
        deviceId,
        PARTIAL_FLASHING_SERVICE,
        PARTIAL_FLASH_CHARACTERISTIC,
        chunk,
        WriteType.NoResponse,
        FLASH_COMMAND,
        (notificationValue: Uint8Array) =>
          notificationValue[1] !== PACKET_STATE_WAITING
      );
      if (!result.status || result.value === null) {
        return PartialFlashResult.Failed;
      }
      packetState = result.value[1];
      writeCounter = 0;
    } else {
      const result = await characteristicWriteNotificationWait(
        deviceId,
        PARTIAL_FLASHING_SERVICE,
        PARTIAL_FLASH_CHARACTERISTIC,
        chunk,
        WriteType.NoResponse
      );
      if (!result.status) {
        return PartialFlashResult.Failed;
      }
    }
    if (packetState === PACKET_STATE_RETRANSMIT) {
      // Retransmit the same block next time around
      lineCount = line0;
      part = part0;
      endOfFile = false;
    } else {
      progress(
        FlashProgressStage.Partial,
        Math.round((lineCount / numOfLines) * 100)
      );
      if (!endOfFile) {
        // Next part
        part += partData.length;
        if (part >= hexData.length) {
          part = 0;
          lineCount += 1;
        }
      }
    }

    // Always increment packet #
    packetNum += 1;
  }
  delay(100); // allow time for write to complete

  const endOfFlashPacket = numbersToDataView([0x02]);
  const { status } = await characteristicWriteNotificationWait(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC,
    endOfFlashPacket,
    WriteType.NoResponse
  );

  await cleanupCharacteristicNotifications(
    deviceId,
    PARTIAL_FLASHING_SERVICE,
    PARTIAL_FLASH_CHARACTERISTIC
  );
  if (!status) {
    return PartialFlashResult.Failed;
  }
  delay(100); // allow time for write to complete
  progress(FlashProgressStage.Partial, 100);

  // Time execution
  //val endTime = SystemClock.elapsedRealtime()
  //val elapsedMilliSeconds = endTime - startTime
  //val elapsedSeconds = elapsedMilliSeconds / 1000.0
  //log.i("Flash Time: " + elapsedSeconds.toFloat() + " seconds")
  return PartialFlashResult.Success;
};

interface HexPos {
  line: number;
  part: number;
  sizeBytes: number;
}

interface CodeData {
  pos: HexPos;
  hash: string;
}

const PXT_MAGIC = "708E3B92C615A841C49866C975EE5197";

// Exposed for testing
const findMakeCodeData = (hex: HexUtils): CodeData | null => {
  const pos: HexPos = { line: 0, part: 0, sizeBytes: 0 };
  pos.line = hex.searchForData(PXT_MAGIC);
  if (pos.line < 0) {
    return null;
  }
  const magicData = hex.getDataFromIndex(pos.line);
  pos.part = magicData.indexOf(PXT_MAGIC);
  const hdrAddress = hexPosToAddress(hex, pos);
  const hashAddress = hdrAddress + PXT_MAGIC.length / 2;
  const hashPos = hexAddressToPos(hex, hashAddress);
  if (!hashPos) {
    return null;
  }
  hashPos.sizeBytes = 8;
  const fileHash = hexGetData(hex, hashPos);
  if (fileHash.length < 8 * 2) {
    // 16 bytes
    return null;
  }
  return { pos, hash: fileHash };
  // TODO - find end of data pos.sizeBytes
};

const hexPosToAddress = (hex: HexUtils, pos: HexPos): number => {
  const addrLo = hex.getRecordAddressFromIndex(pos.line);
  const addrHi = hex.getSegmentAddress(pos.line);
  const addr = addrLo + addrHi * 256 * 256;
  return addr + pos.part / 2;
};

const hexAddressToPos = (hex: HexUtils, address: number): HexPos | null => {
  const pos: HexPos = { line: 0, part: 0, sizeBytes: 0 };
  pos.line = hex.searchForAddress(address);
  if (pos.line < 0) {
    return null;
  }
  const lineAddr = hex.getRecordAddressFromIndex(pos.line);
  const addressLo = address % 0x10000;
  const offset = addressLo - lineAddr;
  pos.part = offset * 2;
  return pos;
};

const hexGetData = (hex: HexUtils, pos: HexPos | null): string => {
  let data = "";
  let line = pos!.line;
  let part = pos!.part;
  let size = pos!.sizeBytes * 2; // 2 characters per byte

  while (size > 0) {
    const type = hex.getRecordTypeFromIndex(line);
    if (type !== 0 && type !== 0x0d) {
      line++;
      part = 0;
    } else {
      const lineData = hex.getDataFromIndex(line);
      const len = lineData.length;
      const chunk = Math.min(len - part, size);
      if (chunk > 0) {
        data += lineData.substring(part, part + chunk);
        part += chunk;
        size -= chunk;
      }
      if (size > 0 && part >= len) {
        line += 1;
        part = 0;
        if (line >= hex.numOfLines()) {
          break;
        }
      }
    }
  }
  return data;
};

interface AddressRange {
  start: number;
  end: number;
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
  console.log(start);
  console.log(end);
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

const UPY_MAGIC = ".*FE307F59.{16}9DD7B1C1.*";
const UPY_MAGIC1 = "FE307F59";
const PYTHON_HEADER_SIZE = 16;
const PYTHON_REGION_SIZE = 16;

const findPythonData = (
  deviceVersion: DeviceVersion,
  hex: HexUtils
): CodeData | null => {
  let fileHash: string | null = "";
  let pos: HexPos | null = { line: 0, part: 0, sizeBytes: 0 };
  pos.line = hex.searchForDataRegEx(UPY_MAGIC);
  if (pos.line < 0) {
    return null;
  }
  let header = hex.getDataFromIndex(pos.line);
  pos.part = header.indexOf(UPY_MAGIC1);
  pos.sizeBytes = PYTHON_HEADER_SIZE;
  header = hexGetData(hex, pos);
  if (header.length < PYTHON_HEADER_SIZE * 2) {
    return null;
  }
  const version = hexToUint16(header, 8);
  const table_len = hexToUint16(header, 12);
  const num_reg = hexToUint16(header, 16);
  const pageLog2 = hexToUint16(header, 20);

  if (version != 1) {
    return null;
  }
  if (table_len != num_reg * 16) {
    return null;
  }
  const page = deviceVersion == DeviceVersion.V1 ? 0x400 : 0x1000;
  if (1 << pageLog2 != page) {
    return null;
  }
  let codeStart: number = -1;
  let codeLength: number = -1;
  const hdrAddress = hexPosToAddress(hex, pos);
  for (let regionIndex = 0; regionIndex < num_reg; regionIndex++) {
    const regionAddress =
      hdrAddress - table_len + regionIndex * PYTHON_REGION_SIZE;
    pos = hexAddressToPos(hex, regionAddress);
    if (pos === null) {
      return null;
    }
    pos.sizeBytes = PYTHON_REGION_SIZE;
    const region = hexGetData(hex, pos);
    if (region.length < PYTHON_REGION_SIZE * 2) {
      return null;
    }
    const regionID = hexToUint8(region, 0);
    const hashType = hexToUint8(region, 2);
    const startPage = hexToUint16(region, 4);
    const length = hexToUint32(region, 8);
    const hashPtr = hexToUint32(region, 16);
    const hash = region.substring(16, 32);

    // Extract regionHash
    let regionHash: string | null = null;
    switch (hashType) {
      case 0: {
        break;
      }
      case 1: {
        // hash data contains 8 bytes of verbatim data
        regionHash = hash;
        break;
      }
      case 2: {
        // hash data contains a 4-byte pointer to a string of up tp 100 chars
        // hash is the crc32 of the string
        const hashPos = hexAddressToPos(hex, hashPtr);
        if (!hashPos) {
          return null;
        }
        hashPos.sizeBytes = 100;
        const hashData = hexGetData(hex, hashPos);
        if (hashData.length === 0) {
          return null;
        }
        let strLen = 0;
        while (strLen < hashData.length / 2) {
          const chr = hexToUint8(hashData, strLen * 2);
          if (chr == 0) {
            break;
          }
          strLen++;
        }
        const strBytes = new Uint8Array(strLen);
        let i = 0;
        while (i < strLen) {
          const chr = hexToUint8(hashData, i * 2);
          strBytes[i] = chr;
          i++;
        }
        const crc = crc32(strBytes);
        const hashBytes = new Uint8Array(8);
        hashBytes[0] = crc & 0xff;
        hashBytes[1] = (crc >> 8) & 0xff;
        hashBytes[2] = (crc >> 16) & 0xff;
        hashBytes[3] = (crc >> 24) & 0xff;
        regionHash = bytesToHex(hashBytes);
        break;
      }
      default: {
        // Unknown
        return null;
      }
    }
    switch (regionID) {
      case 1: {
        break;
      }
      case 2: {
        fileHash = regionHash;
        break;
      }
      case 3: {
        codeStart = startPage * page;
        codeLength = length;
      }
    }
  }
  if (codeStart < 0 || codeLength < 0) {
    return null;
  }
  // const index = hex.searchForAddress(codeStart);
  pos = hexAddressToPos(hex, codeStart);
  if (pos === null || fileHash === null) {
    return null;
  }
  pos.sizeBytes = codeLength;
  return { pos, hash: fileHash };
};

const hexToUint16 = (hex: string, idx: number): number => {
  const lo = hexToUint8(hex, idx);
  const hi = hexToUint8(hex, idx + 2);
  return lo < 0 || hi < 0 ? -1 : hi * 256 + lo;
};
const hexToUint8 = (hex: string, idx: number): number => {
  if (idx + 1 >= hex.length) {
    return -1;
  }
  const hi = parseHexDigit(hex[idx]);
  const lo = parseHexDigit(hex[idx + 1]);
  return hi < 0 || lo < 0 ? -1 : hi * 16 + lo;
};
const hexToUint32 = (hex: string, idx: number): number => {
  const b0 = hexToUint8(hex, idx);
  const b1 = hexToUint8(hex, idx + 2);
  const b2 = hexToUint8(hex, idx + 4);
  const b3 = hexToUint8(hex, idx + 6);
  return b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0
    ? -1
    : b0 + b1 * 0x100 + b2 * 0x10000 + b3 * 0x1000000;
};
const parseHexDigit = (char: string): number => {
  const code = char.charCodeAt(0);
  if (code >= "0".charCodeAt(0) && code <= "9".charCodeAt(0)) {
    return code - "0".charCodeAt(0);
  }
  if (code >= "A".charCodeAt(0) && code <= "F".charCodeAt(0)) {
    return 10 + code - "A".charCodeAt(0);
  }
  if (code >= "a".charCodeAt(0) && code <= "f".charCodeAt(0)) {
    return 10 + code - "a".charCodeAt(0);
  }
  return -1;
};
const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

export default partialFlash;
