// R48: read-only DXGI desktop duplication availability probe.
// No input injection, no capture frame acquisition, no image or secret output.
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CommanderR48DxgiProbe {
  [DllImport("d3d11.dll", EntryPoint="D3D11CreateDevice", ExactSpelling=true)]
  private static extern int D3D11CreateDevice(IntPtr adapter, int driverType,
      IntPtr software, uint flags, IntPtr featureLevels, uint numFeatureLevels,
      uint sdkVersion, out IntPtr device, out uint featureLevel, out IntPtr context);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int GetAdapterFn(IntPtr self, out IntPtr adapter);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int EnumOutputsFn(IntPtr self, uint outputIndex, out IntPtr output);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  private delegate int DuplicateOutputFn(IntPtr self, IntPtr d3dDevice, out IntPtr duplication);
  private static T Method<T>(IntPtr self, int index) where T : Delegate {
    IntPtr table = Marshal.ReadIntPtr(self);
    IntPtr ptr = Marshal.ReadIntPtr(table, index * IntPtr.Size);
    return Marshal.GetDelegateForFunctionPointer<T>(ptr);
  }
  private static string Hex(int hr) { return "0x" + ((uint)hr).ToString("X8"); }
  public static string Run() {
    IntPtr dev = IntPtr.Zero, ctx = IntPtr.Zero, dxgi = IntPtr.Zero;
    IntPtr adapter = IntPtr.Zero, output = IntPtr.Zero, output1 = IntPtr.Zero, duplication = IntPtr.Zero;
    var result = new StringBuilder();
    try {
      result.Append("check=read-only;frameAcquired=false;inputUsed=false;");
      uint level;
      int hr = D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0, IntPtr.Zero, 0, 7,
             out dev, out level, out ctx);
      result.Append("d3dHardware=").Append(Hex(hr)).Append(";");
      if (hr < 0 || dev == IntPtr.Zero) {
        if (dev != IntPtr.Zero) { Marshal.Release(dev); dev = IntPtr.Zero; }
        if (ctx != IntPtr.Zero) { Marshal.Release(ctx); ctx = IntPtr.Zero; }
        hr = D3D11CreateDevice(IntPtr.Zero, 5, IntPtr.Zero, 0, IntPtr.Zero, 0, 7,
             out dev, out level, out ctx);
        result.Append("d3dWarp=").Append(Hex(hr)).Append(";");
      }
      if (hr < 0 || dev == IntPtr.Zero) return result.Append("status=DEVICE_UNAVAILABLE").ToString();
      Guid dxgiGuid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
      hr = Marshal.QueryInterface(dev, in dxgiGuid, out dxgi);
      result.Append("qiDxgiDevice=").Append(Hex(hr)).Append(";");
      if (hr < 0 || dxgi == IntPtr.Zero) return result.Append("status=NO_DXGI_DEVICE").ToString();
      hr = Method<GetAdapterFn>(dxgi, 7)(dxgi, out adapter);
      result.Append("getAdapter=").Append(Hex(hr)).Append(";");
      if (hr < 0 || adapter == IntPtr.Zero) return result.Append("status=NO_ADAPTER").ToString();
      hr = Method<EnumOutputsFn>(adapter, 7)(adapter, 0, out output);
      result.Append("enumOutput0=").Append(Hex(hr)).Append(";");
      if (hr < 0 || output == IntPtr.Zero) return result.Append("status=NO_OUTPUT").ToString();
      Guid output1Guid = new Guid("00cddea8-939b-4b83-a340-a685226666cc");
      hr = Marshal.QueryInterface(output, in output1Guid, out output1);
      result.Append("qiOutput1=").Append(Hex(hr)).Append(";");
      if (hr < 0 || output1 == IntPtr.Zero) return result.Append("status=NO_OUTPUT1").ToString();
      hr = Method<DuplicateOutputFn>(output1, 22)(output1, dev, out duplication);
      result.Append("duplicateOutput=").Append(Hex(hr)).Append(";");
      result.Append("status=").Append(hr == 0 && duplication != IntPtr.Zero
        ? "DXGI_DUPLICATION_AVAILABLE" : "DXGI_DUPLICATION_UNAVAILABLE");
      return result.ToString();
    } catch (Exception e) {
      return result.Append("status=PROBE_EXCEPTION;errorType=").Append(e.GetType().Name).ToString();
    } finally {
      if (duplication != IntPtr.Zero) Marshal.Release(duplication);
      if (output1 != IntPtr.Zero) Marshal.Release(output1);
      if (output != IntPtr.Zero) Marshal.Release(output);
      if (adapter != IntPtr.Zero) Marshal.Release(adapter);
      if (dxgi != IntPtr.Zero) Marshal.Release(dxgi);
      if (ctx != IntPtr.Zero) Marshal.Release(ctx);
      if (dev != IntPtr.Zero) Marshal.Release(dev);
    }
  }
}
