import { AppController } from "./features/app";
import { HashRouter } from "react-router-dom";

export default function App() {
  return (
    <HashRouter>
      <AppController />
    </HashRouter>
  );
}
