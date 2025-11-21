export enum FlashResult {
  MissingPermissions = "MissingPermissions",
  BluetoothDisabled = "BluetoothDisabled",
  DeviceNotFound = "DeviceNotFound",
  FailedToConnect = "FailedToConnect",
  InvalidHex = "InvalidHex",
  FullFlashFailed = "FullFlashFailed",
  PartialFlashFailed = "PartialFlashFailed",
  Cancelled = "Cancelled",
  Success = "Success"
}

export enum FlashProgressStage {
  Initialize = "Initialize",
  FindDevice = "FindDevice",
  Bond = "Bond",
  Connecting = "Connecting",
  Partial = "PartialFlashing",
  Full = "FullFlashing",
  Complete = "Complete",
  Cancelled = "Cancelled",
  Failed = "Failed"
}

export enum DeviceVersion {
  V1 = "V1",
  V2 = "V2",
}

export type Progress = (
  progressStage: FlashProgressStage,
  progress?: number
) => void;

export type Step = {
  name: "initial" | "pair-mode" | "enter-pattern",
} | {
  name: "flashing",
  message: string,
  progress?: number
} | {
  name: "flash-error",
  message: string
}