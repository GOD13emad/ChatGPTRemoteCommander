param([Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RCV2NativeTcpOwner {
 [DllImport("iphlpapi.dll", ExactSpelling=true)]
 static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
  [MarshalAs(UnmanagedType.Bool)] bool order, uint af, uint tableClass, uint reserved);
 public static int[] ForPort(int port) {
  int bytes=0;
  uint code=GetExtendedTcpTable(IntPtr.Zero,ref bytes,false,2,3,0);
  if(code!=122 || bytes<4 || bytes>8*1024*1024)
   throw new InvalidOperationException("V2_NATIVE_TCP_SIZE_"+code);
  IntPtr mem=Marshal.AllocHGlobal(bytes);
  try {
   code=GetExtendedTcpTable(mem,ref bytes,false,2,3,0);
   if(code!=0)throw new InvalidOperationException("V2_NATIVE_TCP_QUERY_"+code);
   int count=Marshal.ReadInt32(mem,0);
   if(count<0 || count>(bytes-4)/24)throw new InvalidOperationException("V2_NATIVE_TCP_ROW_BOUNDS");
   List<int> pids=new List<int>();
   for(int i=0;i<count;i++){
    int off=4+24*i;
    int raw=Marshal.ReadInt32(mem,off+8);
    int actual=((raw&0xff)<<8)|((raw>>8)&0xff);
    if(actual==port)pids.Add(Marshal.ReadInt32(mem,off+20));
   }
   return pids.ToArray();
  }finally{Marshal.FreeHGlobal(mem);}
 }
}
'@ -ErrorAction Stop
# Read-only documented GetExtendedTcpTable TCP_TABLE_OWNER_PID_LISTENER path.
# Preserve actual Windows PID attribution even if NetTCPIP cmdlet data is empty.
$rows=@([RCV2NativeTcpOwner]::ForPort($Port) | ForEach-Object {
 $value=[int]$_
 $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$value) -ErrorAction SilentlyContinue
 [ordered]@{
  pid=$value
  localAddress=$null
  state='Listen'
  commandLine=if($owner){[string]$owner.CommandLine}else{$null}
 }
})
ConvertTo-Json -InputObject $rows -Compress
