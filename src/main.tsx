import React from "react";
import { createRoot } from "react-dom/client";
import RunClub from "./RunClub";
import "./style.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><RunClub /></React.StrictMode>);
