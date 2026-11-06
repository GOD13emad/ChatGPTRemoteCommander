using System.Runtime.InteropServices;
// Lazy NativeAOT P/Invoke must not search an owner-writable CWD/PATH.
// Direct OS-loader imports are separately restricted by DEPENDENTLOADFLAG.
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
