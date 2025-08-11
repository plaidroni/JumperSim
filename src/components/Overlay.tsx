import '../css/minimized-windows.css'
import '../css/devconsole.css'
import Panel from './Panel';
import { useState } from 'react';

enum PanelVis {
    ACTIVE,
    MINIMIZED,
    CLOSED
} 

export default function Overlay() {
    // panel states
    const [playbackVis, setPlaybackVis] = useState(PanelVis.ACTIVE);
    const [weatherVis, setWeatherVis] = useState(PanelVis.CLOSED);
    const [locationVis, setLocationVis] = useState(PanelVis.CLOSED);
    const [planeSettingsVis, setPlaneSettingsVis] = useState(PanelVis.CLOSED);
    const [speedSettingsVis, setSpeedSettingsVis] = useState(PanelVis.CLOSED);
    const [jumpSettingsVis, setJumpSettingsVis] = useState(PanelVis.CLOSED);
    const [sceneObjVis, setSceneObjVis] = useState(PanelVis.MINIMIZED);
    const [followingVis, setFollowingVis] = useState(PanelVis.ACTIVE);

    return (
        <>
            
        </>
    )
    
}

function saveOverlayInfo() {

}