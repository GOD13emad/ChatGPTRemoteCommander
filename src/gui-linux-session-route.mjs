import {execFileSync} from 'node:child_process';

// Only local, active, unlocked, same-UID logind user seats may select KDE.
// An environment hint or historical force flag cannot authorize another seat.
const kde=value=>/(?:^|:)(?:KDE|plasma)(?=:|$)/i.test(value??'');
const display=value=>/^:[0-9]{1,3}(?:\.[0-9]{1,2})?$/.test(value??'');
const blocked=()=>({backend:'blocked'});
export function resolveLinuxGuiBackend({env=process.env,uid=process.getuid?.(),
  run=execFileSync}={}){
  const hint=env.RC_FORCE_KDE_PORTAL==='1'||kde(
    [env.XDG_CURRENT_DESKTOP,env.XDG_SESSION_DESKTOP].filter(Boolean).join(':'));
  const matches=[];
  let sawKde=false;
  try{
    if(!Number.isSafeInteger(uid))return blocked();
    const options={encoding:'utf8',timeout:1200,maxBuffer:32768};
    const raw=run('/usr/bin/loginctl',['list-sessions','--no-legend','--no-pager'],options);
    const ids=raw.split('\n').map(l=>l.trim().split(/\s+/))
      .filter(([id,owner])=>String(uid)===owner&&/^[A-Za-z0-9]{1,12}$/.test(id));
    if(ids.length>8)return blocked();
    for(const [id] of ids){
      const raw=run('/usr/bin/loginctl',['show-session',id,'-p','Desktop','-p','Type',
        '-p','Active','-p','Remote','-p','Display','-p','Class','-p','Seat','-p','LockedHint'],options);
      const props=Object.fromEntries(raw.split('\n').filter(l=>l.includes('=')).map(l=>{
        const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];
      }));
      if(!kde(props.Desktop))continue;
      sawKde=true;
      if(props.Active!=='yes'||props.Remote!=='no'||props.Class!=='user'||
          !/^seat[0-9A-Za-z_-]{1,32}$/.test(props.Seat??'')||props.LockedHint!=='no'||
          !['x11','wayland'].includes(props.Type))continue;
      matches.push({id,props});
    }
  }catch{return hint||sawKde?blocked():{backend:'gnome'};}
  if(!hint&&!sawKde)return {backend:'gnome'};
  if(matches.length!==1)return blocked();
  const [{id,props}]=matches;
  if(env.XDG_SESSION_ID&&env.XDG_SESSION_ID!==id)return blocked();
  if(env.XDG_SESSION_TYPE&&env.XDG_SESSION_TYPE.toLowerCase()!==props.Type)return blocked();
  if(props.Type==='x11'){
    if(!display(props.Display)||env.WAYLAND_DISPLAY||
        (env.DISPLAY&&env.DISPLAY!==props.Display))return blocked();
    return {backend:'kde-x11-readonly',sessionId:id,display:props.Display};
  }
  return {backend:'kde-wayland',sessionId:id,display:props.Display??''};
}
