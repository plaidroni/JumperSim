import { createContext, StrictMode, useContext, useState } from "react";
import Overlay from "./components/Overlay";
import { Canvas, ThreeElement, extend, useFrame } from "@react-three/fiber";
import { Jumper } from "./js/classes/BaseEntities";
import { SimulationTimeProvider } from "./context/SimulationTimeContext";
import { useErrorBoundary } from 'use-error-boundary';
import * as THREE from 'three';

import Jumpzone from './components/entities/Jumpzone'

// extend third-party three addons, see https://r3f.docs.pmnd.rs/api/typescript#extend-usage
import { OrbitControls } from "@react-three/drei";

export const scale = createContext(1);

// Scene component that uses simulation time
function Scene() {
  const [scene] = useState(() => new THREE.Scene());
  
  return (
    <>
      
    </>
  );
}

function App() {
  const { ErrorBoundary, didCatch, error } = useErrorBoundary();

  // state
  const [plane, currentPlane] = useState(null);
  const [jumpers, setJumpers] = useState<Jumper[]>([]);

  const Camera = new THREE.Camera
  return (
      <Canvas camera={{ position: [0, 108, 30] }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <mesh>
          <boxGeometry args={[2, 2, 2]} />
          <meshPhongMaterial />
        </mesh>
        <OrbitControls />
        <axesHelper args={[5]} />
      </Canvas>  
  );
}

export default App;