using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Windows.Forms;

namespace RemoteCommander;

internal static class ManagedProfileUiOffscreenQA
{
    private static string? tracePath;
    private static readonly Stopwatch traceClock = Stopwatch.StartNew();
    private static void Trace(string phase, string? action = null)
    {
        if(tracePath is null)return;
        var row=JsonSerializer.Serialize(new {schema=1,phase,action,elapsedMs=traceClock.ElapsedMilliseconds,pid=Environment.ProcessId});
        using var stream=new FileStream(tracePath,FileMode.Append,FileAccess.Write,FileShare.ReadWrite);
        using var writer=new StreamWriter(stream);writer.WriteLine(row);writer.Flush();stream.Flush(true);
        Console.Error.WriteLine("QA_SUBPHASE:"+row);Console.Error.Flush();
    }
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        if(args.Length==1 && args[0]=="--qa-ui-dialect-probe") return UiDialectProbe();
        if(args.Length==1 && args[0]=="--qa-stop-guard-selftest") return StopGuardSelfTest();
        if (args.Length != 1 || !Directory.Exists(args[0]))
            throw new InvalidOperationException("QA_EXACT_MANAGED_ROOT_REQUIRED");
        var root = Path.GetFullPath(args[0]);
        tracePath=Path.Combine(root,"QA_WINFORMS_SUBPHASE.jsonl");Trace("MAIN_ROOT_VALIDATED");
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "product.json")));
        if (manifest.RootElement.GetProperty("product").GetString() != "ChatGPTRemoteCommander")
            throw new InvalidOperationException("QA_MANAGED_PRODUCT_IDENTITY_INVALID");
        foreach (var forged in new[] {
            "{\"ok\":false,\"ok\":true}",
            "{\"ok\":true,\"runtime\":{\"running\":false,\"running\":true}}",
            "{\"profiles\":[{\"name\":\"default\",\"name\":\"other\"}]}"
        })
        {
            using var forgedJson = JsonDocument.Parse(forged);
            var rejected = false;
            try { CommanderJsonGuard.RequireUniqueKeys(forgedJson.RootElement); }
            catch (InvalidDataException) { rejected = true; }
            if (!rejected) throw new InvalidOperationException("QA_DUPLICATE_CLI_KEY_ACCEPTED");
        }
        using (var valid = JsonDocument.Parse("{\"ok\":true,\"profiles\":[\"default\"]}"))
            CommanderJsonGuard.RequireUniqueKeys(valid.RootElement);
        Console.WriteLine("WINFORMS_DUPLICATE_JSON_KEYS_REJECTED_PASS");
        // Each action has its own receipt contract; general ok=true must never
        // turn malformed, wrong-profile or missing proof into a verified UI state.
        var actionCases = new (string json, string action, bool good)[] {
            ("{\"ok\":true,\"profile\":\"default\",\"started\":true,\"verifiedHealth\":true}", "start", true),
            ("{\"ok\":true,\"profile\":\"default\",\"stopped\":true,\"verifiedIdentity\":true}", "stop", true),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":true,\"verified\":true}", "runtime-status", true),
            ("{\"ok\":true}", "start", false),
            ("{\"ok\":true,\"profile\":\"other\",\"started\":true,\"verifiedHealth\":true}", "start", false),
            ("{\"ok\":true,\"profile\":\"default\",\"started\":true,\"verifiedHealth\":false}", "start", false),
            ("{\"ok\":true,\"profile\":\"default\",\"stopped\":false,\"notRunning\":true}", "stop", false),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":false,\"verified\":false}", "runtime-status", false),
            ("{\"ok\":true,\"profile\":\"default\",\"stopped\":true,\"verifiedIdentity\":false}", "stop", false)
        };
        foreach (var test in actionCases)
        {
            using var receiptCheck = JsonDocument.Parse(test.json);
            if (ManagedPreviewForm.IsVerifiedActionReceipt(receiptCheck.RootElement, test.action, "default") != test.good)
                throw new InvalidOperationException("QA_ACTION_RECEIPT_VERIFICATION_INCORRECT:" + test.action);
        }
        using (var stopped = JsonDocument.Parse("{\"ok\":true,\"profile\":\"default\",\"running\":false,\"verified\":false}"))
        {
            if (!ManagedPreviewForm.IsReportedStopped(stopped.RootElement, "runtime-status", "default") ||
                ManagedPreviewForm.IsReportedStopped(stopped.RootElement, "stop", "default"))
                throw new InvalidOperationException("QA_REPORTED_STOPPED_MISCLASSIFIED");
        }
        Console.WriteLine("WINFORMS_ACTION_SPECIFIC_RECEIPTS_FAIL_CLOSED_PASS");
        // Even a valid success receipt may contain future secret-bearing fields.
        // UI must expose only selected action evidence, never raw JSON.
        using (var secretReceipt = JsonDocument.Parse(
            "{\"ok\":true,\"profile\":\"default\",\"started\":true,\"verifiedHealth\":true,\"token\":\"QA8_SECRET_SENTINEL\",\"nested\":{\"password\":\"QA8_SECRET_NESTED\"}}"))
        {
            var displayed = ManagedPreviewForm.SafeActionReceipt(secretReceipt.RootElement, "start", "default");
            if (displayed.Contains("QA8_SECRET", StringComparison.Ordinal) ||
                displayed.Contains("token", StringComparison.OrdinalIgnoreCase) ||
                displayed.Contains("password", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("QA8_RAW_CLI_SECRETS_VISIBLE_IN_UI");
            using var safe = JsonDocument.Parse(displayed);
            if (safe.RootElement.GetProperty("started").ValueKind != JsonValueKind.True ||
                safe.RootElement.GetProperty("verifiedHealth").ValueKind != JsonValueKind.True)
                throw new InvalidOperationException("QA8_VERIFIED_PROOF_DROPPED");
            var forgedDisplay = ManagedPreviewForm.SafeActionReceipt(secretReceipt.RootElement,"stop","other");
            if (forgedDisplay.Contains("QA8_SECRET", StringComparison.Ordinal) ||
                !forgedDisplay.Contains("unverified",StringComparison.Ordinal))
                throw new InvalidOperationException("QA8_FORGED_SECRET_LEAK");
        }
        Console.WriteLine("WINFORMS_ACTION_RECEIPT_ALLOWLIST_REDACTION_PASS");
        // Control Center displays stopped only on the exact false/false
        // combination; contradictory or missing verification stays unknown.
        var runtimeCases = new (string raw, string selected, string expected)[] {
            ("{\"ok\":true,\"profile\":\"default\",\"running\":true,\"verified\":true}", "default", "Running"),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":false,\"verified\":false}", "default", "Stopped"),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":false,\"verified\":true}", "default", "Unknown"),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":false}", "default", "Unknown"),
            ("{\"ok\":true,\"profile\":\"default\",\"running\":true,\"verified\":false}", "default", "Unknown"),
            ("{\"ok\":true,\"profile\":\"other\",\"running\":false,\"verified\":false}", "default", "Unknown"),
            ("{\"ok\":false,\"profile\":\"default\",\"running\":false,\"verified\":false}", "default", "Unknown")
        };
        foreach (var sample in runtimeCases) {
            using var doc = JsonDocument.Parse(sample.raw);
            var tile = CommanderControlCenter.RuntimeStatusTile(doc.RootElement, sample.selected);
            if (!tile.StartsWith(sample.expected, StringComparison.Ordinal))
                throw new InvalidOperationException("QA12_RUNTIME_TILE_FAIL_CLOSED_INVALID:"+tile);
        }
        Console.WriteLine("WINFORMS_CONTROL_CENTER_STRICT_RUNTIME_RECEIPTS_PASS");

        foreach (var malicious in new[] { "evil\\u202eevil", "evil\\u2066evil", "line\\nnew", "value<secret>" })
            if (CommanderControlCenter.SafeLabel(malicious.Replace("\\u202e", "\u202e")
                    .Replace("\\u2066", "\u2066").Replace("\\n", "\n")) != "unknown")
                throw new InvalidOperationException("QA_UNSAFE_CLI_LABEL_ACCEPTED");
        if (CommanderControlCenter.SafeLabel("1.0-beta") != "1.0-beta")
            throw new InvalidOperationException("QA_SAFE_CLI_LABEL_REJECTED");
        Console.WriteLine("WINFORMS_CLI_UNICODE_CONTROL_LABELS_REJECTED_PASS");

        ApplicationConfiguration.Initialize();

        var ctor = typeof(ManagedPreviewForm).GetConstructor(
            BindingFlags.NonPublic | BindingFlags.Instance,
            binder: null, types: new[] { typeof(string) }, modifiers: null)
            ?? throw new InvalidOperationException("QA_OWNER_DIALOG_CONSTRUCTOR_MISSING");
        Trace("FORM_CONSTRUCT_ENTER");
        using var form = (ManagedPreviewForm)ctor.Invoke(new object[] { root });
        Trace("FORM_CONSTRUCT_EXIT");
        var bar = form.Controls.OfType<FlowLayoutPanel>().Single();
        var buttons = bar.Controls.OfType<Button>().ToDictionary(b => b.Text);
        if (!buttons.ContainsKey("Start") || !buttons.ContainsKey("Status") ||
            !buttons.ContainsKey("Stop") || !buttons.ContainsKey("Control Center"))
            throw new InvalidOperationException("QA_OWNER_LIFECYCLE_BUTTONS_MISSING");
        if (buttons.Values.Any(b => string.IsNullOrWhiteSpace(b.AccessibleName)))
            throw new InvalidOperationException("QA_OWNER_BUTTON_A11Y_MISSING");

        var select = bar.Controls.OfType<ComboBox>().Single();
        select.SelectedItem = "default";
        if ((string?)select.SelectedItem != "default")
            throw new InvalidOperationException("QA_DEFAULT_PROFILE_NOT_SELECTABLE");
        var profileDisabledEvents = 0;
        var profileEnabledEvents = 0;
        select.EnabledChanged += (_, _) =>
        {
            if (select.Enabled) profileEnabledEvents++;
            else profileDisabledEvents++;
        };

        var summary = form.Controls.OfType<Label>()
            .Single(l => l.Text.StartsWith("This controls only", StringComparison.Ordinal));
        var receipt = form.Controls.OfType<TextBox>().Single();
        var onClick = typeof(Control).GetMethod("OnClick",
            BindingFlags.NonPublic | BindingFlags.Instance)
            ?? throw new InvalidOperationException("QA_WINFORMS_CLICK_EVENT_INACCESSIBLE");

        // Exercise the actual Control Center button without displaying a window
        // or taking physical mouse/keyboard focus from the owner.
        var centerCalls = 0;
        form.OpenControlCenter = (owner, selectedRoot, selectedProfile) =>
        {
            centerCalls++;
            if (owner != form || selectedRoot != root || selectedProfile != "default")
                throw new InvalidOperationException("QA_CENTER_SELECTED_SCOPE_MISMATCH");
            using var dashboard = new CommanderControlCenter(selectedRoot, selectedProfile);
            var dashboardBar = dashboard.Controls.OfType<FlowLayoutPanel>().Single();
            if ((string?)dashboardBar.Controls.OfType<ComboBox>().Single().SelectedItem != "default")
                throw new InvalidOperationException("QA_CENTER_PROFILE_NOT_BOUND");
            var cards = dashboard.Controls.OfType<TableLayoutPanel>().Single()
                .Controls.OfType<Label>().ToArray();
            if (cards.Length != 12 || cards.Any(c => !c.Text.Contains("Unavailable")))
                throw new InvalidOperationException("QA_CENTER_UNVERIFIED_TILE_NOT_UNKNOWN");
            var button = dashboardBar.Controls.OfType<Button>()
                .Single(b => b.Text == "Copy diagnostics");
            if (string.IsNullOrWhiteSpace(button.AccessibleName))
                throw new InvalidOperationException("QA_DIAGNOSTIC_COPY_A11Y_MISSING");
            var clipboardCalls = 0;
            var copied = "";
            dashboard.WriteDiagnosticsClipboard = text => { clipboardCalls++; copied = text; };
            onClick.Invoke(button, new object[] { EventArgs.Empty });
            if (clipboardCalls != 1 || !copied.Contains("Managed host") ||
                !copied.Contains("Update / rollback") || !copied.Contains("Unavailable / not verified") ||
                !copied.Contains("NOT evidence of authenticated remote identity"))
                throw new InvalidOperationException("QA_DIAGNOSTIC_COPY_NOT_SCOPED_OR_INCOMPLETE");
            if (copied.Contains("QA8_SECRET_SENTINEL", StringComparison.Ordinal))
                throw new InvalidOperationException("QA_DIAGNOSTIC_COPY_SECRET_LEAK");
            Console.WriteLine("WINFORMS_DIAGNOSTICS_REAL_BUTTON_CLIPBOARD_CONTRACT_PASS");
        };
        Trace("CONTROL_CENTER_CLICK_ENTER");
        onClick.Invoke(buttons["Control Center"], new object[] { EventArgs.Empty });
        Trace("CONTROL_CENTER_CLICK_EXIT");
        if (centerCalls != 1) throw new InvalidOperationException("QA_CENTER_REAL_BUTTON_CLICK_MISSING");
        Console.WriteLine("WINFORMS_MANAGED_CONTROL_CENTER_REAL_BUTTON_PASS");
        var cli = Path.Combine(root, "Commander.exe");
        var stopGuard = new QaStopAttemptGuard(root,"default");
        bool ExactStopped(JsonElement body) =>
            body.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True &&
            body.TryGetProperty("profile", out var profile) && profile.GetString() == "default" &&
            body.TryGetProperty("running", out var running) && running.ValueKind == JsonValueKind.False &&
            body.TryGetProperty("verified", out var verified) && verified.ValueKind == JsonValueKind.False;
        bool ExactRunning(JsonElement body) =>
            ManagedPreviewForm.IsVerifiedActionReceipt(body, "runtime-status", "default");
        (int exit, JsonElement body) SafeCli(string action)
        {
            Trace("SAFE_CLI_ENTER",action);
            if (action is not ("runtime-status" or "stop")) throw new InvalidOperationException("QA_DIAGNOSTIC_ACTION_INVALID");
            if(action=="stop") stopGuard.Consume("fresh-cleanup-cli");
            var info = new ProcessStartInfo(cli) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = root };
            foreach (var arg in new[] {"--"+action,"--target",root,"--profile","default"}) info.ArgumentList.Add(arg);
            using var process = Process.Start(info) ?? throw new InvalidOperationException("QA_CLI_NOT_STARTED");
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            Trace("SAFE_CLI_WAIT_EXIT_ENTER",action);
            if (!process.WaitForExit(12000)) throw new TimeoutException("QA_READ_OR_CLEANUP_OUTCOME_UNKNOWN_NO_REPLAY");
            Trace("SAFE_CLI_WAIT_EXIT_DONE",action);
            if (!Task.WaitAll(new Task[] {output,error}, 2000)) throw new TimeoutException("QA_DIAGNOSTIC_OUTPUT_TIMEOUT");
            if (output.Result.Length > 24000 || error.Result.Length > 24000) throw new InvalidDataException("QA_DIAGNOSTIC_OUTPUT_OVERSIZED");
            Console.Error.WriteLine("QA_DIAGNOSTIC_PROCESS:"+JsonSerializer.Serialize(new {
                action,exit=process.ExitCode,exitHex=unchecked((uint)process.ExitCode).ToString("X8"),
                stdoutLength=output.Result.Length,stderrLength=error.Result.Length}));
            using var parsed = JsonDocument.Parse(output.Result);
            CommanderJsonGuard.RequireUniqueKeys(parsed.RootElement);
            var body = parsed.RootElement.Clone();
            string? code = body.TryGetProperty("errorCode",out var ec) && ec.ValueKind==JsonValueKind.String ? ec.GetString() : null;
            if(code is not null && !System.Text.RegularExpressions.Regex.IsMatch(code,"^[A-Z0-9_]{1,120}$")) code="REDACTED";
            Console.Error.WriteLine("QA_DIAGNOSTIC_CLI:"+JsonSerializer.Serialize(new {action,exit=process.ExitCode,errorCode=code}));
            Trace("SAFE_CLI_EXIT",action);
            return (process.ExitCode,body);
        }

        void Observe(string action, string expected)
        {
            Trace("OBSERVE_ENTER",action);
            var actionKey = action switch {
                "Start" => "start",
                "Status" => "runtime-status",
                "Stop" => "stop",
                _ => throw new InvalidOperationException("QA_UNKNOWN_BUTTON")
            };
            // Fence before invoking an approved Stop, including ambiguous UI outcomes.
            if(action=="Stop") stopGuard.Consume("approved-ui-click");
            // Dispatch the real Button.Click event without showing/focusing any window.
            Trace("CLICK_ENTER",action);
            onClick.Invoke(buttons[action], new object[] { EventArgs.Empty });
            Trace("CLICK_RETURNED",action);
            var timer = Stopwatch.StartNew();
            bool pumpRecorded=false;
            while (timer.Elapsed < TimeSpan.FromSeconds(35))
            {
                if(!pumpRecorded)Trace("FIRST_PUMP_ENTER",action);
                Application.DoEvents();  // Pumps real async WinForms continuations.
                if(!pumpRecorded){Trace("FIRST_PUMP_RETURNED",action);pumpRecorded=true;}
                if (summary.Text.Contains(actionKey + " verified", StringComparison.Ordinal))
                {
                    using var data = JsonDocument.Parse(receipt.Text);
                    if (data.RootElement.GetProperty(expected).ValueKind != JsonValueKind.True)
                        throw new InvalidOperationException("QA_OWNER_ACTION_RECEIPT_INVALID:" + expected);
                    Trace("OBSERVE_VERIFIED",action);
                    return;
                }
                if (summary.Text.Contains("FAILED", StringComparison.Ordinal) ||
                    summary.Text.Contains("UNVERIFIED", StringComparison.Ordinal) ||
                    summary.Text.Contains("operation failed", StringComparison.OrdinalIgnoreCase) ||
                    summary.Text.Contains("timeout", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("QA_OWNER_ACTION_FAILED:" + summary.Text +
                        ":" + receipt.Text[..Math.Min(receipt.Text.Length, 500)]);
                Thread.Sleep(40);
            }
            Application.DoEvents();
            if (summary.Text.Contains(actionKey + " verified", StringComparison.Ordinal))
            {
                using var finalReceipt = JsonDocument.Parse(receipt.Text);
                if (finalReceipt.RootElement.GetProperty(expected).ValueKind == JsonValueKind.True)
                    return;
            }
            throw new TimeoutException("QA_OWNER_CLICK_TIMEOUT:" + action + ":" + summary.Text);
        }

        Exception? primaryFailure = null;
        bool verifiedStopObserved = false;
        try
        {
            Trace("BEFORE_OBSERVE_START");
            Observe("Start", "started");
            Trace("AFTER_OBSERVE_START");
            Trace("BEFORE_AFTER_VERIFIED_START");
            using(var startProof=JsonDocument.Parse(receipt.Text)) stopGuard.AfterVerifiedStart(startProof.RootElement);
            Trace("AFTER_AFTER_VERIFIED_START");
            Observe("Status", "running");
            var stopConfirmCalls = 0;
            var deniedConfirmObserved = false;
            var controlPath=Path.Combine(root,"state","controls","default.json");
            var controlBeforeDenied=File.ReadAllBytes(controlPath);
            form.ConfirmStop = (_, selectedProfile) =>
            {
                stopConfirmCalls++;
                if (selectedProfile != "default")
                    throw new InvalidOperationException("QA_STOP_SCOPE_CHANGED");
                Trace("STOP_CONFIRM_DENIED");
                deniedConfirmObserved = true;
                return false;
            };
            stopGuard.Consume("denied-ui-probe");
            onClick.Invoke(buttons["Stop"], new object[] { EventArgs.Empty });
            Application.DoEvents();
            if (stopConfirmCalls != 1)
                throw new InvalidOperationException("QA_DENIED_STOP_CONFIRMATION_MISSING");
            if(!File.ReadAllBytes(controlPath).SequenceEqual(controlBeforeDenied)) throw new InvalidOperationException("QA_DENIED_STOP_CONTROL_CHANGED");
            Observe("Status", "running"); // denied action must not stop backend
            stopGuard.ConfirmKnownNoEffect(deniedConfirmObserved && stopConfirmCalls==1,true);
            form.ConfirmStop = (_, selectedProfile) =>
            {
                stopConfirmCalls++;
                Trace("STOP_CONFIRM_APPROVED");
                return selectedProfile == "default";
            };
            Observe("Stop", "stopped");
            verifiedStopObserved = true; // Exact typed UI receipt accepted for this profile/action.
            if (stopConfirmCalls != 2)
                throw new InvalidOperationException("QA_APPROVED_STOP_CONFIRMATION_MISSING");
            Application.DoEvents();
            if (profileDisabledEvents < 4 || profileEnabledEvents < 4 || !select.Enabled)
                throw new InvalidOperationException(
                    $"QA_PROFILE_PICKER_BUSY_SCOPE_NOT_LOCKED:disabled={profileDisabledEvents};enabled={profileEnabledEvents}");
            Console.WriteLine("WINFORMS_PROFILE_SCOPE_LOCK_AND_RESTORE_PASS");
            Console.WriteLine("WINFORMS_MANAGED_CLICK_START_STATUS_STOP_PASS");
        }
        catch (Exception ex)
        {
            Trace("PRIMARY_EXCEPTION",ex.Message);
            primaryFailure = ex;
            Console.Error.WriteLine("QA_PRIMARY_FAILURE:" + ex.GetType().Name + ":" + ex.Message);
            throw;
        }
        finally
        {
            try
            {
                if(stopGuard.Consumed)
                    Console.WriteLine(verifiedStopObserved ? "QA_CLEANUP_PRIOR_VERIFIED_STOP_NO_EXTRA_CLI_PASS" : "QA_CLEANUP_CONSUMED_OR_UNKNOWN_STOP_NO_REPLAY");
                else if(!stopGuard.LaunchVerified)
                    Console.WriteLine("QA_CLEANUP_START_UNCERTAIN_RETAIN_NO_STOP");
                else
                {
                var status = SafeCli("runtime-status");
                if (status.exit == 0 && ExactStopped(status.body))
                    Console.WriteLine("QA_CLEANUP_ALREADY_STOPPED_NO_STOP_REPLAY_PASS");
                else if (status.exit == 0 && ExactRunning(status.body))
                {
                    var stop = SafeCli("stop");
                    if (stop.exit != 0 || !ManagedPreviewForm.IsVerifiedActionReceipt(stop.body, "stop", "default"))
                        throw new InvalidOperationException("QA_CLEANUP_VERIFIED_STOP_REJECTED");
                    var after = SafeCli("runtime-status");
                    if (after.exit != 0 || !ExactStopped(after.body))
                        throw new InvalidOperationException("QA_CLEANUP_STOP_EFFECT_UNVERIFIED");
                    Console.WriteLine("QA_CLEANUP_FRESH_VERIFIED_FIXTURE_STOP_PASS");
                }
                else throw new InvalidOperationException("QA_CLEANUP_STATUS_UNCERTAIN_NO_REPLAY");
                }
            }
            catch (Exception cleanup)
            {
                Trace("SECONDARY_CLEANUP_EXCEPTION",cleanup.Message);
                Console.Error.WriteLine("QA_SECONDARY_CLEANUP_FAILURE:" + cleanup.GetType().Name + ":" + cleanup.Message);
                if (primaryFailure is null) throw;
            }
        }
        Console.WriteLine("WINFORMS_OWNER_GUI_NO_PHYSICAL_MOUSE_FOCUS_PASS");
        return 0;
    }
    // QA-only per-root/profile/verified-launch guard. Production UI unchanged.
    private sealed class QaStopAttemptGuard
    {
        private readonly string root,profile;
        private string? generation;
        public bool Consumed {get;private set;}
        public bool LaunchVerified {get;private set;}
        public string? Generation => generation;
        public QaStopAttemptGuard(string root,string profile){this.root=Path.GetFullPath(root);this.profile=profile;}
        public void AfterVerifiedStart(JsonElement proof)
        {
            Trace("GUARD_AFTER_VERIFIED_START_ENTER");
            CommanderJsonGuard.RequireUniqueKeys(proof);
            var allowed=new HashSet<string>{"profile","action","verification","started","verifiedHealth"};
            if(proof.ValueKind!=JsonValueKind.Object || proof.EnumerateObject().Count()!=allowed.Count ||
               proof.EnumerateObject().Any(p=>!allowed.Contains(p.Name)) ||
               !proof.TryGetProperty("profile",out var selected) || selected.ValueKind!=JsonValueKind.String || selected.GetString()!=profile ||
               !proof.TryGetProperty("action",out var action) || action.ValueKind!=JsonValueKind.String || action.GetString()!="start" ||
               !proof.TryGetProperty("verification",out var verification) || verification.ValueKind!=JsonValueKind.String || verification.GetString()!="verified" ||
               !proof.TryGetProperty("started",out var started) || started.ValueKind!=JsonValueKind.True ||
               !proof.TryGetProperty("verifiedHealth",out var health) || health.ValueKind!=JsonValueKind.True)
                throw new InvalidOperationException("QA_START_GENERATION_UNVERIFIED");
            generation=Guid.NewGuid().ToString("N");LaunchVerified=true;Consumed=false;Trace("GUARD_AFTER_VERIFIED_START_ACCEPTED");
        }
        private void Append(string kind,string channel)
        {
            var directory=Path.Combine(root,"state","qa-stop-attempts");Directory.CreateDirectory(directory);
            var file=Path.Combine(directory,profile+"-"+generation+"-"+Guid.NewGuid().ToString("N")+".json");
            using var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None);
            JsonSerializer.Serialize(stream,new {schema=1,kind,managedRoot=root,profile,generation,channel});stream.Flush(true);
        }
        public void Consume(string channel)
        {
            Trace("GUARD_CONSUME_ENTER",channel);
            if(!LaunchVerified||generation is null)throw new InvalidOperationException("QA_STOP_START_UNVERIFIED_RETAIN");
            if(Consumed)throw new InvalidOperationException("QA_STOP_ALREADY_CONSUMED_NO_REPLAY");
            Consumed=true;Append("CONSUMED_BEFORE_STOP",channel);Trace("GUARD_CONSUME_DURABLE",channel);
        }
        public void ConfirmKnownNoEffect(bool confirmationDeniedBeforeCli,bool unchangedControlIdentity)
        {
            if(!Consumed||!confirmationDeniedBeforeCli||!unchangedControlIdentity)throw new InvalidOperationException("QA_STOP_DENIAL_UNPROVEN");
            Append("KNOWN_NOT_SUBMITTED","confirmed-denied-ui-probe");Consumed=false;
        }
    }
    private static int UiDialectProbe()
    {
        using var raw=JsonDocument.Parse("{\"ok\":true,\"profile\":\"default\",\"started\":true,\"verifiedHealth\":true}");
        var actual=ManagedPreviewForm.SafeActionReceipt(raw.RootElement,"start","default");
        using var safe=JsonDocument.Parse(actual);
        var oldValidatorAccepted=ManagedPreviewForm.IsVerifiedActionReceipt(safe.RootElement,"start","default");
        if(oldValidatorAccepted)throw new InvalidOperationException("QA_EXPECTED_RAW_UI_DIALECT_MISMATCH_NOT_PROVED");
        var guard=new QaStopAttemptGuard(Path.Combine(Path.GetTempPath(),"qa-dialect-noio"),"default");
        guard.AfterVerifiedStart(safe.RootElement);
        if(!guard.LaunchVerified)throw new InvalidOperationException("QA_REAL_FORMATTER_PROOF_REJECTED");
        var negative=new List<string>{raw.RootElement.GetRawText()};
        foreach(var pair in new[]{("profile","other"),("action","stop"),("verification","unverified")})
        {
            var changed=System.Text.Json.Nodes.JsonNode.Parse(actual)!.AsObject();changed[pair.Item1]=pair.Item2;negative.Add(changed.ToJsonString());
        }
        foreach(var key in new[]{"started","verifiedHealth"})
        {
            var changed=System.Text.Json.Nodes.JsonNode.Parse(actual)!.AsObject();changed[key]=false;negative.Add(changed.ToJsonString());
        }
        var extra=System.Text.Json.Nodes.JsonNode.Parse(actual)!.AsObject();extra["ok"]=true;negative.Add(extra.ToJsonString());
        var missing=System.Text.Json.Nodes.JsonNode.Parse(actual)!.AsObject();missing.Remove("verifiedHealth");negative.Add(missing.ToJsonString());
        foreach(var item in negative)
        {
            using var forged=JsonDocument.Parse(item);bool denied=false;
            try{guard.AfterVerifiedStart(forged.RootElement);}catch(InvalidOperationException){denied=true;}
            if(!denied)throw new InvalidOperationException("QA_UNVERIFIED_UI_DIALECT_ACCEPTED");
        }
        Console.WriteLine(JsonSerializer.Serialize(new {status="PASS_REAL_UI_FORMATTER_ROUNDTRIP_WITH_NEGATIVES",oldRawValidatorAcceptedUiReceipt=oldValidatorAccepted,actualUiReceipt=actual,negativeCases=negative.Count,processesStarted=0,ownerDesktopTouched=false}));
        return 0;
    }
    private static int StopGuardSelfTest()
    {
        var root=Path.Combine(Path.GetTempPath(),"rc-qa-stopguard-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
        try {
            using var proof=JsonDocument.Parse("{\"ok\":true,\"profile\":\"default\",\"started\":true,\"verifiedHealth\":true}");
            using var uiProof=JsonDocument.Parse(ManagedPreviewForm.SafeActionReceipt(proof.RootElement,"start","default"));
            var guard=new QaStopAttemptGuard(root,"default");guard.AfterVerifiedStart(uiProof.RootElement);var first=guard.Generation;var calls=0;
            try{guard.Consume("simulated-timeout");calls++;throw new TimeoutException("qa-only");}catch(TimeoutException){}
            try{guard.Consume("forbidden-retry");calls++;}catch(InvalidOperationException){}
            if(calls!=1||!guard.Consumed||!Directory.GetFiles(Path.Combine(root,"state","qa-stop-attempts")).Any())throw new InvalidOperationException("QA_STOP_CONSUMPTION_SELFTEST_FAILED");
            guard.AfterVerifiedStart(uiProof.RootElement);if(guard.Generation==first)throw new InvalidOperationException("QA_GENERATION_NOT_FRESH");guard.Consume("denied-ui-probe");
            try{guard.ConfirmKnownNoEffect(false,true);throw new Exception("QA_DENIAL_UNPROVEN_ACCEPTED");}catch(InvalidOperationException){}
            if(!guard.Consumed)throw new InvalidOperationException("QA_DENIAL_RESET_ON_UNKNOWN");guard.ConfirmKnownNoEffect(true,true);guard.Consume("approved-ui-stop");
            if(!guard.Consumed)throw new InvalidOperationException("QA_APPROVED_STOP_NOT_FENCED");
            Console.WriteLine("QA_STOP_GUARD_NO_EFFECT_SELFTEST_PASS");return 0;
        }finally{Directory.Delete(root,true);}
    }

}
