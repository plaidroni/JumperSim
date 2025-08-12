import { WeatherSnapshot, fetchWeatherData } from "../../apidata/OpenMateo";
import Panel from "../Panel";
import { useRef } from "react";

interface WeatherProps {
    close: () => void
    minimize: () => void
    snapshot: WeatherSnapshot
}


function Weather(props: WeatherProps) {

    const toKnots = (mph: string) => {
        const number = parseFloat(mph);
        return Math.round(number / 1.15078);
    };

    const formatCell = (label: string, dirDeg: string, speedMph: string) => {
        return `${label}: ${dirDeg.replace("°", "°")} at ${toKnots(speedMph)} kts`;
    };

    const pressureToLabel: Record<string, string> = {
        "10m": "Surface",
        "1000hPa": "300 ft",
        "975hPa": "1200 ft",
        "950hPa": "2000 ft",
        "925hPa": "2500 ft",
        "900hPa": "3300 ft",
        "850hPa": "5000 ft",
        "800hPa": "6500 ft",
        "700hPa": "10000 ft",
        "600hPa": "14000 ft",
        "500hPa": "18000 ft",
    };

    let cells = []; // should this be state?
    if (props.snapshot) {
        for (const level of Object.keys(props.snapshot.windSpeeds)) {
            const label = pressureToLabel[level] || level;
            const direction = props.snapshot.windDirections[level] || "—";
            const speed = props.snapshot.windSpeeds[level] || "0 mph";

            cells.push(formatCell(label, direction, speed));
        }
    }
    

    return ( 
        <Panel
            title="Weather"
            close={props.close}
            minimize={props.minimize}>
            {props.snapshot && cells.map((cell, index) => (
                <div className="weather-datapoint-cell" key={index}>{cell}</div>
            ))}
            <p>Weather data is currently unavailable.</p>
        </Panel>
    );
}

export default Weather;