import { createContext, StrictMode, useContext, useState } from "react";
import { Canvas, ThreeElement, extend, useFrame } from "@react-three/fiber";
import Jumper from "./components/entities/Jumper";

import { useErrorBoundary } from 'use-error-boundary';
import * as THREE from 'three';

import Jumpzone from './components/entities/Jumpzone'

// extend third-party three addons, see https://r3f.docs.pmnd.rs/api/typescript#extend-usage
import { PerspectiveCamera, OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";

// this needs to get moved to another file
// export const scale = createContext(1);

function App() {
  const { ErrorBoundary, didCatch, error } = useErrorBoundary();

  // state
  const [plane, currentPlane] = useState(null);
  const [jumpers, setJumpers] = useState<Jumper[]>([]);
  const [dropzone, setDropzone] = useState(null); // this can be it's own type

  const [debug, setDebug] = useState(true);
  
  const mapRotation = -Math.PI / 2;
  return (
    <ErrorBoundary>
      <Canvas camera={{ fov: 50, position: [0, 300, 0], far: 100000 }}>
        {/* lighting and controls */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        
        <PerspectiveCamera />
        <OrbitControls makeDefault/>
        
        {debug && 
        <GizmoHelper
          alignment="bottom-right">
          <GizmoViewport />
        </GizmoHelper>}        

        {/* Scene objects */}
        <gridHelper args={[4618, 16]} />

        {/* basic map, TODO: move to component file */}
        <mesh rotation={[-Math.PI / 2, 0,0]}>
          <planeGeometry args={[4618, 4618]} />
          <meshBasicMaterial wireframe></meshBasicMaterial>
        </mesh>

        {/* Plane */}
        <Jumper index={0} />
      </Canvas>  
    </ErrorBoundary>
  );
}

export default App;