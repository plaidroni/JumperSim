import { useRef, useState } from 'react'
import '../css/devconsole.css'

interface PanelProps {
    title: string
    children: any   // todo: find out what this type is
                    // children is good and encouraged
    minimize: any
    close: any
}


// children accessed through,,, children
export default function Panel(props: PanelProps) {
    const [isDragging, setIsDragging] = useState(false);
    let dragOffset = useRef({x: 0, y: 0});
    let [pos, setPos] = useState({x: 100, y: 100});

    function handleMouseDown(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        // get the offset from the top corner
        dragOffset.current.x = event.clientX - pos.x
        dragOffset.current.y = event.clientY - pos.y
        setIsDragging(true);        
    }

    function handleMouseMove(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        if (isDragging) {
            let newPos = {x: 0, y: 0};
            newPos.x = event.clientX - dragOffset.current.x;
            newPos.y = event.clientY - dragOffset.current.y;
            setPos(newPos); // i think there's a cleaner looking way to do this
        }
    }

    function handleMouseUp(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        if (isDragging) {
            setIsDragging(false);
        }
    }

    return ( 
        <div className="panel" style={{ position: 'absolute', left: pos.x, top: pos.y }}>
            <div 
                className="panel-header" 
                onMouseDown={e => handleMouseDown(e)}
                onMouseMove={e => handleMouseMove(e)}
                onMouseUp={e => handleMouseUp(e)}
            >
                <h2>{props.title}</h2>
                <div className="panel-controls">
                    {/* TODO: Add onclick actions for panels */}
                    <button onClick={props.minimize}>-</button>
                    <button onClick={props.close}>x</button>
                </div>
            </div>
            <div className="panel-body">
                { props.children }
            </div>
        </div>
    );
}