import { it, expect } from "vitest";
import { createEditor } from "./editor";
import { fixtureId } from "@house/contracts";
it("keeps explicitly floating height through Accept and restores nearest-surface settling when disabled",()=>{
 const e=createEditor();const id=fixtureId(111);e.select(id);const o=e.selected()!;
 e.suggest({type:"setFloat",objectId:id,float:true});
 e.suggest({type:"move",objectId:id,transform:{...o.transform,position:[.2,.731,1.75]}},{snap:false});
 expect(e.accept()).toBe(true);expect(e.selected()?.transform.position[1]).toBe(.731);
 e.suggest({type:"setFloat",objectId:id,float:false});expect(e.accept()).toBe(true);expect(e.selected()?.transform.position[1]).toBe(0);e.dispose();
});
it("floating still checks bounds and collisions, and never carries a former supported child",()=>{
 const e=createEditor();const id=fixtureId(111),o=e.working().objects.find(o=>o.id===id)!;
 const child={...structuredClone(o),id:fixtureId(999),dimensionsM:[.1,.1,.1] as [number,number,number],placement:{support:"object" as const,parentId:id,float:true},transform:{...o.transform,position:[.2,.6,1.75] as [number,number,number]}};
 e.scene.setState({scene:{...e.working(),objects:[o,child]}});e.select(id);e.motion.cameraDirection=[1,0,0];e.nudge(1,0);expect(e.working().objects.find(o=>o.id===child.id)!.transform.position).toEqual(child.transform.position);e.dispose();
});
