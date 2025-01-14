import { useCallback, useState } from "react";
import "./App.css";
import { MakeCodeFrame, Project } from "@microbit/makecode-embed/react";

const starterProject = {
  text: {
    "main.blocks":
      '<xml xmlns="http://www.w3.org/1999/xhtml">\n  <variables></variables>\n</xml>',
    "main.ts": "\n",
    "README.md": " ",
    "pxt.json":
      '{\n    "name": "Untitled",\n    "dependencies": {\n        "core": "*"\n , "radio": "*"\n     },\n    "description": "",\n    "files": [\n        "main.blocks",\n        "main.ts",\n        "README.md"\n    ],\n    "preferredEditor": "blocksprj"\n}',
  },
} as Project;

function App() {
  const [open, setOpen] = useState<boolean>(false);
  const initialProject = useCallback(async () => [starterProject], []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);
  const flashMicrobit = useCallback(
    (download: { name: string; hex: string }) => {
      console.log(download);
      setOpen(true);
    },
    []
  );

  return (
    <>
      <dialog open={open} onCancel={handleClose}>
        <h1 style={{ fontSize: 20 }}>Flash micro:bit?</h1>
        <div style={{ display: "flex", gap: "10px" }}>
          <button>Connect to micro:bit</button>
          <button onClick={handleClose}>Close</button>
        </div>
      </dialog>
      <MakeCodeFrame
        style={{ height: "100%" }}
        controller={2}
        loading="eager"
        initialProjects={initialProject}
        onDownload={flashMicrobit}
      />
    </>
  );
}

export default App;
