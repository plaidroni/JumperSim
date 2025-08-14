import { createRoot} from '@react-three/fiber';
import { StrictMode } from 'react';
import App from "./App";

createRoot(document.getElementById("app")!)
    .render(
        <StrictMode>
            <App/>
        </StrictMode>
    );