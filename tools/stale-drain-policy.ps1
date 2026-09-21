function Get-StaleDrainDecision {
  param(
    [int]$ActiveOperations,
    [int]$Queued,
    [int]$UnexpectedConnections,
    [int]$UnsafeDescendants,
    [bool]$GuiBusy,
    [bool]$GuiLeased
  )
  if($ActiveOperations -ne 0){ return 'DEFER_ACTIVE' }
  if($Queued -ne 0){ return 'DEFER_QUEUED' }
  if($UnexpectedConnections -ne 0){ return 'DEFER_CONNECTED' }
  if($UnsafeDescendants -ne 0){ return 'DEFER_DESCENDANTS' }
  if($GuiBusy){ return 'DEFER_GUI_BUSY' }
  if($GuiLeased){ return 'DEFER_GUI_LEASED' }
  return 'ALLOW'
}
