import "server-only";
import {RequestSecurityError} from './request-security';
type Waiting={resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
const globals=globalThis as typeof globalThis & {offerlyAssessmentCapacity?:{running:number;waiting:Waiting[]}};
const capacity=globals.offerlyAssessmentCapacity??={running:0,waiting:[]};
async function acquire(){
 if(capacity.running<2){capacity.running++;return;}
 if(capacity.waiting.length>=16)throw new RequestSecurityError('Сейчас много проверок. Повторите действие через несколько секунд',429);
 await new Promise<void>((resolve,reject)=>{
  const item:Waiting={resolve,reject,timer:setTimeout(()=>{capacity.waiting=capacity.waiting.filter(x=>x!==item);reject(new RequestSecurityError('Сейчас много проверок. Повторите действие через несколько секунд',429));},15000)};
  item.timer.unref?.();capacity.waiting.push(item);
 });
}
/** Keep large private assessment snapshots bounded; waiting bodies are already capped by the API. */
export async function withAssessmentCapacity<T>(operation:()=>Promise<T>):Promise<T>{
 await acquire();
 try{return await operation();}
 finally{const next=capacity.waiting.shift();if(next){clearTimeout(next.timer);next.resolve();}else capacity.running--;}
}
