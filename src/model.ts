export enum FlashResult {
  MissingPermissions = "MissingPermissions",
  BluetoothDisabled = "BluetoothDisabled",
  Success = "Success",
  DeviceNotFound = "DeviceNotFound",
  FailedToConnect = "FailedToConnect"
}

export enum FlashProgressStage {
  Initialize = "Initialize",
  FindDevice = "FindDevice",
  Bond = "Bond",
  Connecting = "Connecting",
  Partial = "Partial",
  Full = "Full",
  Complete = "Complete",
}

export enum DeviceVersion {
  V1 = "V1",
  V2 = "V2"
}

export type Progress = (progressStage: FlashProgressStage, progress?: number) => void;
