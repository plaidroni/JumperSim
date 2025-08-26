// Backward compatibility shim: re-export PlaneLoad.render when imported as renderPlaneLoad
import { PlaneLoad } from "./PlaneLoad";
import { SimPlane } from "../classes/SimEntities";

export function renderPlaneLoad(currentPlane: SimPlane) {
  if (!(currentPlane as any).planeLoad) {
    (currentPlane as any).planeLoad = new (PlaneLoad as any)(currentPlane);
  }
  (currentPlane as any).planeLoad.render();
}
