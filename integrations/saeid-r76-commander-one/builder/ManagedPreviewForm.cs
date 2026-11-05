using System.Diagnostics;
using System.Globalization;
using System.Drawing;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace RemoteCommander;

internal static class CommanderJsonGuard
{
    internal static void RequireUniqueKeys(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in element.EnumerateObject())
            {
                if (!names.Add(field.Name))
                    throw new InvalidDataException("CLI JSON duplicate object key");
                RequireUniqueKeys(field.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var value in element.EnumerateArray())
                RequireUniqueKeys(value);
        }
    }
}

/// <summary>
/// Explicit owner-local control surface for ONE installed Commander preview.
/// No legacy Router mutation, credentials, UAC, implicit GUI takeover or shell execution.
/// </summary>
internal sealed class ManagedPreviewForm : Form
{
    private readonly string root;
    private readonly string executable;
    private readonly ComboBox selector = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230 };
    private readonly TextBox result = new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill, BackColor = Color.FromArgb(15, 26, 45),
        ForeColor = Color.FromArgb(224, 236, 250), Font = new Font("Consolas", 10)
    };
    private readonly Label summary = new()
    {
        AutoSize = false, Dock = DockStyle.Top, Height = 58, Padding = new Padding(8),
        Text = "This controls only the selected profile inside the installed owner-local preview.",
        ForeColor = Color.FromArgb(225, 234, 247)
    };
    private bool busy;
    // Closing the UI invalidates its in-flight child CLI action and late receipt.
    private readonly CancellationTokenSource formLifetime = new();

    // The shipping behavior always requires an owner's explicit Yes.
    // An isolated QA harness can substitute a deterministic decision without
    // ever opening a modal prompt on the user's physical desktop.
    internal Func<Form, string, bool> ConfirmStop =
        static (owner, profile) => MessageBox.Show(owner,
            $"Stop only the managed preview backend for {profile}?",
            "Confirm local stop", MessageBoxButtons.YesNo, MessageBoxIcon.Question)
            == DialogResult.Yes;

    // The installed behavior uses native ShowDialog. Tests inject a bounded
    // callback to verify the real button event without taking desktop focus.
    internal Action<Form, string, string> OpenControlCenter = static (owner, path, selected) =>
    {
        using var dashboard = new CommanderControlCenter(path, selected);
        dashboard.ShowDialog(owner);
    };
    private ManagedPreviewForm(string root)
    {
        this.root = root;
        executable = Path.Combine(root, "Commander.exe");
        Text = "Commander One | Managed Profiles";
        Width = 830; Height = 540; MinimumSize = new Size(680, 400);
        StartPosition = FormStartPosition.CenterParent; AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Color.FromArgb(22, 34, 54);
        ForeColor = Color.White;
        AccessibleName = "Managed preview lifecycle control";

        var bar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(12),
            WrapContents = true, BackColor = Color.FromArgb(32, 48, 74)
        };
        var profileLabel = new Label
        {
            Text = "Profile", Width = 70, TextAlign = ContentAlignment.MiddleLeft,
            ForeColor = Color.White
        };
        bar.Controls.Add(profileLabel);
        bar.Controls.Add(selector);
        foreach (var (name, action) in new[]
        {
            ("Status", "runtime-status"), ("Start", "start"), ("Stop", "stop")
        })
        {
            var button = new Button
            {
                Text = name, AutoSize = true, Height = 36,
                FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(54, 87, 132),
                ForeColor = Color.White, AccessibleName = name + " selected preview profile"
            };
            button.Click += async (_, _) => await ExecuteAsync(action);
            bar.Controls.Add(button);
        }
        var centerButton = new Button {
            Text = "Control Center", AutoSize = true, Height = 36,
            FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(46, 91, 139),
            ForeColor = Color.White, AccessibleName = "Open read-only Commander Control Center for selected profile"
        };
        centerButton.Click += (_, _) =>
        {
            if (busy || selector.SelectedItem is not string selected) return;
            OpenControlCenter(this, root, selected);
        };
        bar.Controls.Add(centerButton);
        var notice = new Label
        {
            Text = "Local-only  •  explicit actions  •  no legacy Router changes  •  no Administrator grant",
            Dock = DockStyle.Bottom, Height = 40, Padding = new Padding(12, 9, 12, 5),
            ForeColor = Color.FromArgb(173, 196, 223), TextAlign = ContentAlignment.MiddleLeft
        };
        Controls.Add(result);
        Controls.Add(summary);
        Controls.Add(bar);
        Controls.Add(notice);
        PopulateProfiles();
        Shown += async (_, _) => await ExecuteAsync("runtime-status");
        FormClosed += (_, _) => formLifetime.Cancel();
    }

    public static bool TryOpenOwnerPreview(Form owner)
    {
        var raw = Environment.GetEnvironmentVariable("COMMANDER_ONE_MANAGED_ROOT");
        if (string.IsNullOrWhiteSpace(raw)) return false;
        string directory;
        try { directory = Path.GetFullPath(raw); }
        catch { return false; }
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!directory.StartsWith(home + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            // Reject symlink/junction hops below the verified owner home path.
            var cursor = home;
            if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) return false;
            foreach (var segment in Path.GetRelativePath(home, directory)
                .Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
            {
                cursor = Path.Combine(cursor, segment);
                if ((File.GetAttributes(cursor) & FileAttributes.ReparsePoint) != 0) return false;
            }
            var marker = Path.Combine(directory, "product.json");
            if ((File.GetAttributes(marker) & FileAttributes.ReparsePoint) != 0) return false;
            using var json = JsonDocument.Parse(File.ReadAllText(marker));
            CommanderJsonGuard.RequireUniqueKeys(json.RootElement);
            if (json.RootElement.GetProperty("product").GetString() != "ChatGPTRemoteCommander" ||
                json.RootElement.GetProperty("schema").GetInt32() != 1 ||
                !File.Exists(Path.Combine(directory, "Commander.exe")) ||
                (File.GetAttributes(Path.Combine(directory, "Commander.exe")) & FileAttributes.ReparsePoint) != 0)
                return false;
            using var dialog = new ManagedPreviewForm(directory);
            dialog.ShowDialog(owner);
            return true;
        }
        catch { return false; }
    }

    private void PopulateProfiles()
    {
        selector.Items.Clear();
        var folder = Path.Combine(root, "state", "profiles");
        if (Directory.Exists(folder) &&
            (File.GetAttributes(Path.Combine(root, "state")) & FileAttributes.ReparsePoint) == 0 &&
            (File.GetAttributes(folder) & FileAttributes.ReparsePoint) == 0)
            foreach (var file in Directory.EnumerateFiles(folder, "*.json").OrderBy(x => x))
            {
                var name = Path.GetFileNameWithoutExtension(file);
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0 &&
                    name.Length is >= 1 and <= 40 &&
                    char.IsLetter(name[0]) &&
                    name.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.'))
                    selector.Items.Add(name);
            }
        if (selector.Items.Count > 0) selector.SelectedItem = selector.Items.Contains("default") ? "default" : selector.Items[0];
        else result.Text = "No configured managed profiles found.";
    }

    // The CLI's general ok=true is NOT action-specific success, running identity
    // or owner approval. Check exact profile, action fields and proof bits.
    internal static bool IsVerifiedActionReceipt(JsonElement receipt, string action, string selected)
    {
        if (receipt.ValueKind != JsonValueKind.Object ||
            !receipt.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True ||
            !receipt.TryGetProperty("profile", out var profile) ||
            profile.ValueKind != JsonValueKind.String || profile.GetString() != selected)
            return false;
        static bool IsTrue(JsonElement value, string key) =>
            value.TryGetProperty(key, out var property) && property.ValueKind == JsonValueKind.True;
        return action switch
        {
            "start" => IsTrue(receipt, "started") && IsTrue(receipt, "verifiedHealth"),
            "stop" => IsTrue(receipt, "stopped") && IsTrue(receipt, "verifiedIdentity"),
            "runtime-status" => IsTrue(receipt, "running") && IsTrue(receipt, "verified"),
            _ => false
        };
    }

    internal static bool IsReportedStopped(JsonElement receipt, string action, string selected)
    {
        return action == "runtime-status" &&
            receipt.ValueKind == JsonValueKind.Object &&
            receipt.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True &&
            receipt.TryGetProperty("profile", out var p) &&
            p.ValueKind == JsonValueKind.String && p.GetString() == selected &&
            receipt.TryGetProperty("running", out var r) && r.ValueKind == JsonValueKind.False &&
            receipt.TryGetProperty("verified", out var v) && v.ValueKind == JsonValueKind.False;
    }

    // This is an allowlist for UI evidence, not serialization of raw CLI stdout.
    // Future backend fields (tokens, credentials, nested diagnostics) stay hidden.
    internal static string SafeActionReceipt(JsonElement data, string action, string selected)
    {
        bool verified = IsVerifiedActionReceipt(data, action, selected);
        bool reportedStopped = IsReportedStopped(data, action, selected);
        var safe = new Dictionary<string, object>
        {
            ["profile"] = selected,
            ["action"] = action,
            ["verification"] = verified ? "verified" : reportedStopped ? "reported-stopped" : "unverified"
        };
        if (verified && action == "start")
        {
            safe["started"] = true;
            safe["verifiedHealth"] = true;
        }
        else if (verified && action == "stop")
        {
            safe["stopped"] = true;
            safe["verifiedIdentity"] = true;
        }
        else if (verified && action == "runtime-status")
        {
            safe["running"] = true;
            safe["verified"] = true;
        }
        else if (reportedStopped)
        {
            safe["running"] = false;
            safe["verified"] = false;
        }
        return JsonSerializer.Serialize(safe, new JsonSerializerOptions { WriteIndented = true });
    }

    // Bound output while reading rather than after buffering untrusted CLI data.
    private static async Task<string> ReadBoundedOutputAsync(Stream stream, CancellationToken token)
    {
        using var bytes = new MemoryStream();
        var block = new byte[4096];
        while (true)
        {
            var n = await stream.ReadAsync(block.AsMemory(), token);
            if (n == 0) break;
            if (bytes.Length + n > 24_000)
                throw new InvalidDataException("CLI response exceeded 24 KB");
            bytes.Write(block, 0, n);
        }
        return Encoding.UTF8.GetString(bytes.ToArray());
    }
    private async Task ExecuteAsync(string action)
    {
        if (busy || IsDisposed || Disposing || formLifetime.IsCancellationRequested ||
            selector.SelectedItem is not string profile) return;
        if (action == "stop" && !ConfirmStop(this, profile)) return;
        busy = true;
        foreach (Control control in Controls.OfType<FlowLayoutPanel>()
                     .SelectMany(panel => panel.Controls.OfType<Button>()))
            control.Enabled = false;
        // A result is scoped to the captured profile and action. Never let the
        // operator switch profiles while an outstanding mutation is in flight.
        selector.Enabled = false;
        result.Text = "No verified receipt yet for this operation.";
        summary.Text = $"{profile}  •  {action}  •  verifying...";
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo(executable)
                {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    WorkingDirectory = root
                }
            };
            process.StartInfo.ArgumentList.Add("--" + action);
            process.StartInfo.ArgumentList.Add("--target");
            process.StartInfo.ArgumentList.Add(root);
            process.StartInfo.ArgumentList.Add("--profile");
            process.StartInfo.ArgumentList.Add(profile);
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(formLifetime.Token);
            limit.CancelAfter(TimeSpan.FromSeconds(24));
            if (!process.Start()) throw new InvalidOperationException("COMMANDER_PREVIEW_LAUNCH_FAILED");
            var stdout = ReadBoundedOutputAsync(process.StandardOutput.BaseStream, limit.Token);
            var stderr = ReadBoundedOutputAsync(process.StandardError.BaseStream, limit.Token);
            try
            {
                await process.WaitForExitAsync(limit.Token);
            }
            finally
            {
                // An incomplete Start/Stop has an UNKNOWN outcome. Kill only the
                // private child created for this exact click.
                if (!process.HasExited)
                {
                    try { process.Kill(entireProcessTree: true); }
                    catch (InvalidOperationException) { /* Already exited. */ }
                    try { await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)); }
                    catch (TimeoutException) { /* Requires status reconciliation. */ }
                }
            }
            var output = (await stdout).Trim();
            var error = (await stderr).Trim();
            if (output.Length > 24000 || error.Length > 24000)
                throw new InvalidOperationException("COMMANDER_PREVIEW_OUTPUT_OVERSIZED");
            if (IsDisposed || Disposing || formLifetime.IsCancellationRequested) return;
            // Display only verified typed fields; never echo CLI stdout/stderr.
            var safeReceipt = JsonSerializer.Serialize(new
            {
                profile, action, verification = "unverified",
                note = "Raw CLI output withheld; use Status to reconcile"
            });
            bool accepted = false;
            bool stoppedReported = false;
            try
            {
                using var body = JsonDocument.Parse(output);
                CommanderJsonGuard.RequireUniqueKeys(body.RootElement);
                accepted = process.ExitCode == 0 && IsVerifiedActionReceipt(body.RootElement, action, profile);
                stoppedReported = process.ExitCode == 0 && IsReportedStopped(body.RootElement, action, profile);
                if (process.ExitCode == 0)
                    safeReceipt = SafeActionReceipt(body.RootElement, action, profile);
            }
            catch (JsonException) { }
            result.Text = safeReceipt;
            summary.Text = accepted
                ? $"{profile}  •  {action} verified"
                : stoppedReported
                ? $"{profile}  •  runtime-status: stopped (CLI report, identity unverified)"
                : $"{profile}  •  {action} UNVERIFIED (exit {process.ExitCode}); reconcile with Status";
        }
        catch (OperationCanceledException)
        {
            if (IsDisposed || Disposing || formLifetime.IsCancellationRequested) return;
            summary.Text = $"{profile}  •  timeout: outcome not assumed. Use Status.";
            result.Text = "Operation timeout. Check real backend status before retrying.";
        }
        catch (Exception e)
        {
            if (IsDisposed || Disposing || formLifetime.IsCancellationRequested) return;
            summary.Text = $"{profile}  •  operation failed";
            result.Text = e.GetType().Name + ": " + e.Message;
        }
        finally
        {
            busy = false;
            if (!IsDisposed && !Disposing && !formLifetime.IsCancellationRequested)
            {
                selector.Enabled = true;
                foreach (Control control in Controls.OfType<FlowLayoutPanel>()
                             .SelectMany(panel => panel.Controls.OfType<Button>()))
                    control.Enabled = true;
            }
        }
    }
}

/// <summary>
/// Fail-closed, owner-local, read-only native dashboard candidate.
/// No network calls, shell, elevation, GUI takeover, installer actions, or implicit launches.
/// CLI responses describe only the selected managed installation and profile.
/// </summary>
internal sealed class CommanderControlCenter : Form
{
    private static readonly Color Background = Color.FromArgb(17, 26, 43);
    private static readonly Color Surface = Color.FromArgb(31, 46, 69);
    private static readonly Color Muted = Color.FromArgb(185, 202, 222);
    private static readonly string[] Categories =
    {
        "Managed host", "Profiles / accounts", "Runtime / connection", "Permissions",
        "Active operations", "Task queue", "History / receipts", "Errors",
        "Resource monitoring", "AI / extensions", "GUI control", "Update / rollback"
    };

    private readonly string managedRoot;
    private readonly string executable;
    private readonly ComboBox profile = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 240, AccessibleName = "Selected managed profile" };
    private readonly Label state = new() { AutoSize = false, Dock = DockStyle.Top, Height = 52, Padding = new Padding(18, 14, 10, 5) };
    private readonly Label footer = new() { AutoSize = false, Dock = DockStyle.Bottom, Height = 40, Padding = new Padding(18, 9, 10, 5), ForeColor = Muted };
    private readonly TextBox details = new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
        WordWrap = true, Dock = DockStyle.Fill, Font = new Font("Consolas", 10),
        BackColor = Background, ForeColor = Color.FromArgb(225, 236, 249),
        AccessibleName = "Timestamped, nonsecret backend observations"
    };
    private readonly Dictionary<string, Label> tiles = new(StringComparer.Ordinal);
    private readonly Button refresh = new() { Text = "Refresh live data", Width = 185, Height = 38,
        AccessibleName = "Query the selected installed profile without changing its lifecycle" };
    private readonly Button copyDiagnostics = new() { Text = "Copy diagnostics", Width = 160, Height = 38,
        AccessibleName = "Copy only visible, allowlisted local diagnostic observations" };
    // Testing may substitute a capture callback; the product uses the system clipboard
    // only when the owner explicitly clicks Copy diagnostics.
    internal Action<string> WriteDiagnosticsClipboard = Clipboard.SetText;
    private readonly CancellationTokenSource lifetime = new();
    private CancellationTokenSource? request;
    private bool busy;
    private long generation;
    // Production default is unchanged. Scoped offscreen QA can shorten the
    // synthetic CLI deadline without modifying process-global environment.
    internal TimeSpan RefreshTimeout = TimeSpan.FromSeconds(18);

    internal CommanderControlCenter(string root, string? initialProfile = null)
    {
        managedRoot = Path.GetFullPath(root);
        executable = Path.Combine(managedRoot, "Commander.exe");
        Text = "Commander V1 | Verified Control Center";
        Width = 1120; Height = 760; MinimumSize = new Size(830, 580);
        StartPosition = FormStartPosition.CenterParent; AutoScaleMode = AutoScaleMode.Dpi;
        BackColor = Background; ForeColor = Color.White;
        AccessibleName = "Commander owner-local control center (read-only)";

        var toolbar = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, Height = 64, Padding = new Padding(17, 10, 12, 7),
            BackColor = Surface, WrapContents = false
        };
        toolbar.Controls.Add(new Label { Text = "Local managed profile", Width = 175, Height = 38,
            TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.White });
        toolbar.Controls.Add(profile);
        refresh.FlatStyle = FlatStyle.Flat; refresh.BackColor = Color.FromArgb(46, 91, 139);
        refresh.ForeColor = Color.White; toolbar.Controls.Add(refresh);
        copyDiagnostics.FlatStyle = FlatStyle.Flat;
        copyDiagnostics.BackColor = Color.FromArgb(47, 85, 117);
        copyDiagnostics.ForeColor = Color.White;
        toolbar.Controls.Add(copyDiagnostics);

        var grid = new TableLayoutPanel
        {
            Dock = DockStyle.Top, Height = 300, ColumnCount = 4, RowCount = 3,
            Padding = new Padding(11), BackColor = Background
        };
        for (int i = 0; i < 4; i++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        for (int i = 0; i < 3; i++) grid.RowStyles.Add(new RowStyle(SizeType.Percent, 33.3333f));
        for (int i = 0; i < Categories.Length; i++)
        {
            var category = Categories[i];
            var tile = new Label
            {
                AutoSize = false, Dock = DockStyle.Fill, Margin = new Padding(5),
                Padding = new Padding(10), BackColor = Surface,
                ForeColor = Muted, TextAlign = ContentAlignment.MiddleLeft
            };
            grid.Controls.Add(tile, i % 4, i / 4);
            tiles.Add(category, tile);
        }
        footer.Text = "Source: local managed CLI only. No trusted cross-host, caller-identity or admin-grant feed is available.";
        Controls.Add(details);
        Controls.Add(footer);
        Controls.Add(grid);
        Controls.Add(state);
        Controls.Add(toolbar);
        refresh.Click += async (_, _) => await RefreshStatusAsync();
        copyDiagnostics.Click += (_, _) => CopyDiagnostics();
        Shown += async (_, _) => await RefreshStatusAsync();
        profile.SelectedIndexChanged += (_, _) => { generation++; request?.Cancel(); ClearEvidence(); };
        FormClosed += (_, _) => { generation++; lifetime.Cancel(); request?.Cancel(); };
        PopulateProfiles(initialProfile);
        ClearEvidence();
    }

    private static bool IsSafeProfile(string name) =>
        !string.IsNullOrEmpty(name) && name.Length <= 40 && char.IsAsciiLetter(name[0]) &&
        name.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.');

    internal static string SafeLabel(string? value, int maxLength = 100) =>
        !string.IsNullOrEmpty(value) && value.Length <= maxLength &&
        value.All(c => !char.IsControl(c) && c is not '<' and not '>' &&
            CharUnicodeInfo.GetUnicodeCategory(c) is not (
                UnicodeCategory.Format or UnicodeCategory.Surrogate or
                UnicodeCategory.OtherNotAssigned or UnicodeCategory.PrivateUse))
            ? value : "unknown";

    private static bool ProfileInStatus(JsonElement info, string selected) =>
        info.ValueKind == JsonValueKind.Object && info.TryGetProperty("profiles", out var profiles) &&
        profiles.ValueKind == JsonValueKind.Array && profiles.GetArrayLength() <= 51 &&
        profiles.EnumerateArray().Any(item =>
            item.ValueKind == JsonValueKind.String && item.GetString() == selected);

    private void PopulateProfiles(string? initialProfile)
    {
        profile.Items.Clear();
        var stateDirectory = Path.Combine(managedRoot, "state");
        var directory = Path.Combine(stateDirectory, "profiles");
        if (!Directory.Exists(directory) || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0 ||
            (File.GetAttributes(stateDirectory) & FileAttributes.ReparsePoint) != 0) return;
        foreach (var file in Directory.EnumerateFiles(directory, "*.json").OrderBy(p => p, StringComparer.Ordinal))
        {
            var name = Path.GetFileNameWithoutExtension(file);
            if (IsSafeProfile(name) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0)
                profile.Items.Add(name);
        }
        if (profile.Items.Count > 0) profile.SelectedItem = initialProfile != null && profile.Items.Contains(initialProfile) ? initialProfile : profile.Items.Contains("default") ? "default" : profile.Items[0];
    }

    private void SetTile(string category, string value, string evidence = "not verified")
    {
        var tile = tiles[category];
        tile.Text = category + "\n" + value;
        tile.AccessibleName = category + ": " + value + ". " + evidence;
    }

    internal string BuildSafeDiagnosticsReport()
    {
        // Only existing, rendered, typed observations; never raw CLI stdout,
        // stderr, credentials, unknown object members or system identifiers.
        var text = new StringBuilder();
        text.AppendLine("Commander V1 | owner-local Control Center diagnostics");
        text.AppendLine("Exported at UTC: " + DateTimeOffset.UtcNow.ToString("O"));
        text.AppendLine("Selected managed profile: " + (profile.SelectedItem as string ?? "(none)"));
        text.AppendLine("Source: bounded local CLI --status / --runtime-status / --autostart-status");
        text.AppendLine("NOT evidence of authenticated remote identity, OS grants or fleet health.");
        text.AppendLine("Current observation: " + state.Text);
        text.AppendLine();
        foreach (var category in Categories)
        {
            text.AppendLine(tiles[category].Text);
            text.AppendLine();
        }
        return text.ToString();
    }

    private void CopyDiagnostics()
    {
        if (busy || IsDisposed || Disposing || lifetime.IsCancellationRequested) return;
        try
        {
            WriteDiagnosticsClipboard(BuildSafeDiagnosticsReport());
            state.Text = "Local diagnostic summary copied (no raw CLI output)";
        }
        catch (Exception error)
        {
            state.Text = "Unable to copy diagnostics: " + error.GetType().Name;
        }
    }

    private void ClearEvidence()
    {
        foreach (var category in Categories) SetTile(category, "Unavailable / not verified");
        state.Text = profile.SelectedItem is string name
            ? name + "  |  Not checked — refresh to request current evidence"
            : "No managed profile selected";
        details.Text = "Only read-only installed CLI commands are invoked. An unavailable feed is not a healthy feed.";
    }

    private static bool IsSuccess(JsonElement data) =>
        data.ValueKind == JsonValueKind.Object && data.TryGetProperty("ok", out var ok) &&
        ok.ValueKind == JsonValueKind.True;

    private static string? StringProperty(JsonElement data, string key) =>
        data.ValueKind == JsonValueKind.Object && data.TryGetProperty(key, out var value) &&
        value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool? BooleanProperty(JsonElement data, string key) =>
        data.ValueKind == JsonValueKind.Object && data.TryGetProperty(key, out var value) &&
        value.ValueKind is JsonValueKind.True or JsonValueKind.False ? value.GetBoolean() : null;

    // A runtime-status false value with missing or inconsistent verification
    // is not proof of stopped identity; only the exact boolean pair is allowed.
    internal static string RuntimeStatusTile(JsonElement data, string selected)
    {
        if (!IsSuccess(data) || StringProperty(data, "profile") != selected)
            return "Unknown (profile mismatch or invalid receipt)";
        var running = BooleanProperty(data, "running");
        var verified = BooleanProperty(data, "verified");
        if (running == true && verified == true)
            return "Running - local identity verified";
        if (running == false && verified == false)
            return "Stopped (CLI reported)";
        return "Unknown - runtime evidence inconsistent or unavailable";
    }

    private static string? BuildProfileList(JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("profiles", out var list) ||
            list.ValueKind != JsonValueKind.Array) return null;
        var names = list.EnumerateArray().Take(52).Select(p => p.ValueKind == JsonValueKind.String ? p.GetString() : null).ToArray();
        if (names.Any(n => n is null || !IsSafeProfile(n))) return null;
        return names.Length == 0 ? "None configured" : string.Join(", ", names);
    }

    private static async Task<string> ReadLimitedOutputAsync(Stream stream, CancellationToken token)
    {
        using var output = new MemoryStream();
        var buffer = new byte[4096];
        while (true)
        {
            var count = await stream.ReadAsync(buffer.AsMemory(), token);
            if (count == 0) break;
            if (output.Length + count > 24_000)
                throw new InvalidDataException("CLI response exceeded output limit");
            output.Write(buffer, 0, count);
        }
        return Encoding.UTF8.GetString(output.ToArray());
    }
    /// <summary>One bounded local CLI call. Exit status, valid JSON and explicit ok=true are required.</summary>
    private async Task<JsonDocument> ReadCliAsync(string action, string selected, CancellationToken token)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo(executable)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
                WorkingDirectory = managedRoot
            }
        };
        process.StartInfo.ArgumentList.Add("--" + action);
        process.StartInfo.ArgumentList.Add("--target");
        process.StartInfo.ArgumentList.Add(managedRoot);
        process.StartInfo.ArgumentList.Add("--profile");
        process.StartInfo.ArgumentList.Add(selected);
        if (!process.Start()) throw new IOException("Backend CLI could not start");
        try
        {
            var outTask = ReadLimitedOutputAsync(process.StandardOutput.BaseStream, token);
            var errTask = ReadLimitedOutputAsync(process.StandardError.BaseStream, token);
            await process.WaitForExitAsync(token);
            var raw = await outTask;
            var err = await errTask;
            if (process.ExitCode != 0) throw new InvalidDataException("CLI failed: " + action + " (exit " + process.ExitCode + ")");
            var parsed = JsonDocument.Parse(raw);
            try
            {
                CommanderJsonGuard.RequireUniqueKeys(parsed.RootElement);
                if (!IsSuccess(parsed.RootElement))
                    throw new InvalidDataException("CLI did not return ok=true: " + action);
                return parsed;
            }
            catch
            {
                parsed.Dispose();
                throw;
            }
        }
        finally
        {
            if (!process.HasExited)
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                try { await process.WaitForExitAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2)); }
                catch (TimeoutException) { /* Outcome unknown; process cleanup requires OS reconciliation. */ }
            }
        }
    }

    private async Task RefreshStatusAsync()
    {
        if (busy || IsDisposed || Disposing || lifetime.IsCancellationRequested ||
            profile.SelectedItem is not string selected || !IsSafeProfile(selected)) return;
        busy = true; refresh.Enabled = false; profile.Enabled = false; copyDiagnostics.Enabled = false;
        var currentGeneration = ++generation;
        ClearEvidence();
        state.Text = selected + "  |  Querying owner-local CLI...";
        using var source = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        request = source;
        source.CancelAfter(RefreshTimeout);
        try
        {
            var marker = Path.Combine(managedRoot, "product.json");
            if (!File.Exists(marker) || (File.GetAttributes(marker) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("Owner-managed installation marker unavailable");
            using (var manifest = JsonDocument.Parse(File.ReadAllText(marker)))
            {
                CommanderJsonGuard.RequireUniqueKeys(manifest.RootElement);
                var identity = manifest.RootElement;
                if (StringProperty(identity, "product") != "ChatGPTRemoteCommander" ||
                    !identity.TryGetProperty("schema", out var schema) ||
                    schema.ValueKind != JsonValueKind.Number || schema.GetInt32() != 1)
                    throw new InvalidDataException("Managed marker identity mismatch");
            }
            if (!File.Exists(executable)) throw new FileNotFoundException("Installed Commander CLI not found");
            var attrs = File.GetAttributes(executable);
            if ((attrs & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("CLI alias is not trusted");
            using var installed = await ReadCliAsync("status", selected, source.Token);
            if (IsDisposed || Disposing || lifetime.IsCancellationRequested ||
                generation != currentGeneration || source.IsCancellationRequested) return;
            var info = installed.RootElement;
            var product = StringProperty(info, "product");
            if (product != "ChatGPTRemoteCommander") throw new InvalidDataException("Installed product mismatch");
            if (!ProfileInStatus(info, selected)) throw new InvalidDataException("Selected profile missing from installer status");
            var build = SafeLabel(StringProperty(info, "build"));
            var mode = SafeLabel(StringProperty(info, "mode"), 50);
            var managed = BooleanProperty(info, "oneManagedInstall");
            SetTile("Managed host", "Local managed install\n" + build + "\n" + (managed == true ? "Owner CLI reports one install" : "Install count unverified"), "CLI --status");
            var names = BuildProfileList(info);
            if (names != null) SetTile("Profiles / accounts", "Configured profiles:\n" + names + "\nAccount authentication unknown", "CLI --status");
            SetTile("Permissions", "Package mode: " + mode + "\nOS grants unverified", "CLI --status is not native elevation proof");
            details.Text = "--status: verified local response at " + DateTimeOffset.Now.ToString("O") + Environment.NewLine +
                "Product: " + product + Environment.NewLine + "Build: " + build + Environment.NewLine +
                "Package mode: " + mode + " (not a native OS grant)";

            // Fail each independent feed separately; never turn backend failure into green.
            try
            {
                using var runtime = await ReadCliAsync("runtime-status", selected, source.Token);
                if (IsDisposed || Disposing || lifetime.IsCancellationRequested ||
                generation != currentGeneration || source.IsCancellationRequested) return;
                var running = BooleanProperty(runtime.RootElement, "running");
                var verified = BooleanProperty(runtime.RootElement, "verified");
                var same = StringProperty(runtime.RootElement, "profile") == selected;
                SetTile("Runtime / connection", RuntimeStatusTile(runtime.RootElement, selected), "CLI --runtime-status");
                details.AppendText(Environment.NewLine + "--runtime-status: " + (same ? "profile matched" : "profile mismatch") +
                    ", running=" + (running?.ToString() ?? "unknown") +
                    ", verified=" + (verified?.ToString() ?? "unknown"));
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                details.AppendText(Environment.NewLine + "--runtime-status unavailable: " + e.GetType().Name);
                SetTile("Errors", "Runtime status read failed (" + e.GetType().Name + ")", "CLI --runtime-status");
            }
            try
            {
                using var autostart = await ReadCliAsync("autostart-status", selected, source.Token);
                if (IsDisposed || Disposing || lifetime.IsCancellationRequested ||
                generation != currentGeneration || source.IsCancellationRequested) return;
                if (StringProperty(autostart.RootElement, "profile") != selected)
                    throw new InvalidDataException("Autostart profile mismatch");
                var enabled = BooleanProperty(autostart.RootElement, "autostartEnabled");
                var reconcile = BooleanProperty(autostart.RootElement, "reconcileRequired");
                details.AppendText(Environment.NewLine + "--autostart-status: enabled=" +
                    (enabled?.ToString() ?? "unknown") + ", reconciliation=" + (reconcile?.ToString() ?? "unknown"));
                SetTile("Update / rollback", "Autostart: " + (enabled == true ? "enabled" : enabled == false ? "disabled" : "unknown") +
                    "\nUpdate / rollback state unknown" + (reconcile == true ? "\nAutostart reconciliation needed" : ""),
                    "CLI --autostart-status (not update health)");
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                details.AppendText(Environment.NewLine + "--autostart-status unavailable: " + e.GetType().Name);
                var priorError = tiles["Errors"].Text.Contains("read failed", StringComparison.Ordinal);
                SetTile("Errors", priorError ? "Multiple CLI read failures" :
                    "Autostart status read failed (" + e.GetType().Name + ")", "CLI --autostart-status");
            }
            if (generation == currentGeneration && !source.IsCancellationRequested)
                state.Text = selected + " | Local CLI checks completed; unavailable feeds remain unknown";
        }
        catch (OperationCanceledException)
        {
            // CancelAfter marks source as cancelled too. Only the owner form's
            // closure or a superseding selection should suppress this warning.
            // A real elapsed timeout must clear partial evidence and be visible.
            if (!IsDisposed && !Disposing && !lifetime.IsCancellationRequested &&
                generation == currentGeneration)
            {
                ClearEvidence(); state.Text = "Timeout / cancellation - do not infer health";                SetTile("Errors", "Read timed out or was cancelled", "CLI observation incomplete");
            }
        }
        catch (Exception e)
        {
            if (IsDisposed || Disposing || lifetime.IsCancellationRequested ||
                source.IsCancellationRequested || generation != currentGeneration) return;
            ClearEvidence(); state.Text = "Local status unavailable: " + e.GetType().Name;
            details.Text = "No verified observation: " + e.GetType().Name;
            SetTile("Errors", "Installed status failed (" + e.GetType().Name + ")", "CLI --status");
        }
        finally
        {
            if (ReferenceEquals(request, source)) request = null;
            busy = false;
            if (!IsDisposed && !Disposing && !lifetime.IsCancellationRequested)
            {
                refresh.Enabled = true; profile.Enabled = true; copyDiagnostics.Enabled = true;
            }
        }
    }
}
