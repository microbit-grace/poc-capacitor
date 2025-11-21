import { useState } from "react";

const ledGridLetters: string[][] = [
  ["t", "a", "t", "a", "t"],
  ["p", "e", "p", "e", "p"],
  ["g", "i", "g", "i", "g"],
  ["v", "o", "v", "o", "v"],
  ["z", "u", "z", "u", "z"],
];

interface BluetoothPatternInputProps {
  onDeviceNameChange: (deviceName: string) => void;
}

const BluetoothPatternInput = ({
  onDeviceNameChange,
}: BluetoothPatternInputProps) => {
  const [deviceChars, setDeviceChars] = useState<string[]>(Array(5).fill(""));
  const [activeRows, setActiveRows] = useState<number[]>(Array(5).fill(5));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 50px)",
        gridTemplateRows: "repeat(6, 50px)",
        width: "100%",
        height: "100%",
        gap: "0.5rem",
        justifyContent: "center",
      }}
    >
      {ledGridLetters.map((row, rowIdx) =>
        row.map((letter, colIdx) => {
          return (
            <button
              key={`${rowIdx}${colIdx}`}
              style={{
                width: "100%",
                height: "100%",
                padding: 0,
                backgroundColor:
                  rowIdx >= activeRows[colIdx] ? "gray" : "white",
                borderColor: "gray",
                borderWidth: "2px",
                outline: "none",
              }}
              onClick={() => {
                const newActiveRows = [...activeRows];
                newActiveRows[colIdx] = rowIdx;
                setActiveRows(newActiveRows);

                const newDeviceChars = [...deviceChars];
                newDeviceChars[colIdx] = letter;
                setDeviceChars(newDeviceChars);
                onDeviceNameChange(newDeviceChars.join(""));
              }}
            />
          );
        })
      )}
      {deviceChars.map((c, ci) => (
        <p key={ci} style={{ fontSize: "1.5rem", fontWeight: "bold" }}>
          {c}
        </p>
      ))}
    </div>
  );
};

export default BluetoothPatternInput;
