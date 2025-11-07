import { Capacitor } from "@capacitor/core";
import { MakeCodeFrame, MakeCodeProject } from "@microbit/makecode-embed";
import { useCallback, useMemo, useState } from "react";
import "./App.css";
import BluetoothAndroid from "./bluetoothAndroid";
import Flasher from "./flasher";
import { Progress } from "./model";

const starterProject = {
  text: {
    "main.blocks":
      '<xml xmlns="http://www.w3.org/1999/xhtml">\n  <variables></variables>\n</xml>',
    "main.ts": "\n",
    "README.md": " ",
    "pxt.json":
      '{\n    "name": "Untitled",\n    "dependencies": {\n        "core": "*"\n , "radio": "*"\n     },\n    "description": "",\n    "files": [\n        "main.blocks",\n        "main.ts",\n        "README.md"\n    ],\n    "preferredEditor": "blocksprj"\n}',
  },
} as MakeCodeProject;

function App() {
  const ble = useMemo(() => new BluetoothAndroid(), []);
  const flasher = useMemo(() => new Flasher(ble), [ble]);

  const [open, setOpen] = useState<boolean>(false);
  const [message, setMessage] = useState<string>(
    "Triple tap reset button to enter Bluetooth pairing mode."
  );

  const initialProject = useCallback(async () => [starterProject], []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);
  const handleDownload = useCallback(
    (download: { name: string; hex: string }) => {
      console.log(download);
      setOpen(true);
    },
    []
  );
  const handleProgress: Progress = useCallback((progressStage) => {
    setMessage(progressStage)
  }, [])
  const handleConnect = useCallback(async () => {
    const flashResult = await flasher.flash(handleProgress)
    setMessage(flashResult)
  }, [flasher, handleProgress]);

  return (
    <>
      <dialog
        open={open}
        onCancel={handleClose}
        style={{ maxWidth: "80%", textAlign: "left" }}
      >
        <h1 style={{ fontSize: 20 }}>Flash micro:bit?</h1>
        {Capacitor.getPlatform() === "web" && (
          <>
            <p>You are currently viewing this app on the web.</p>
            <p>
              No need POC. We can flash your MakeCode project via the connection
              library.
            </p>
          </>
        )}
        <p>{message}</p>
        <div style={{ display: "flex", gap: "10px" }}>
          {Capacitor.getPlatform() !== "web" && (
            <button onClick={handleConnect}>Connect to micro:bit</button>
          )}
          <button onClick={handleClose}>Close</button>
        </div>
      </dialog>
      <MakeCodeFrame
        style={{ height: "100%" }}
        controller={2}
        loading="eager"
        initialProjects={initialProject}
        onDownload={handleDownload}
      />
    </>
  );
}

export default App;
