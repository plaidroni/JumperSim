import { SimJumper } from "../../js/classes/SimEntities";
import * as BaseEntities from "../../js/classes/BaseEntities";
import TrajectoryLine from "./trajectoryLine";
import { KinematicTrack } from "../../js/Kinematics";

import { MathUtils, MeshBasicMaterial } from "three";

import { useState, useRef, Suspense, Key, useEffect } from "react";
import { STLLoader } from "three/examples/jsm/Addons.js";
import { useLoader, useFrame, extend } from "@react-three/fiber";
import { createPortal } from "react-dom";
import Panel from "../Panel";
import { useControls } from 'leva';

type ColorRGB = [number, number, number];

// atm this is a straight port from Base Jumper
interface JumperProps {
    index: Key
    isPlaying?: boolean
    plane?: BaseEntities.Plane
    jumpInterval?: number
    deployDelay?: number
    canopySize?: number
    weight?: number
    extraWeight?: number
    suitType?: BaseEntities.SuitType;
    flyingStyle?: BaseEntities.FlyingStyle;

}



// TODO: jumper component calculates position based on input data (wind, timing), holds trajectory
function Jumper(props: JumperProps) {

    const loadProgress = useRef<number>(0);
    const track = useRef<KinematicTrack>(new KinematicTrack());
    const panel = useRef(true);
    const meshRef = useRef(null);
    const materialRef = useRef<MeshBasicMaterial | null>(null);

    // changing any of these values causes the object to disappear
    const color = useControls({
        // color: {
        //     value: [200, 10, 10],
        //     // onChange: (v) => {
        //     //     if (materialRef.current) {
        //     //         materialRef.current.color = v;
        //     //     }
        //     // },
        //     transient: false
        // }
    })

    const interpolation = 0.1;

    useFrame((state, delta) => {
        if (!meshRef.current) return;

        // materialRef.current.color = color;
        meshRef.current.position.x = MathUtils.lerp(meshRef.current.position.x, true ? Math.sin(state.clock.elapsedTime) * 50 : 0, interpolation);
        meshRef.current.position.y = MathUtils.lerp(meshRef.current.position.y, true ? Math.cos(state.clock.elapsedTime) * 50 : 0, interpolation);
        // meshRef.current.position.z = MathUtils.lerp(meshRef.current.position.z, true ? Math.sin(state.clock.elapsedTime) * 50 : 0, interpolation);
    });

    // TODO: on mount, calculate trajectory 
    useEffect(() => {
        // TODO: move precalculate logic into here.
        // setTrack(magic)

        // return cleanup function if needed
    }, []);

    function DiverModel() {
        // this puts suspense on the object
        const model = useLoader(STLLoader, 'fabs/skydiver_fix.stl');
        return <primitive object={model} />
    }

    // show the jumper's settings when it's (clicked, double clicked?)
    function JumperPanel() {
        return (
        <Panel>
            <p>Test item</p>
        </Panel>
        )
    }

    //
    return ( 
        <mesh position={[0,0,0]} ref={meshRef}>
            <meshBasicMaterial wireframe ref={materialRef} color={color.value}/>
            <Suspense fallback={null}>
                <DiverModel/>
            </Suspense>
            {/* {panel && createPortal(<JumperPanel />,
            document.body,
            props.index)} */}
            {/* <TrajectoryLine track={track}/> */}
        </mesh>
     );
}

export default Jumper;