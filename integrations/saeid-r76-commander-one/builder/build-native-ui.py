#!/usr/bin/env python3
"""Rebuild the EXISTING dev23 native Control Centers with an opt-in managed-preview
profile lifecycle view. Does not edit the immutable dev23 release or user state.
"""
import argparse,hashlib,json,os,re,shutil,subprocess,tempfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
HEADER='COMMANDER_ONE_MANAGED_ROOT'
WIN_ANCHOR='actions.Controls.Add(Button("Refresh", async (_, _) => await RefreshAsync()));'
LINUX_ANCHOR='            self._build_profiles()\n'

def sha(data):return hashlib.sha256(data).hexdigest()

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument('--platform',required=True,choices=('win-x64','linux-x64'))
 ap.add_argument('--release',type=Path,required=True)
 ap.add_argument('--output',type=Path,required=True)
 a=ap.parse_args()
 release=a.release.resolve()
 dest=a.output.resolve()
 if dest.exists():raise RuntimeError('NATIVE_UI_OUTPUT_EXISTS_RECONCILE')
 if a.platform=='win-x64':
  src=release/'desktop/RemoteCommanderDashboard'
  if not (src/'RemoteCommanderDashboard.csproj').is_file():
   raise RuntimeError('DEV23_WINDOWS_UI_SOURCE_MISSING')
  with tempfile.TemporaryDirectory(prefix='commander-existing-winforms-ui-') as tmp:
   work=Path(tmp)
   for p in src.iterdir():
    if p.is_symlink():raise RuntimeError('DEV23_UI_ALIAS')
    if not p.is_file():continue
    if p.suffix.lower() not in ('.cs','.csproj','.manifest','.ico','.resx','.json'):
     continue
    shutil.copy2(p,work/p.name)
   entry=work/'Program.cs'
   original=entry.read_text(encoding='utf8')
   if original.count(WIN_ANCHOR)!=1:raise RuntimeError('DEV23_UI_PATCH_ANCHOR_CHANGED')
   addition='''\n        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("COMMANDER_ONE_MANAGED_ROOT")))
            actions.Controls.Add(Button("Managed Profiles", (_, _) =>
            {
                if (!ManagedPreviewForm.TryOpenOwnerPreview(this))
                    MessageBox.Show(this, "No verified owner-local managed preview found.",
                        "Managed Profiles", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }));'''
   entry.write_text(original.replace(WIN_ANCHOR,WIN_ANCHOR+addition),encoding='utf8')
   shutil.copy2(HERE/'ManagedPreviewForm.cs',work/'ManagedPreviewForm.cs')
   result=subprocess.run(['dotnet','publish',str(work/'RemoteCommanderDashboard.csproj'),
       '-c','Release','-r','win-x64','--self-contained','true',
       '-p:PublishSingleFile=true','-p:DebugType=None','-p:DebugSymbols=false',
       '-o',str(dest),'--verbosity','quiet'],
       capture_output=True,text=True,timeout=200)
   if result.returncode:
    raise RuntimeError('DEV23_NATIVE_WINFORMS_UI_BUILD_FAILED:'+result.stderr[-900:]+result.stdout[-500:])
  artifact=dest/'RemoteCommander.exe'
  if not artifact.is_file() or artifact.stat().st_size<20_000_000:
   raise RuntimeError('DEV23_UI_BUILD_OUTPUT_INCOMPLETE')
  print(json.dumps({'status':'MANAGED_UI_BUILD_PASS','platform':a.platform,
   'artifact':str(artifact),'sha256':sha(artifact.read_bytes()),
   'bytes':artifact.stat().st_size,'sourceImmutable':True,
   'controlsOnlyManagedPreview':True}))
 else:
  src=release/'desktop/linux-control-center'
  dest.mkdir(parents=True,exist_ok=False)
  for name in ('control_center.py','dashboard_ui.py','notion_panel.py'):
   p=src/name
   if p.is_symlink() or not p.is_file():raise RuntimeError('DEV23_LINUX_UI_SOURCE_INVALID:'+name)
   shutil.copy2(p,dest/name)
  shutil.copy2(HERE/'managed_controls.py',dest/'managed_controls.py')
  view=dest/'dashboard_ui.py'
  original=view.read_text(encoding='utf8')
  if original.count(LINUX_ANCHOR)!=1:raise RuntimeError('DEV23_GTK_UI_PATCH_ANCHOR_CHANGED')
  patched=original.replace(LINUX_ANCHOR,LINUX_ANCHOR+
   '            from managed_controls import install_managed_controls\n'
   '            install_managed_controls(self.profiles_page, Gtk, GLib)\n')
  view.write_text(patched,encoding='utf8')
  command=['python3','-B','-m','py_compile',
      str(dest/'control_center.py'),str(dest/'dashboard_ui.py'),
      str(dest/'managed_controls.py'),str(dest/'notion_panel.py')]
  check=subprocess.run(command,capture_output=True,text=True,timeout=10)
  if check.returncode:raise RuntimeError('DEV23_GTK_UI_SYNTAX_FAILED:'+check.stderr[-400:])
  print(json.dumps({'status':'MANAGED_UI_BUILD_PASS','platform':a.platform,
   'sourceDir':str(dest),'dashboardSha':sha(view.read_bytes()),
   'controlsSha':sha((dest/'managed_controls.py').read_bytes()),
   'sourceImmutable':True,'controlsOnlyManagedPreview':True}))

if __name__=='__main__':main()
