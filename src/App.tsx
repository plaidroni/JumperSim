import { createContext, StrictMode, useContext, useState } from "react";
import { Canvas, ThreeElement, extend, useFrame } from "@react-three/fiber";
import { Jumper } from "./js/classes/BaseEntities";
import { useErrorBoundary } from 'use-error-boundary';
import * as THREE from 'three';

import Jumpzone from './components/entities/Jumpzone'

// extend third-party three addons, see https://r3f.docs.pmnd.rs/api/typescript#extend-usage
import { OrbitControls } from "@react-three/drei";

// this needs to get moved to another file
// export const scale = createContext(1);

function App() {
  const { ErrorBoundary, didCatch, error } = useErrorBoundary();

  // state
  const [plane, currentPlane] = useState(null);
  const [jumpers, setJumpers] = useState<Jumper[]>([]);
  const [dropzone, setDropzone] = useState(null); // this can be it's own type

  const mapRotation = -Math.PI / 2;
  return (
      <Canvas camera={{ position: [0, 108, 30], far: 10000 }}>
        {/* lighting and controls */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <OrbitControls />

        {/* Scene objects */}
        <gridHelper args={[4618, 16]} />
        <axesHelper args={[5]} />

        {/* basic map, TODO: move to component file */}
        <mesh rotation={[-Math.PI / 2, 0,0]}>
          <planeGeometry args={[4618, 4618]} />
          <meshBasicMaterial wireframe></meshBasicMaterial>
        </mesh>
      </Canvas>  
  );
}

export default App;