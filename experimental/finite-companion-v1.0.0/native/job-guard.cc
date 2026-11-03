#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <iostream>
#include <string>
#include <vector>
#include <stdexcept>
#include <thread>
#include <atomic>
#include <cstdint>

struct Handle { HANDLE h=nullptr; Handle()=default; explicit Handle(HANDLE v):h(v){} ~Handle(){if(h&&h!=INVALID_HANDLE_VALUE)CloseHandle(h);} Handle(const Handle&)=delete; Handle& operator=(const Handle&)=delete; };
struct Failure {std::string phase;DWORD code;};
static void must(bool ok,const char* phase){if(!ok)throw Failure{phase,GetLastError()};}
static std::wstring quote(const std::wstring& a){std::wstring s=L"\"";size_t slash=0;for(auto c:a){if(c==L'\\'){slash++;continue;}if(c==L'\"'){s.append(slash*2+1,L'\\');s+=c;}else{s.append(slash,L'\\');s+=c;}slash=0;}s.append(slash*2,L'\\');s+=L'\"';return s;}
static std::string hex(const std::string& b){static const char h[]="0123456789abcdef";std::string s;s.reserve(b.size()*2);for(unsigned char c:b){s+=h[c>>4];s+=h[c&15];}return s;}
static std::wstring sid(HANDLE process){HANDLE t=nullptr;must(OpenProcessToken(process,TOKEN_QUERY,&t),"TOKEN_OPEN");Handle token(t);DWORD n=0;GetTokenInformation(token.h,TokenUser,nullptr,0,&n);std::vector<unsigned char>b(n);must(GetTokenInformation(token.h,TokenUser,b.data(),n,&n),"TOKEN_QUERY");LPWSTR value=nullptr;must(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(b.data())->User.Sid,&value),"TOKEN_SID");std::wstring result(value);LocalFree(value);return result;}
static uint64_t ticks(FILETIME f){return (uint64_t(f.dwHighDateTime)<<32)|f.dwLowDateTime;}
static unsigned number(const wchar_t* text,unsigned lo,unsigned hi){size_t used=0;auto n=std::stoul(text,&used);if(used!=wcslen(text)||n<lo||n>hi)throw Failure{"ARGUMENT_BOUND",0};return unsigned(n);}

int wmain(int argc,wchar_t** argv){
 if(argc<7){std::cout<<"{\"schema\":1,\"status\":\"ARGUMENTS_DENIED\"}\n";return 2;}
 DWORD error=0,exitCode=0,pid=0,active=0,cleanupError=0;uint64_t created=0,elapsed=0,peakMemory=0;bool assigned=false,resumed=false,terminated=false;std::atomic<bool>inputFailed{false};std::string primary="",stdoutBytes,stderrBytes;Handle job,process,thread,inRead,inWrite,outRead,outWrite,errRead,errWrite;std::thread writer;std::atomic<bool>writerDone{false};
 auto started=GetTickCount64();
 try{
  const unsigned deadline=number(argv[1],100,180000),maxBytes=number(argv[2],64,1048576),memoryMb=number(argv[3],64,1024);std::wstring exe=argv[4],cwd=argv[5];if(exe.size()>2048||cwd.size()>2048||exe.size()<3||exe[1]!=L':'||cwd.size()<3||cwd[1]!=L':')throw Failure{"ABSOLUTE_PATH_REQUIRED",0};
  std::string input;char buf[4096];while(std::cin.read(buf,sizeof buf)||std::cin.gcount()){input.append(buf,size_t(std::cin.gcount()));if(input.size()>65536)throw Failure{"INPUT_BOUND",0};}
  job.h=CreateJobObjectW(nullptr,nullptr);must(job.h!=nullptr,"JOB_CREATE");JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_ACTIVE_PROCESS|JOB_OBJECT_LIMIT_JOB_MEMORY|JOB_OBJECT_LIMIT_PROCESS_MEMORY;limits.BasicLimitInformation.ActiveProcessLimit=8;limits.JobMemoryLimit=SIZE_T(memoryMb)*1024*1024;limits.ProcessMemoryLimit=limits.JobMemoryLimit;must(SetInformationJobObject(job.h,JobObjectExtendedLimitInformation,&limits,sizeof limits),"JOB_LIMITS");
  JOBOBJECT_CPU_RATE_CONTROL_INFORMATION cpu{};cpu.ControlFlags=JOB_OBJECT_CPU_RATE_CONTROL_ENABLE|JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;cpu.CpuRate=2000;must(SetInformationJobObject(job.h,JobObjectCpuRateControlInformation,&cpu,sizeof cpu),"CPU_LIMIT");
  SECURITY_ATTRIBUTES sa{sizeof sa,nullptr,TRUE};must(CreatePipe(&inRead.h,&inWrite.h,&sa,0),"INPUT_PIPE");must(CreatePipe(&outRead.h,&outWrite.h,&sa,0),"OUTPUT_PIPE");must(CreatePipe(&errRead.h,&errWrite.h,&sa,0),"ERROR_PIPE");must(SetHandleInformation(inWrite.h,HANDLE_FLAG_INHERIT,0),"INPUT_INHERIT");must(SetHandleInformation(outRead.h,HANDLE_FLAG_INHERIT,0),"OUTPUT_INHERIT");must(SetHandleInformation(errRead.h,HANDLE_FLAG_INHERIT,0),"ERROR_INHERIT");
  SIZE_T attributeBytes=0;InitializeProcThreadAttributeList(nullptr,1,0,&attributeBytes);std::vector<unsigned char>attribute(attributeBytes);auto list=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attribute.data());must(InitializeProcThreadAttributeList(list,1,0,&attributeBytes),"ATTRIBUTE_INIT");struct AttributeCleanup{LPPROC_THREAD_ATTRIBUTE_LIST p;~AttributeCleanup(){DeleteProcThreadAttributeList(p);}}attributeCleanup{list};HANDLE inherited[3]={inRead.h,outWrite.h,errWrite.h};must(UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,inherited,sizeof inherited,nullptr,nullptr),"ATTRIBUTE_HANDLES");
  STARTUPINFOEXW si{};si.StartupInfo.cb=sizeof si;si.StartupInfo.dwFlags=STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW;si.StartupInfo.wShowWindow=SW_HIDE;si.StartupInfo.hStdInput=inRead.h;si.StartupInfo.hStdOutput=outWrite.h;si.StartupInfo.hStdError=errWrite.h;si.lpAttributeList=list;
  std::wstring command=quote(exe);for(int n=6;n<argc;n++){if(wcslen(argv[n])>8192)throw Failure{"ARGUMENT_SIZE",0};command+=L" "+quote(argv[n]);}if(command.size()>28000)throw Failure{"COMMAND_SIZE",0};PROCESS_INFORMATION pi{};
  must(CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW|EXTENDED_STARTUPINFO_PRESENT,nullptr,cwd.c_str(),&si.StartupInfo,&pi),"PROCESS_CREATE");process.h=pi.hProcess;thread.h=pi.hThread;pid=pi.dwProcessId;
  wchar_t image[32768];DWORD imageLength=32768;must(QueryFullProcessImageNameW(process.h,0,image,&imageLength),"PROCESS_IMAGE");if(_wcsicmp(std::wstring(image,imageLength).c_str(),exe.c_str())||sid(process.h)!=sid(GetCurrentProcess()))throw Failure{"PROCESS_IDENTITY",0};FILETIME creation{},end{},kernel{},user{};must(GetProcessTimes(process.h,&creation,&end,&kernel,&user),"PROCESS_TIMES");created=ticks(creation);
  must(AssignProcessToJobObject(job.h,process.h),"JOB_ASSIGN_BEFORE_EXECUTION");assigned=true;BOOL inJob=FALSE;must(IsProcessInJob(process.h,job.h,&inJob)&&inJob,"JOB_MEMBERSHIP");must(ResumeThread(thread.h)!=DWORD(-1),"PROCESS_RESUME");resumed=true;
  CloseHandle(inRead.h);inRead.h=nullptr;CloseHandle(outWrite.h);outWrite.h=nullptr;CloseHandle(errWrite.h);errWrite.h=nullptr;
  writer=std::thread([&]{DWORD offset=0;while(offset<input.size()){DWORD wrote=0;if(!WriteFile(inWrite.h,input.data()+offset,DWORD(input.size()-offset),&wrote,nullptr)||!wrote){inputFailed=true;break;}offset+=wrote;}CloseHandle(inWrite.h);inWrite.h=nullptr;writerDone=true;});
  auto drain=[&](HANDLE pipe,std::string& bytes){DWORD available=0;if(!PeekNamedPipe(pipe,nullptr,0,nullptr,&available,nullptr)){if(GetLastError()==ERROR_BROKEN_PIPE)return;throw Failure{"PIPE_OBSERVATION",GetLastError()};}while(available){DWORD got=0;char data[4096];must(ReadFile(pipe,data,available>4096?4096:available,&got,nullptr),"PIPE_READ");if(stdoutBytes.size()+stderrBytes.size()+got>maxBytes)throw Failure{"OUTPUT_BOUND",0};bytes.append(data,got);available-=got;}};
  for(;;){drain(outRead.h,stdoutBytes);drain(errRead.h,stderrBytes);if(GetTickCount64()-started>deadline)throw Failure{"WALL_DEADLINE",0};auto waited=WaitForSingleObject(process.h,5);if(waited==WAIT_FAILED)throw Failure{"WAIT_FAILURE",GetLastError()};if(waited==WAIT_OBJECT_0){must(GetExitCodeProcess(process.h,&exitCode),"EXIT_CODE");
   // A signalled root handle can precede the job's accounting update. Observe
   // the same held job briefly; never retry or create another child process.
   auto accountingDeadline=GetTickCount64()+250;
   for(;;){drain(outRead.h,stdoutBytes);drain(errRead.h,stderrBytes);JOBOBJECT_BASIC_ACCOUNTING_INFORMATION account{};must(QueryInformationJobObject(job.h,JobObjectBasicAccountingInformation,&account,sizeof account,nullptr),"JOB_ACCOUNTING");active=account.ActiveProcesses;if(!active)break;if(GetTickCount64()-started>deadline)throw Failure{"WALL_DEADLINE",0};if(GetTickCount64()>=accountingDeadline)throw Failure{"DESCENDANTS_AFTER_ROOT_EXIT",0};Sleep(5);}break;}}
 }catch(const Failure& f){primary=f.phase;error=f.code;}catch(...){primary="NATIVE_UNEXPECTED";}
 if(process.h&&!primary.empty()){if(assigned){terminated=TerminateJobObject(job.h,125)!=FALSE;}else{terminated=TerminateProcess(process.h,125)!=FALSE;}if(!terminated)cleanupError=GetLastError();if(WaitForSingleObject(process.h,5000)!=WAIT_OBJECT_0)cleanupError=WAIT_TIMEOUT;}
 if(writer.joinable()){if(!writerDone){CancelSynchronousIo(writer.native_handle());}writer.join();}
 if(job.h){JOBOBJECT_BASIC_ACCOUNTING_INFORMATION account{};auto closeDeadline=GetTickCount64()+5000;for(;;){if(!QueryInformationJobObject(job.h,JobObjectBasicAccountingInformation,&account,sizeof account,nullptr)){cleanupError=GetLastError();break;}active=account.ActiveProcesses;if(!active)break;if(GetTickCount64()>closeDeadline){cleanupError=WAIT_TIMEOUT;break;}Sleep(5);}JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};if(QueryInformationJobObject(job.h,JobObjectExtendedLimitInformation,&limits,sizeof limits,nullptr))peakMemory=limits.PeakJobMemoryUsed;}
 elapsed=GetTickCount64()-started;if(inputFailed&&primary.empty())primary="INPUT_PIPE_FAILED";if(active!=0&&primary.empty())primary="JOB_NOT_EMPTY";
 std::cout<<"{\"schema\":1,\"status\":\""<<(primary.empty()?"COMPLETED":primary)<<"\",\"win32Error\":"<<error<<",\"cleanupWin32Error\":"<<cleanupError<<",\"cleanupConfirmed\":"<<(cleanupError==0&&active==0?"true":"false")<<",\"pid\":"<<pid<<",\"creationFileTime\":\""<<created<<"\",\"assignedBeforeResume\":"<<(assigned&&resumed?"true":"false")<<",\"exitCode\":"<<exitCode<<",\"elapsedMs\":"<<elapsed<<",\"activeJobProcesses\":"<<active<<",\"peakJobMemoryBytes\":"<<peakMemory<<",\"ownedJobTerminated\":"<<(terminated?"true":"false")<<",\"stdoutHex\":\""<<hex(stdoutBytes)<<"\",\"stderrHex\":\""<<hex(stderrBytes)<<"\"}\n";
 return primary.empty()?0:1;
}
