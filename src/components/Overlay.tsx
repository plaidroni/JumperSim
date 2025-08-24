import '../css/minimized-windows.css'
import '../css/devconsole.css'

import { useState } from 'react';

// import all panels
import Following from './panels/Following'
import Playback from './panels/Playback'
import Location from './panels/Location';
import JumpSettings from './panels/JumpSettings'
import Objects from './panels/Objects'
import PlaneSettings from './panels/PlaneSettings'
import SpeedSettings from './panels/SpeedSettings';
import Weather from './panels/Weather'

// const panels = import.meta.glob() // dynamic import sounds fun, but I will make sure tab visibility works fine

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
            <Playback />
            <Following />
            <Location />
            <Weather></Weather>
            <Objects></Objects>

            <PlaneSettings></PlaneSettings>
            <SpeedSettings></SpeedSettings>
            <JumpSettings></JumpSettings>
        </>
    )
    
}



function saveOverlayInfo() {

}