import { createWebBluetoothConnection } from "@microbit/microbit-connection";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./App.css";
import HomeScreen from "./components/HomeScreen";
import MakeCodeView from "./components/MakeCodeView";
import ConnectionProvider from "./components/ConnectionProvider";

const connection = createWebBluetoothConnection();

function App() {
  return (
    <ConnectionProvider connection={connection}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/makecode" element={<MakeCodeView />} />
        </Routes>
      </BrowserRouter>
    </ConnectionProvider>
  );
}

export default App;
