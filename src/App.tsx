import { Capacitor } from "@capacitor/core";
import { MakeCodeFrame, MakeCodeProject } from "@microbit/makecode-embed";
import { ReactNode, useCallback, useMemo, useState } from "react";
import "./App.css";
import Flasher from "./flashing/flashing";
import { FlashProgressStage, FlashResult, Progress } from "./flashing/model";
import Bluetooth from "./flashing/bluetooth";
import FullFlasher from "./flashing/flashingFull";
import Dfu from "./flashing/dfu";

const starterProject = {
  text: {
    "main.blocks":
      '<xml xmlns="https://developers.google.com/blockly/xml"><variables></variables><block type="pxt-on-start" x="20" y="20"><statement name="HANDLER"><block type="basic_show_icon"><field name="i">IconNames.Heart</field></block></statement></block></xml>',
    "main.ts": "basic.showIcon(IconNames.Heart)\n",
    "README.md": " ",
    "pxt.json":
      '{\n    "name": "Untitled",\n    "dependencies": {\n        "core": "*"\n , "radio": "*"\n     },\n    "description": "",\n    "files": [\n        "main.blocks",\n        "main.ts",\n        "README.md"\n    ],\n    "preferredEditor": "blocksprj"\n}',
  },
} as MakeCodeProject;

type Step =
  | {
      name: "initial" | "pair-mode" | "enter-pattern";
    }
  | {
      name: "flashing";
      message: string;
      progress?: number;
    }
  | {
      name: "flash-error";
      message: string;
    };

function App() {
  const flasher = useMemo(
    () => new Flasher(new Bluetooth(), new FullFlasher(new Dfu())),
    []
  );
  const platform = Capacitor.getPlatform();
  const [open, setOpen] = useState<boolean>(false);
  const [step, setStep] = useState<Step>({ name: "initial" });
  const [hex, setHex] = useState<null | { name: string; hex: string }>(null);

  const initialProject = useCallback(async () => [starterProject], []);
  const handleClose = useCallback(() => {
    setOpen(false);
    setStep({ name: "initial" });
  }, []);
  const updateStep: Progress = useCallback((progressStage, progress) => {
    const message = {
      [FlashProgressStage.Initialize]: "Checking permissions",
      [FlashProgressStage.FindDevice]: "Finding device",
      [FlashProgressStage.Bond]: "Pairing",
      [FlashProgressStage.Connecting]: "Connecting",
      [FlashProgressStage.Partial]: "Sending code",
      [FlashProgressStage.Full]:
        "Sending code. This can take a while the first time but it will be quicker after that.",
      [FlashProgressStage.Complete]: "Successfully downloaded",
      [FlashProgressStage.Cancelled]: "Cancelled",
      [FlashProgressStage.Failed]: "Failed",
    }[progressStage];
    setStep({ name: "flashing", progress, message });
  }, []);

  const handleDownload = useCallback(
    async (download: { name: string; hex: string }) => {
      setOpen(true);
      setHex(download);
    },
    []
  );

  const handleFlash = useCallback(async () => {
    if (!hex) {
      throw new Error("No hex file to flash");
    }
    const flashResult = await flasher.flash(hex.hex, updateStep);
    if (flashResult === FlashResult.Success) {
      updateStep(FlashProgressStage.Complete);
      return;
    }
    const errorMessage = {
      [FlashResult.MissingPermissions]:
        "The app requires Bluetooth permissions.",
      [FlashResult.BluetoothDisabled]:
        "Please enable Bluetooth in the Settings app.",
      [FlashResult.DeviceNotFound]:
        "Failed to find a micro:bit that matches the pattern you entered. Please try again.",
      [FlashResult.FailedToConnect]:
        "Failed to connect to your micro:bit. Please try again and ensure your micro:bit is showing the pattern and your phone has Bluetooth enabled.",
      [FlashResult.InvalidHex]: "The program (.hex) is invalid.",
      [FlashResult.PartialFlashFailed]:
        "Partial flashing failed. Please try again. If that fails, program the micro:bit from a computer with a USB cable then try again with the app.",
      [FlashResult.FullFlashFailed]:
        "Full flashing failed. Please try again. If that fails, program the micro:bit from a computer with a USB cable then try again with the app.",
      [FlashResult.Cancelled]: "Cancelled",
    }[flashResult];

    setStep({
      name: "flash-error",
      message: errorMessage,
    });
  }, [flasher, hex, updateStep]);

  if (platform === "web") {
    return (
      <div style={{ textAlign: "left", padding: "2rem" }}>
        <h1 style={{ fontSize: 20 }}>Cannot preview app on the web</h1>
        <div>
          <p>
            You are currently viewing this app on the web. Please preview the
            app on mobile instead.
          </p>
          <p>
            We have only implemented bluetooth flashing of the micro:bit via a
            mobile device.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ height: "90%", width: "100%" }}>
        <MakeCodeFrame
          style={{ height: "100%", width: "100%" }}
          controller={2}
          loading="eager"
          initialProjects={initialProject}
          onDownload={handleDownload}
        />
      </div>
      {open && (
        <div
          role="dialog"
          style={{
            display: "flex",
            flexDirection: "column",
            height: "90%",
            width: "100%",
            position: "absolute",
            top: 0,
            background: "white",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              height: "100%",
              position: "relative",
            }}
          >
            {step.name === "initial" && (
              <Content
                heading="Send to micro:bit"
                onClose={handleClose}
                cta={{
                  text: "Send",
                  onClick: () => setStep({ name: "pair-mode" }),
                }}
              >
                <p>Do you want to send this program to your micro:bit?</p>
              </Content>
            )}
            {step.name === "pair-mode" && (
              <Content
                heading="Ready to pair"
                onClose={handleClose}
                cta={{
                  text: "My micro:bit shows a pattern",
                  onClick: () => handleFlash(),
                }}
              >
                <p>Press reset on the micro:bit three times.</p>
                <p>
                  If your micro:bit has not been updated in a while, hold button
                  A and B and press reset.
                </p>
              </Content>
            )}
            {step.name === "flashing" && (
              <Content
                heading="Downloading"
                cta={{
                  text: "Finished",
                  onClick: handleClose,
                  disabled: step.message !== "Successfully downloaded",
                }}
              >
                {step.progress && <p>Progress: {step.progress} %</p>}
                <p>{step.message}</p>
              </Content>
            )}
            {step.name === "flash-error" && (
              <Content
                heading="Sending your program failed"
                onClose={handleClose}
                cta={{
                  text: "Try again",
                  onClick: () => setStep({ name: "pair-mode" }),
                }}
              >
                <p>{step.message}</p>
              </Content>
            )}
          </div>
        </div>
      )}
    </>
  );
}

interface ContentProps {
  heading: string;
  children: ReactNode;
  cta?: { text: string; onClick: () => void; disabled?: boolean };
  onClose?: () => void;
}

const Content = ({ heading, children, cta, onClose }: ContentProps) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        height: "100%",
        position: "relative",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: 20 }}>{heading}</h1>
      <div>{children}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {cta && (
          <button
            onClick={cta.onClick}
            disabled={cta.disabled ?? false}
            style={{
              display: "flex",
              gap: "10px",
              width: "100%",
              justifyContent: "center",
              backgroundColor: "black",
              color: "white",
              opacity: cta.disabled ? 0.2 : 1,
            }}
          >
            {cta.text}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              display: "flex",
              gap: "10px",
              width: "100%",
              justifyContent: "center",
            }}
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
};

export default App;
