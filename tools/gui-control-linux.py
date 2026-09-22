#!/usr/bin/env python3
import base64, json, os, sys
import gi
gi.require_version('Gio','2.0')
gi.require_version('GLib','2.0')
gi.require_version('GdkPixbuf','2.0')
from gi.repository import Gio, GLib, GdkPixbuf

DEST='org.gnome.Shell'
PATH='/org/gnome/Shell/Extensions/ChatGPTRemoteCommander'
IFACE='org.gnome.Shell.Extensions.ChatGPTRemoteCommander'
TOKEN_PATH=os.path.join(os.environ.get('XDG_CONFIG_HOME',os.path.expanduser('~/.config')),'chatgpt-remote-commander','gui-extension-token')

def guierr(code):
    return {'ok':False,'error':code}

def token():
    try:
        with open(TOKEN_PATH,'r',encoding='utf-8') as f:
            value=f.read().strip()
        if len(value) < 32:
            raise ValueError()
        return value
    except Exception:
        return None

def proxy():
    return Gio.DBusProxy.new_for_bus_sync(
        Gio.BusType.SESSION,Gio.DBusProxyFlags.DO_NOT_AUTO_START,None,
        DEST,PATH,IFACE,None)

def invoke(req):
    t=token()
    if not t:
        return guierr('GUI_EXTENSION_TOKEN_MISSING')
    req=dict(req)
    req['auth']=t
    try:
        p=proxy()
        out=p.call_sync('Invoke',GLib.Variant('(s)',(json.dumps(req,separators=(',',':'),ensure_ascii=False),)),
                        Gio.DBusCallFlags.NONE,12000,None)
        raw=out.unpack()[0]
        value=json.loads(raw)
        return value if isinstance(value,dict) else guierr('GUI_NATIVE_INVALID_RESPONSE')
    except Exception:
        return guierr('GUI_GNOME_EXTENSION_UNAVAILABLE')

def convert_screenshot(req,result):
    path=result.get('path')
    try:
        if not isinstance(path,str) or not os.path.isfile(path):
            return guierr('GUI_CAPTURE_FILE_MISSING')
        pix=GdkPixbuf.Pixbuf.new_from_file(path)
        max_width=max(320,min(1920,int(req.get('maxWidth',1600))))
        if pix.get_width() > max_width:
            width=max_width
            height=max(1,round(pix.get_height()*width/pix.get_width()))
            pix=pix.scale_simple(width,height,GdkPixbuf.InterpType.BILINEAR)
        fmt=req.get('format','jpeg')
        if fmt=='png':
            ok,data=pix.save_to_bufferv('png',[],[])
            mime='image/png'
        else:
            q=max(25,min(90,int(req.get('quality',70))))
            ok,data=pix.save_to_bufferv('jpeg',['quality'],[str(q)])
            mime='image/jpeg'
        if not ok:
            return guierr('GUI_IMAGE_ENCODE_FAILED')
        limit=max(262144,min(4194304,int(req.get('maxBytes',2097152))))
        if len(data)>limit:
            return guierr('GUI_IMAGE_BYTE_LIMIT')
        return {'ok':True,'data':base64.b64encode(data).decode('ascii'),'mimeType':mime,
                'width':pix.get_width(),'height':pix.get_height(),
                'snapshot':result.get('snapshot'),'capturedAt':result.get('capturedAt')}
    except Exception:
        return guierr('GUI_IMAGE_ENCODE_FAILED')
    finally:
        if isinstance(path,str):
            try: os.unlink(path)
            except OSError: pass

def handle(req):
    if not isinstance(req,dict):
        return guierr('GUI_REQUEST_INVALID')
    action=req.get('action')
    if action=='status':
        r=invoke(req)
        if not r.get('ok'):
            return {'ok':True,'available':False,'backend':'gnome-shell-wayland',
                    'reason':r.get('error','GUI_GNOME_EXTENSION_UNAVAILABLE'),'screens':[]}
        return r
    r=invoke(req)
    if action=='screenshot' and r.get('ok'):
        return convert_screenshot(req,r)
    return r

def main():
    if '--self-test' in sys.argv:
        needed=[TOKEN_PATH,DEST,PATH,IFACE]
        print(json.dumps({'ok':True,'python':sys.version.split()[0],'gdkPixbuf':True,'contract':1,'paths':len(needed)}))
        return 0
    if '--server' in sys.argv:
        print(json.dumps({'ok':True,'ready':True,'protocol':1}),flush=True)
        for line in sys.stdin:
            try:
                if len(line)>32768:
                    out=guierr('GUI_REQUEST_LIMIT')
                else:
                    out=handle(json.loads(line))
            except Exception:
                out=guierr('GUI_NATIVE_FAILED')
            print(json.dumps(out,separators=(',',':'),ensure_ascii=False),flush=True)
        return 0
    raw=sys.stdin.read()
    if len(raw)>32768:
        out=guierr('GUI_REQUEST_LIMIT')
    else:
        try: out=handle(json.loads(raw))
        except Exception: out=guierr('GUI_NATIVE_FAILED')
    print(json.dumps(out,separators=(',',':'),ensure_ascii=False))
    return 0

if __name__=='__main__':
    raise SystemExit(main())
