import type { Role } from "./model";
export function workspaceReturnTo(value:string|undefined|null, role:Role) {
  if(!value||value.length>2000||value.includes("\\"))return `/demo/${role}/overview`;
  try {
    const url=new URL(value,"https://local.invalid");
    if(url.origin==="https://local.invalid"&&url.pathname.startsWith(`/demo/${role}/`))
      return url.pathname+url.search;
  }catch{}
  return `/demo/${role}/overview`;
}
