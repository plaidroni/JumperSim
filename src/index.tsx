import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from "./App";
import './styles.css'

createRoot(document.getElementById("root")!).render(
        <App/>
    );