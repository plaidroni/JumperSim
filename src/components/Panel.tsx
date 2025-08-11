import { useRef } from 'react'
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
    const position = useRef(0);

    return ( 
        <div className="panel">
            <div 
                className="panel-header" 
                draggable="true"
                onDrag={handleDrag}
            >
                <h2>{props.title || 'Untitled'}</h2>
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

// update the panel position when the header is dragged
function handleDrag(e) {

}

