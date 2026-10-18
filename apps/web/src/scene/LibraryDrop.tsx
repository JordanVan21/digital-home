import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { Plane, Raycaster, Vector2, Vector3 } from "three";
import { topContactFaces, insidePoint } from "@house/scene-engine";
import { editor } from "../state/editor";
export function LibraryDrop(){const {camera,gl}=useThree();useEffect(()=>{
 const ray=new Raycaster(),plane=new Plane(new Vector3(0,1,0)),hit=new Vector3();
 const project=(x:number,y:number)=>{const bounds=gl.domElement.getBoundingClientRect();ray.setFromCamera(new Vector2((x-bounds.left)/bounds.width*2-1,-(y-bounds.top)/bounds.height*2+1),camera);
 const room=editor.context().room;let result: [number,number,number] | undefined;let nearest=Infinity;
 const faces=[{heightY:room.floor.elevationY,polygonXZ:room.floor.polygonXZ},...editor.working().objects.flatMap(o=>topContactFaces(o,editor.context().assets))];
 for(const face of faces){plane.constant=-face.heightY;if(!ray.ray.intersectPlane(plane,hit)||!insidePoint([hit.x,hit.z],face.polygonXZ))continue;const distance=hit.distanceTo(ray.ray.origin);if(distance<nearest){nearest=distance;result=[hit.x,hit.y,hit.z];}}
 return result;
 };editor.motion.dropPoint=project;return()=>{if(editor.motion.dropPoint===project)editor.motion.dropPoint=undefined;};},[camera,gl]);return null;}
