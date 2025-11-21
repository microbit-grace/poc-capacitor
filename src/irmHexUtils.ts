import { DeviceVersion } from "./model";

const microbitHexBlocks = {
  v1: [0x9900, 0x9901, 0x9902],
  v2: [0x9903, 0x9904],
};

export const createHexFileFromUniversal = (
  inputHex: Uint8Array,
  deviceVersion: DeviceVersion
) => {
  const hexUtils = new irmHexUtils();
  const hexBlock = {
    [DeviceVersion.V1]: microbitHexBlocks.v1[0],
    [DeviceVersion.V2]: microbitHexBlocks.v2[0],
  }[deviceVersion];
  if (!hexUtils.universalHexToApplicationHex(inputHex, hexBlock)) {
    console.log(`Could not find hex block for version ${deviceVersion}`);
    return null;
  }
  return new SizedHexData(hexUtils.resultHex!, hexUtils.resultDataSize);
};

export const createAppBin = (
  appHex: Uint8Array,
  deviceVersion: DeviceVersion
) => {
  const hexUtils = new irmHexUtils();
  const hexBlock = {
    [DeviceVersion.V1]: microbitHexBlocks.v1[0],
    [DeviceVersion.V2]: microbitHexBlocks.v2[0],
  }[deviceVersion];
  if (!hexUtils.applicationHexToData(appHex, hexBlock)) {
    return null;
  }
  return new SizedHexData(hexUtils.resultData!, hexUtils.resultDataSize);
};

export const hexStrToByte = (hex: string) => {
  return new TextEncoder().encode(hex);
};

const charToByte = (c: string) => {
  return c.charCodeAt(0);
};

export class SizedHexData {
  data;
  size;
  constructor(data: Uint8Array, size: number) {
    this.data = data;
    this.size = size;
  }
}

class irmHexUtils {
  private scanHexSize = 0;
  private scanAddrMin = 0;
  private scanAddrNext = 0;
  private lineNext = 0;
  private lineHidx = 0;
  private lineCount = 0;
  private lineAddr = 0;
  private lineType = 0;
  private lineBlockType = 0;
  private lastBaseAddr = 0;
  private resultAddrMin = 0;
  private resultAddrNext = 0;

  resultDataSize: number = 0;
  resultHex: Uint8Array | null = null;
  resultData: Uint8Array | null = null;

  private scanInit = () => {
    this.scanHexSize = 0;
    this.lineNext = 0;
    this.lineHidx = 0;
    this.scanAddrMin = 0;
    this.scanAddrNext = Number.MAX_VALUE;
    this.lineCount = 0;
    this.lineAddr = 0;
    this.lineType = 0;
    this.lineBlockType = 0;
    this.lastBaseAddr = 0;
    this.resultAddrMin = Number.MAX_VALUE;
    this.resultAddrNext = 0;
  };

  constructor() {}

  parseLine = (hex: Uint8Array) => {
    if (this.lineNext > this.scanHexSize - 3) {
      return false;
    }
    this.lineHidx = this.lineNext;
    if (hex[this.lineHidx] != charToByte(":")) {
      return false;
    }
    this.lineCount = hextobyte(hex, this.lineHidx + 1);
    if (this.lineCount < 0) {
      return false;
    }
    const bytes = 5 + this.lineCount;
    const digits = bytes * 2;
    let next = digits + 1; // +1 for colon
    while (this.lineHidx + next < this.scanHexSize) {
      const b = hex[this.lineHidx + next];
      if (b == charToByte("\r") || b == charToByte("\n")) {
        next++;
      } else if (b === charToByte(":")) {
        break;
      } else {
        return false;
      }
    }
    this.lineNext += next; // bump this.lineNext to next line or eof
    this.lineType = hextobyte(hex, this.lineHidx + 7);
    if (this.lineType < 0) {
      return false;
    }

    switch (this.lineType) {
      case 0:
      case 0x0d: {
        this.lineAddr = hextoaddr(hex, this.lineHidx + 3);
        if (this.lineAddr < 0) return false;
        break;
      }

      case 0x0a: {
        // Extended Segment Address
        if (this.lineCount != 4) return false;
        const hi = hextobyte(hex, this.lineHidx + 9);
        const lo = hextobyte(hex, this.lineHidx + 11);
        this.lineBlockType = hi * 256 + lo;
        break;
      }

      case 2: {
        // Extended Segment Address
        if (this.lineCount != 2) return false;
        const hi = hextobyte(hex, this.lineHidx + 9);
        const lo = hextobyte(hex, this.lineHidx + 11);
        this.lastBaseAddr = hi * 0x1000 + lo * 0x10;
        break;
      }
      case 4: {
        // Extended Linear Address
        if (this.lineCount != 2) return false;
        const hi = hextobyte(hex, this.lineHidx + 9);
        const lo = hextobyte(hex, this.lineHidx + 11);
        this.lastBaseAddr = hi * 0x1000000 + lo * 0x10000;
        break;
      }
      default: {
        break;
      }
    }
    return true;
  };

  scanForDataHexAndBlockInternal = (
    datahex: Uint8Array | null,
    hexBlock: number,
    universalhex: Uint8Array,
    universalsize: number
  ) => {
    this.scanHexSize = universalsize;
    this.resultDataSize = 0;
    let lastType = -1; // Type of last record added
    let lastSize = -1; // index of last record added
    let hexSize = 0;
    let hidxELA0 = -1; // last ELA stored
    let sizeELA0 = 0;
    let dataWanted = false; // block type matches hexBlock
    let isUniversal = false;
    this.lineNext = 0;

    while (this.lineNext < this.scanHexSize) {
      if (!this.parseLine(universalhex)) {
        return 0;
      }
      const rlen = this.lineNext - this.lineHidx;
      if (rlen == 0) {
        continue;
      }
      switch (this.lineType) {
        case 0:
        case 0x0d: {
          if (!isUniversal || dataWanted) {
            const fullAddr = this.lastBaseAddr + this.lineAddr;
            if (
              fullAddr + this.lineCount > this.scanAddrMin &&
              fullAddr < this.scanAddrNext
            ) {
              if (this.resultAddrMin > fullAddr) {
                this.resultAddrMin = fullAddr;
              }
              if (this.resultAddrNext < fullAddr + this.lineCount) {
                this.resultAddrNext = fullAddr + this.lineCount;
              }
              if (datahex != null) {
                datahex.set(
                  universalhex.subarray(this.lineHidx, this.lineHidx + rlen),
                  hexSize
                );
                datahex[hexSize + 7] = charToByte("0");
                datahex[hexSize + 8] = charToByte("0");
                if (!setCheck(datahex, hexSize)) {
                  return 0;
                }
              }
              lastSize = hexSize;
              lastType = this.lineType;
              hexSize += rlen;
            }
          }
          break;
        }

        case 1:
        case 2: {
          if (datahex != null) {
            datahex.set(
              universalhex.subarray(this.lineHidx, this.lineHidx + rlen),
              hexSize
            );
          }
          lastSize = hexSize;
          lastType = this.lineType;
          hexSize += rlen;
          break;
        }

        case 4: {
          // Add if the address has changed
          // If the last record added is ELA, overwrite it
          if (
            sizeELA0 != rlen ||
            !bytesmatch(
              universalhex,
              hidxELA0,
              universalhex,
              this.lineHidx,
              rlen
            )
          ) {
            hidxELA0 = this.lineHidx;
            sizeELA0 = rlen;
            if (lastType == this.lineType) hexSize = lastSize;
            if (datahex != null) {
              datahex.set(
                universalhex.subarray(hidxELA0, hidxELA0 + sizeELA0),
                hexSize
              );
            }
            lastSize = hexSize;
            lastType = this.lineType;
            hexSize += sizeELA0;
          }
          break;
        }

        case 0x0a: {
          if (this.lineCount < 2) {
            return 0;
          }
          if (sizeELA0 == 0) {
            // must have been at least an ELA record
            return 0;
          }
          isUniversal = true;
          dataWanted = hexBlocksMatch(this.lineBlockType, hexBlock);
          break;
        }

        default: {
          break;
        }
      }
    }
    this.resultDataSize =
      this.resultAddrNext > this.resultAddrMin
        ? this.resultAddrNext - this.resultAddrMin
        : 0;
    if (this.resultDataSize === 0) {
      hexSize = 0; // no data for specified hexBlock
    }
    return hexSize;
  };

  // Scan for single target data hex from universal hex
  //
  // return false on failure
  scanForDataHexAndBlock = (
    universalHex: Uint8Array,
    hexBlock: number
  ): boolean => {
    this.resultHex = null;
    try {
      let hexSize = this.scanForDataHexAndBlockInternal(
        null,
        hexBlock,
        universalHex,
        universalHex.byteLength
      );
      if (hexSize == 0) return false;
      if (hexSize > 0) {
        this.resultHex = new Uint8Array(hexSize);
        hexSize = this.scanForDataHexAndBlockInternal(
          this.resultHex,
          hexBlock,
          universalHex,
          universalHex.byteLength
        );
        if (hexSize == 0) return false;
      }
    } catch (e) {
      console.error(`Error! ${e}`);
      return false;
    }
    return true;
  };

  // Extract single target application hex from universal hex
  //
  // return false on failure
  // generated hex is in resultHex
  universalHexToApplicationHex = (
    universalHex: Uint8Array,
    hexBlock: number
  ): boolean => {
    this.scanInit();
    const { min, next } = hexBlockToAppRegion(hexBlock);
    this.scanAddrMin = min;
    this.scanAddrNext = next;
    const res = this.scanForDataHexAndBlock(universalHex, hexBlock);
    return res;
  };

  scanForDataHexInternal = (
    data: Uint8Array | null,
    hex: Uint8Array,
    hexSize: number
  ) => {
    this.scanHexSize = hexSize;
    this.lineNext = 0;
    while (this.lineNext < this.scanHexSize) {
      if (!this.parseLine(hex)) {
        return 0;
      }
      const rlen = this.lineNext - this.lineHidx;
      if (rlen === 0) {
        continue;
      }
      switch (this.lineType) {
        case 0:
        case 0x0d: {
          const fullAddr = this.lastBaseAddr + this.lineAddr;
          if (
            fullAddr + this.lineCount > this.scanAddrMin &&
            fullAddr < this.scanAddrNext
          ) {
            const first =
              this.scanAddrMin > fullAddr ? this.scanAddrMin - fullAddr : 0;
            const next =
              this.scanAddrNext < fullAddr + this.lineCount
                ? this.scanAddrNext - fullAddr
                : this.lineCount;
            const length = next - first;
            const dataOffset = fullAddr + first - this.scanAddrMin;
            if (data !== null) {
              const lineBytes = new Uint8Array(this.lineCount);
              if (!lineData(hex, this.lineHidx, lineBytes, 0)) {
                return 0;
              }
              data.set(lineBytes.subarray(first, first + length), dataOffset);
            }
            if (this.resultAddrMin > fullAddr + first) {
              this.resultAddrMin = fullAddr + first;
            }
            if (this.resultAddrNext < fullAddr + next) {
              this.resultAddrNext = fullAddr + next;
            }
          }
          break;
        }

        default: {
          break;
        }
      }
    }

    // calculate size of data from scanMin
    this.resultDataSize =
      this.resultAddrNext > this.resultAddrMin
        ? this.resultAddrNext - this.scanAddrMin
        : 0; // no data between
    return this.resultDataSize;
  };

  // Scan for single target data hex from universal hex
  //
  // return false on failure
  scanForDataHex = (hex: Uint8Array) => {
    this.resultData = null;
    try {
      let dataSize = this.scanForDataHexInternal(null, hex, hex.length);
      if (dataSize === 0) {
        return false;
      }
      if (dataSize % 4 !== 0) {
        dataSize += 4 - (dataSize % 4);
      }
      this.resultData = new Uint8Array(dataSize);
      this.resultData.fill(0xff);
      dataSize = this.scanForDataHexInternal(this.resultData, hex, hex.length);
      if (dataSize === 0) {
        return false;
      }
    } catch (err) {
      console.log("Error!", err);
      return false;
    }
    return true;
  };

  applicationHexToData = (hex: Uint8Array, hexBlock: number) => {
    this.scanInit();
    const { min, next } = hexBlockToAppRegion(hexBlock);
    this.scanAddrMin = min;
    this.scanAddrNext = next;
    return this.scanForDataHex(hex);
  };
}

const hexBlockToAppRegion = (hexBlock: number) => {
  if (microbitHexBlocks.v1.includes(hexBlock)) {
    // Returns min, next, and page.
    return { min: 0x18000, next: 0x3c000, page: 0x400 };
  }
  if (microbitHexBlocks.v2.includes(hexBlock)) {
    return { min: 0x1c000, next: 0x77000, page: 0x1000 };
  }
  return { min: 0, next: 0, page: 0 };
};

const hexToDigit = (c: number) => {
  const byteFor0 = charToByte("0");
  const byteFor9 = charToByte("9");
  if (c >= byteFor0 && c <= byteFor9) {
    return c - byteFor0;
  }
  const byteForA = charToByte("A");
  const byteForF = charToByte("F");
  if (c >= byteForA && c <= byteForF) {
    return 10 + c - byteForA;
  }
  return -1;
};

const hextobyte = (hex: Uint8Array, idx: number): number => {
  const hi = hexToDigit(hex[idx]);
  const lo = hexToDigit(hex[idx + 1]);
  return hi < 0 || lo < 0 ? -1 : 16 * hi + lo;
};

const hextoaddr = (hex: Uint8Array, idx: number): number => {
  const hi = hextobyte(hex, idx);
  const lo = hextobyte(hex, idx + 2);
  return hi < 0 || lo < 0 ? -1 : hi * 256 + lo;
};

function calcSum(hex: Uint8Array, hexIdx: number): number {
  const count = hextobyte(hex, hexIdx + 1);
  if (count < 0) return -1;
  const bytes = 5 + count - 1;
  let b: number;
  let sum: number = 0;
  for (let i = 0; i < bytes; i++) {
    b = hextobyte(hex, hexIdx + 1 + i * 2);
    if (b < 0) return -1;
    sum += b;
  }
  return sum % 256;
}

function setCheck(hex: Uint8Array, hexIdx: number): boolean {
  let sum = calcSum(hex, hexIdx);
  if (sum < 0) {
    return false;
  }
  const check = sum === 0 ? 0 : 256 - sum;
  const count = hextobyte(hex, hexIdx + 1);
  const checkIdx = hexIdx + 9 + count * 2;
  hex[checkIdx] = digittohex(Math.floor(check / 16));
  hex[checkIdx + 1] = digittohex(check % 16);
  const chk = lineCheck(hex, hexIdx);
  if (chk < 0) {
    return false;
  }
  sum = calcSum(hex, hexIdx);
  sum = (chk + sum) % 256;
  return sum === 0;
}

function digittohex(d: number): number {
  if (d >= 0 && d <= 9) {
    return "0".charCodeAt(0) + d;
  }
  if (d >= 10 && d <= 16) {
    return "A".charCodeAt(0) + (d - 10);
  }
  return -1;
}

function lineCheck(hex: Uint8Array, hexIdx: number): number {
  const count = hextobyte(hex, hexIdx + 1);
  return count < 0 ? -1 : hextobyte(hex, hexIdx + 9 + count * 2);
}

const bytesmatch = (
  b0: Uint8Array,
  i0: number,
  b1: Uint8Array,
  i1: number,
  len: number
): boolean => {
  for (let i = 0; i <= len; i++) {
    if (b0[i0 + i] != b1[i1 + i]) {
      return false;
    }
  }
  return true;
};

const hexBlocksMatch = (blockType: number, hexBlock: number): boolean => {
  if (microbitHexBlocks.v1.includes(blockType)) {
    return microbitHexBlocks.v1.includes(hexBlock);
  }
  if (microbitHexBlocks.v2.includes(blockType)) {
    return microbitHexBlocks.v2.includes(hexBlock);
  }
  return false;
};

function lineData(
  hex: Uint8Array,
  hexIdx: number,
  data: Uint8Array,
  idx: number
): boolean {
  const count = hextobyte(hex, hexIdx + 1);
  if (count < 0) return false;

  for (let i = 0; i < count; i++) {
    const d = hextobyte(hex, hexIdx + 9 + 2 * i);
    if (d < 0) return false;
    data[idx + i] = d;
  }
  return true;
}
