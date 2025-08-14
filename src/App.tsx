import { useState } from "react";
import Overlay from "./components/Overlay";
import { Canvas } from "@react-three/fiber";
import { Jumper } from "./js/classes/BaseEntities";


import { useErrorBoundary } from 'use-error-boundary';

function App() {

  const { ErrorBoundary, didCatch, error } = useErrorBoundary();
  // maybe worth to use 
  // state
  const [plane, currentPlane] = useState(null);
  const [jumpers, setJumpers] = useState<Jumper>(null);
    

  return (<>
    <Overlay />
    <ErrorBoundary>
      <Canvas>

      </Canvas>
    </ErrorBoundary>
  </>);
}

export default App;