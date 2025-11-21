import { numbersToDataView } from "@capacitor-community/bluetooth-le";

class HexUtils {
  hexLines;
  constructor(hexLines: string[]) {
    this.hexLines = hexLines;
  }

  /*
   * A function to find the length of the hex file
   * @param none
   * @ return the size (# of lines) in the hex file
   */
  numOfLines(): number {
    return this.hexLines.length;
  }

  /*
   * A function to search for data in a hex file
   * @param the _string_ of data to search for
   * @return the index of the data. -1 if not found.
   */
  searchForData(search: string): number {
    return this.hexLines.findIndex((line) => line.includes(search));
  }

  /*
   * A function to search for data in a hex file
   * @param the _string_ of data to search for
   * @return the index of the data. -1 if not found.
   */
  searchForDataRegEx(search: string): number {
    return this.hexLines.findIndex((line) => line.match(search));
  }

  /*
   * Returns data from an index
   * @param index
   * @return data as string
   */
  getDataFromIndex(index: number): string {
    return this.getRecordData(this.hexLines[index]);
  }

  /*
    Used to get the data from a record
    @param record as a string
    @return data as a string
    */
  private getRecordData(record: string): string {
    try {
      const length = this.getRecordDataLength(record);
      return record.substring(9, 9 + length);
    } catch (e) {
      console.error("Get record data", e);
      return "";
    }
  }

  /**
   * Used to get the data length from a record
   * @param record Record as a String
   * @return Data length as a decimal / # of chars
   */
  private getRecordDataLength(record: string): number {
    const hexLength = record.substring(1, 3);
    return 2 * parseInt(hexLength, 16);
  }

  /*
   * Returns record address from an index
   * Note: does not include segment address
   * @param index
   * @return address as number
   */
  getRecordAddressFromIndex(index: number): number {
    return this.getRecordAddress(this.hexLines[index]);
  }
  /*
        Used to get the data address from a record
        @param Record as a String
        @return Data address as a decimal
     */
  private getRecordAddress(record: string): number {
    const hexAddress = record.substring(3, 7);
    return parseInt(hexAddress, 16);
  }

  /*
   * Returns segment address from an index
   * @param index
   * @return address as number
   */
  getSegmentAddress(index: number): number {
    // Look backwards to find current segment address
    const segmentAddress = -1;
    let cur = index;
    while (segmentAddress == -1) {
      if (this.getRecordTypeFromIndex(cur) == 4) break;
      cur--;
    }
    // Return segment address
    const recordData = this.getRecordData(this.hexLines[cur]);
    return parseInt(recordData, 16);
  }

  /*
   * Returns record type from an index
   * @param index
   * @return type as int
   */
  getRecordTypeFromIndex(index: number): number {
    return this.getRecordType(this.hexLines[index]);
  }

  /*
    Used to get the record type from a record
    @param Record as a string
    @return Record type as a decimal
    */
  private getRecordType(record: string): number {
    try {
      const hexType = record.substring(7, 9);
      return parseInt(hexType, 16);
    } catch (e) {
      console.error("Get record type", e);
      return 0;
    }
  }

  /**
   * A function to search for an address in a hex file
   * @param address the address to search for
   * @return the index of the address. -1 if not found.
   */
  searchForAddress(address: number): number {
    let lastBaseAddr: number = 0;
    let data: string;

    // Iterate through
    for (let index = 0; index < this.hexLines.length; index++) {
      const line = this.hexLines[index];

      switch (this.getRecordType(line)) {
        case 2: {
          // Extended Segment Address
          data = this.getRecordData(line);
          if (data.length !== 4) {
            return -1;
          }
          const hi = parseInt(data.substring(0, 1), 16);
          const lo = parseInt(data.substring(1), 16);
          lastBaseAddr = hi * 0x1000 + lo * 0x10;
          if (lastBaseAddr > address) {
            return -1;
          }
          break;
        }

        case 4: {
          data = this.getRecordData(line);
          if (data.length !== 4) {
            return -1;
          }
          lastBaseAddr = parseInt(data, 16);
          lastBaseAddr *= 0x10000;
          if (lastBaseAddr > address) {
            return -1;
          }
          break;
        }

        case 0:
        case 0x0d: {
          if (address - lastBaseAddr < 0x10000n) {
            const a = lastBaseAddr + this.getRecordAddress(line);
            const n = this.getRecordDataLength(line) / 2; // bytes
            if (a <= address && a + n > address) {
              return index;
            }
          }
          break;
        }
      }
    }

    // Return -1 if no match
    return -1;
  }
}

export const forByteArray = (input: Uint8Array): HexUtils => {
  const text = new TextDecoder("utf-8").decode(input);
  const lines = text.split(/\r?\n/);

  // Remove the last empty line if the input ends with a newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return new HexUtils(lines);
};

/**
 * Record to byte Array
 * @param hexString string to convert
 * @param offset offset value
 * @param packetNum packet number
 * @return byteArray of hex
 */
export const recordToByteArray = (
  hexString: string,
  offset: number,
  packetNum: number
): DataView => {
  const len = hexString.length;
  const data = new Array(len / 2 + 4);

  for (let i = 0; i < len; i += 2) {
    data[i / 2 + 4] =
      (parseHexDigit(hexString[i]) << 4) + parseHexDigit(hexString[i + 1]);
  }

  // WRITE Command
  data[0] = 0x01;
  data[1] = (offset >> 8) & 0xff;
  data[2] = offset & 0xff;
  data[3] = packetNum & 0xff;
  // console.log('Sent:', data);
  return numbersToDataView(data);
};

function parseHexDigit(char: string): number {
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
  return 0; // or throw an error
}

export default HexUtils;
