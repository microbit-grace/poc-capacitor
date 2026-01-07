import {
  createWebBluetoothConnection,
  createUniversalHexFlashDataSource,
  type FlashProgressCallback
} from '@microbit/microbit-connection';

export async function flash(
  deviceName: string,
  hexStr: string,
  progress: FlashProgressCallback
): Promise<void> {
  const connection = createWebBluetoothConnection();

  try {
    await connection.initialize();
    connection.setNameFilter(deviceName);  // Just the pattern, e.g., "ABC"

    const dataSource = createUniversalHexFlashDataSource(hexStr);

    await connection.flash(dataSource, {
      progress,
      partial: true
    });
  } finally {
    connection.dispose();
  }
}

// Re-export types for convenience
export { FlashProgressStage, DeviceError, FlashDataError } from '@microbit/microbit-connection';
