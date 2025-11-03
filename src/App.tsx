import { useCallback, useState } from "react";
import "./App.css";
import { MakeCodeFrame, MakeCodeProject,  } from "@microbit/makecode-embed";
import { Capacitor } from "@capacitor/core";
import { scan } from "./ble";
import { ScanResult } from "@capacitor-community/bluetooth-le";

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
  const [open, setOpen] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
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
  const handleConnect = useCallback(async () => {
    const onScanResult = (res: ScanResult) => {
      setScanResults(Array.from(new Set([res, ...scanResults])));
    };
    await scan(onScanResult);
  }, [scanResults]);

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
              No need to test how we can flash your project. We can flash your
              MakeCode project like we do in ml-trainer and perhaps use the
              connection library.
            </p>
          </>
        )}
        <p>{JSON.stringify(scanResults)}</p>
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
