import { useState, useRef } from "react";
import { KinematicTrack } from "../../js/Kinematics";

interface trajectoryLineProps {
    track: KinematicTrack;
}

function TrajectoryLine(props: trajectoryLineProps) {
    const [positions, setPositions] = useState<Float32Array>(new Float32Array(props.track.samples.length * 3));
    const renderedSamples = useRef(0);
    
    // it feels so wrong that, uh,, they are camelCase
    return (
        <line>
            <lineBasicMaterial color={[255,104,0]}/>
            <bufferGeometry drawRange={{ start: 0, count: renderedSamples.current }}>
                <bufferAttribute attach="attributes-position" args={[positions,3]}/>
            </bufferGeometry>
        </line>
    )
}

// possible change after refactor: https://github.com/pmndrs/meshline
export default TrajectoryLine;