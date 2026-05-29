import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter"; // self-hosted Inter (works offline on the floor)
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
