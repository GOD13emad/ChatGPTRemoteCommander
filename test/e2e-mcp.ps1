$ErrorActionPreference = 'Stop'
$Endpoint = 'http://127.0.0.1:47831/mcp'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Invoke-McpTool {
    param(
        [int]$Id,
        [string]$Name,
        [hashtable]$Arguments
    )
    $payload = @{
        jsonrpc = '2.0'
        id = $Id
        method = 'tools/call'
        params = @{ name = $Name; arguments = $Arguments }
    } | ConvertTo-Json -Depth 12 -Compress

    Invoke-RestMethod -Uri $Endpoint -Method Post -ContentType 'application/json' -Body $payload
}

function Assert-ToolSuccess($Response, [string]$Label) {
    if ($Response.result.isError) { throw "$Label returned isError=true" }
}

$list = Invoke-McpTool 101 'list_directory' @{ path = $Root; depth = 1; maxEntries = 100 }
Assert-ToolSuccess $list 'list_directory'
'LIST_PASS'

$read = Invoke-McpTool 102 'read_text' @{ path = (Join-Path $Root 'README.md') }
Assert-ToolSuccess $read 'read_text'
if (-not $read.result.structuredContent.sha256) { throw 'read_text returned no SHA-256' }
"READ_PASS $($read.result.structuredContent.sha256)"

$tmp = Join-Path $Root 'test\.tmp-plugin-e2e.txt'
$marker = 'ChatGPT Remote Commander E2E regression'
$write = Invoke-McpTool 103 'write_text' @{ path = $tmp; content = $marker; mode = 'overwrite' }
Assert-ToolSuccess $write 'write_text'
"WRITE_PASS $($write.result.structuredContent.sha256)"

$readBack = Invoke-McpTool 104 'read_text' @{ path = $tmp }
Assert-ToolSuccess $readBack 'read-back'
if ($readBack.result.structuredContent.text -ne $marker) { throw 'read-back content mismatch' }
'READBACK_PASS'

$command = Invoke-McpTool 105 'run_project_command' @{
    program = 'git'
    args = @('status', '--short')
    cwd = $Root
    timeoutMs = 10000
}
Assert-ToolSuccess $command 'run_project_command'
if ($command.result.structuredContent.exitCode -ne 0) { throw 'git status returned nonzero exit code' }
'COMMAND_PASS'
'E2E_MCP_PASS'
