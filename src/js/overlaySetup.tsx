import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Overlay from "../components/Overlay";

export function initializeOverlay() {
    const overlayRoot = createRoot(document.getElementById('overlay')!);
    
    overlayRoot.render(
        <StrictMode>
            <Overlay />
        </StrictMode>
    );
}
