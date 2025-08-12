import { useEffect, useRef, useState } from 'react'
import '../css/devconsole.css'

interface PanelProps {
    title: string;
    children: React.ReactNode; 
    minimize: () => void;
    close: () => void;
}

export default function Panel(props: PanelProps) {
    const [isDragging, setIsDragging] = useState(false);
    let dragOffset = useRef({x: 0, y: 0});
    let panelRef = useRef<HTMLDivElement>(null);
    let posRef = useRef({x: 100, y: 100});
    let [pos, setPos] = useState({x: 100, y: 100});

    // to avoid funky behavior when the mouse escapes, add event listeners to the window
    useEffect(() => {
        if (!isDragging) return; 

        function handleMouseUp() {
            setIsDragging(false);
            setPos(posRef.current);
            // reset translate or else this will teleport
            if (panelRef.current) panelRef.current.style.transform = ''; 
        }

        function handleMouseMove(event: MouseEvent) {
            if (!panelRef.current) return; 

            let newPos = {x: 0, y: 0};
            newPos.x = event.clientX - dragOffset.current.x;
            newPos.y = event.clientY - dragOffset.current.y;
            // translate is the goat here
            panelRef.current.style.transform = `translate(${newPos.x - pos.x}px, ${newPos.y - pos.y}px)`;
            posRef.current = newPos;
        }
        
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp)

        // remove event listeners when isDragging ends
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

    }, [isDragging]);

    function handleMouseDown(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
        // get the offset from the top corner
        dragOffset.current.x = event.clientX - pos.x
        dragOffset.current.y = event.clientY - pos.y

        setIsDragging(true);        
    }

    return ( 
        <div className="panel" ref={panelRef} style={{ 
            position: 'absolute', 
            left: pos.x, top: 
            pos.y, 
            cursor: isDragging ? 'grabbing' : 'default' 
        }}>
            <div 
                className="panel-header" 
                onMouseDown={handleMouseDown}
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