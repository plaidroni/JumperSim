import { SimJumper } from "../../js/classes/SimEntities";
import * as BaseEntities from "../../js/classes/BaseEntities";
import TrajectoryLine from "./trajectoryLine";
import { KinematicTrack } from "../../js/Kinematics";

import { useState, useRef, Suspense, Key, useEffect } from "react";
import { STLLoader } from "three/examples/jsm/Addons.js";
import { useLoader } from "@react-three/fiber";
import { createPortal } from "react-dom";


type ColorRGB = [number, number, number];

// atm this is a straight port from Base Jumper
interface JumperProps {
    index: Key
    plane: BaseEntities.Plane
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

    const color = useRef<ColorRGB>([Math.random(), Math.random(), Math.random()]);
    const loadProgress = useRef<number>(0);
    const [track, setTrack] = useState<KinematicTrack>(new KinematicTrack());

    // TODO: on mount, calculate trajectory 
    useEffect(() => {
        // TODO: move precalculate logic into here.
        // setTrack(magic)

        // return cleanup function if needed
    }, [track]);

    function DiverModel() {
        // this puts suspense on the object
        const model = useLoader(STLLoader, 'fabs/skydiver_fix.stl', undefined, (e) => {
            loadProgress.current = e.loaded / e.total;
        });
        return <primitive object={model} />
    }

    // show the jumper's settings when it's (clicked, double clicked?)
    function JumperPanel() {
        return createPortal(
        <>
        
        </>,
        document.body,
        props.index
        );
    }

    //
    return ( 
        <mesh position={[0, 0, 0]}>
            <meshBasicMaterial wireframe color={color.current}/>
            <Suspense fallback={null}>
                <DiverModel/>
            </Suspense>
            <TrajectoryLine track={track}/>
            
            {/* trajectoryLine samples=[jumper.samples] */}
        </mesh>
     );
}

export default Jumper;