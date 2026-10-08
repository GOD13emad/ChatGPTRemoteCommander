using System.Diagnostics;
using Microsoft.Win32;
using System.Drawing;
using System.Net.Http;
using System.Text.Json;
using System.Windows.Forms;

namespace RemoteCommander;

internal sealed record ProfileRow(
    string Name,
    int Generation,
    string Version,
    string Commit,
    int BackendPort,
    int RouterPort,
    int RouterPid,
    DateTimeOffset? UpdatedAt,
    string ProjectDir);

internal sealed class DashboardForm : Form
{
    private readonly string stateRoot =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ChatGPTRemoteCommander");
    private readonly FlowLayoutPanel cards = new()
    {
        Dock = DockStyle.Fill,
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        AutoScroll = true,
        Padding = new Padding(18, 10, 18, 18)
    };
    private readonly Label summary = new()
    {
        AutoSize = true,
        ForeColor = Color.FromArgb(185, 199, 221),
        Font = new Font("Segoe UI", 9.5f)
    };
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(1.5) };

    // User-level theme preference. Default is System; a change to the Windows
    // AppsUseLightTheme registry value is observed without a Browser reload.
    private int themeMode; // 0 System, 1 Light, 2 Dark (session scoped)
    private bool dark;
    private Panel? headerPanel;
    private FlowLayoutPanel? actionsPanel;
    private Label? titleLabel;
    private Button? themeButton;
    private readonly System.Windows.Forms.Timer themeTimer = new() { Interval = 3000 };

    private static bool SystemDark()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", false);
            return key?.GetValue("AppsUseLightTheme") is int value && value == 0;
        }
        catch { return false; } // legible light fallback when the OS key is missing
    }

    private Button ToolButton(string text, string file, string description)
    {
        var button = Button(text, (_, _) => LaunchPowerShellTool(file, text));
        button.Enabled = ToolInstalled(file);
        button.AccessibleDescription = button.Enabled ? description : description + " — missing installed helper";
        if (!button.Enabled) button.Text = text + " (not installed)";
        return button;
    }

    private void ApplyTheme(bool force = false)
    {
        var next = themeMode == 2 || (themeMode == 0 && SystemDark());
        if (!force && next == dark) return;
        dark = next;
        var canvas = dark ? Color.FromArgb(16, 24, 39) : Color.FromArgb(246, 248, 252);
        var panel = dark ? Color.FromArgb(28, 40, 58) : Color.White;
        var text = dark ? Color.FromArgb(242, 247, 252) : Color.FromArgb(21, 35, 55);
        var muted = dark ? Color.FromArgb(183, 203, 224) : Color.FromArgb(80, 99, 122);
        var buttonBg = dark ? Color.FromArgb(39, 57, 79) : Color.FromArgb(233, 240, 250);
        var accent = dark ? Color.FromArgb(139, 191, 255) : Color.FromArgb(32, 96, 211);
        BackColor = canvas;
        ForeColor = text;
        cards.BackColor = canvas;
        summary.ForeColor = muted;
        if (headerPanel is not null) headerPanel.BackColor = canvas;
        if (actionsPanel is not null)
        {
            actionsPanel.BackColor = canvas;
            foreach (var control in actionsPanel.Controls.OfType<Button>())
            {
                control.BackColor = buttonBg;
                control.ForeColor = control.Enabled ? text : muted;
                control.FlatAppearance.BorderColor = accent;
            }
        }
        if (titleLabel is not null) titleLabel.ForeColor = text;
        if (themeButton is not null)
            themeButton.Text = themeMode == 0 ? (dark ? "Theme: System (Dark)" : "Theme: System (Light)")
                             : themeMode == 1 ? "Theme: Light" : "Theme: Dark";
        foreach (var card in cards.Controls.OfType<Panel>())
        {
            card.BackColor = panel;
            var labels = card.Controls.OfType<Label>().ToArray();
            if (labels.Length > 0) labels[0].ForeColor = labels[0].Text.Contains("● ONLINE", StringComparison.Ordinal) ? (dark ? Color.FromArgb(117, 228, 171) : Color.FromArgb(13, 123, 74)) : (dark ? Color.FromArgb(255, 191, 123) : Color.FromArgb(165, 87, 29));
            if (labels.Length > 1) labels[1].ForeColor = text;
            if (labels.Length > 2) labels[2].ForeColor = muted;
            if (labels.Length > 3) labels[3].ForeColor = muted;
        }
        Invalidate(true);
    }

    public DashboardForm()
    {
        Text = "Remote Commander";
        Width = 1100;
        Height = 740;
        MinimumSize = new Size(850, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(7, 22, 47);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10f);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

        var header = new Panel { Dock = DockStyle.Top, Height = 112, Padding = new Padding(24, 18, 24, 12) };
        var title = new Label
        {
            Text = "Remote Commander",
            AutoSize = true,
            ForeColor = Color.White,
            Font = new Font("Segoe UI Semibold", 22f, FontStyle.Bold),
            Location = new Point(24, 18)
        };
        summary.Location = new Point(27, 60);
        header.Controls.Add(title);
        header.Controls.Add(summary);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 110,
            AutoScroll = true,
            WrapContents = true,
            Padding = new Padding(20, 8, 20, 8),
            FlowDirection = FlowDirection.LeftToRight
        };
        themeButton = Button("Theme: System", (_, _) => { themeMode = (themeMode + 1) % 3; ApplyTheme(true); });
        themeButton.AccessibleDescription = "Cycle System, Light and Dark. System tracks Windows app theme.";
        actions.Controls.Add(themeButton);
        actions.Controls.Add(Button("Refresh", async (_, _) => await RefreshAsync()));
        actions.Controls.Add(ToolButton("Add Profile", "profile-enrollment-windows.ps1",
            "Owner-authorized profile enrollment with existing Core validation"));
        actions.Controls.Add(ToolButton("Manage Profiles", "profile-manager-windows.ps1",
            "Manage profile connection and permissions using the installed native tool"));
        actions.Controls.Add(ToolButton("Workflow Monitor", "operations-monitor-windows.ps1",
            "Read-only durable task status, revision and diagnostic evidence"));
        actions.Controls.Add(ToolButton("Admin Runtime", "admin-runtime-windows.ps1",
            "Existing user-visible Windows privilege and boot recovery diagnostics"));
        actions.Controls.Add(Button("Browser", (_, _) => LaunchBrowser()));
        actions.Controls.Add(Button("Open Logs", (_, _) => OpenPath(Path.Combine(stateRoot, "update-logs"))));
        actions.Controls.Add(Button("Open Data", (_, _) => OpenPath(stateRoot)));
        actions.Controls.Add(Button("Copy Diagnostics", (_, _) => CopyDiagnostics()));

        Controls.Add(cards);
        Controls.Add(actions);
        Controls.Add(header);
        headerPanel = header;
        titleLabel = title;
        actionsPanel = actions;
        themeTimer.Tick += (_, _) => ApplyTheme();
        FormClosed += (_, _) => themeTimer.Stop();

        Shown += async (_, _) =>
        {
            ApplyTheme(true);
            themeTimer.Start();
            await RefreshAsync();
            LaunchPendingProfileOnboarding();
        };
    }

    private Button Button(string text, EventHandler handler)
    {
        var b = new Button
        {
            Text = text,
            AutoSize = true,
            Height = 34,
            Padding = new Padding(12, 2, 12, 2),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(18, 52, 91),
            ForeColor = Color.White,
            Cursor = Cursors.Hand
        };
        b.FlatAppearance.BorderColor = Color.FromArgb(55, 205, 255);
        b.Click += handler;
        return b;
    }

    private int refreshEpoch;

    private async Task RefreshAsync()
    {
        var epoch = Interlocked.Increment(ref refreshEpoch);
        var profiles = LoadProfiles();
        var rendered = new List<Control>(profiles.Count);

        foreach (var p in profiles)
            rendered.Add(await ProfileCardAsync(p));

        if (epoch != Volatile.Read(ref refreshEpoch) || IsDisposed)
        {
            foreach (var control in rendered) control.Dispose();
            return;
        }

        cards.SuspendLayout();
        try
        {
            cards.Controls.Clear();
            summary.Text = profiles.Count == 0
                ? "No routing profiles discovered."
                : $"{profiles.Count} profile(s) • read-only dashboard • {Environment.MachineName}";
            cards.Controls.AddRange(rendered.ToArray());
            ApplyTheme(true);
        }
        finally
        {
            cards.ResumeLayout();
        }
    }

    private List<ProfileRow> LoadProfiles()
    {
        var routing = Path.Combine(stateRoot, "routing");
        var result = new List<ProfileRow>();
        if (!Directory.Exists(routing)) return result;

        foreach (var runtimePath in Directory.EnumerateFiles(routing, "*.runtime.json")
                     .OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var fileName = Path.GetFileName(runtimePath);
                var name = fileName[..^".runtime.json".Length];
                if (string.IsNullOrWhiteSpace(name) ||
                    name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    continue;

                var statePath = Path.Combine(routing, name + ".json");
                if (!File.Exists(statePath))
                    continue;

                using var doc = JsonDocument.Parse(File.ReadAllText(statePath));
                var root = doc.RootElement;
                if (!root.TryGetProperty("profile", out var profile) ||
                    !string.Equals(profile.GetString(), name, StringComparison.Ordinal))
                    continue;

                using var runtime = JsonDocument.Parse(File.ReadAllText(runtimePath));
                var rr = runtime.RootElement;
                if (!rr.TryGetProperty("stateFile", out var stateFile) ||
                    !string.Equals(Path.GetFullPath(stateFile.GetString() ?? ""),
                        Path.GetFullPath(statePath), StringComparison.OrdinalIgnoreCase))
                    continue;

                var generation = root.TryGetProperty("generation", out var gen) ? gen.GetInt32() : 0;
                var active = root.GetProperty("active");
                var version = active.TryGetProperty("version", out var ver) ? ver.GetString() ?? "unknown" : "unknown";
                var commit = active.TryGetProperty("commit", out var sha) ? sha.GetString() ?? "" : "";
                var backendPort = active.TryGetProperty("port", out var bp) ? bp.GetInt32() : 0;
                var projectDir = active.TryGetProperty("projectDir", out var pd) ? pd.GetString() ?? "" : "";
                DateTimeOffset? updated = root.TryGetProperty("updatedAt", out var ua) &&
                                      DateTimeOffset.TryParse(ua.GetString(), out var parsed) ? parsed : null;
                var routerPort = rr.TryGetProperty("port", out var rp) ? rp.GetInt32() : 0;
                var routerPid = rr.TryGetProperty("pid", out var pid) ? pid.GetInt32() : 0;

                result.Add(new ProfileRow(name, generation, version, commit, backendPort, routerPort, routerPid, updated, projectDir));
            }
            catch
            {
                // Fail closed: only a canonical state/runtime pair is rendered.
            }
        }
        return result;
    }

    private async Task<Control> ProfileCardAsync(ProfileRow p)
    {
        var card = new Panel
        {
            Width = Math.Max(680, cards.ClientSize.Width - 48),
            Height = 132,
            Margin = new Padding(0, 0, 0, 12),
            Padding = new Padding(18),
            BackColor = Color.FromArgb(12, 34, 65)
        };

        var online = await IsHealthyAsync(p.RouterPort, p.RouterPid);
        var dot = new Label
        {
            Text = online ? "● ONLINE" : "● OFFLINE / UNVERIFIED",
            ForeColor = online ? Color.FromArgb(80, 220, 150) : Color.FromArgb(255, 164, 92),
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 9.5f),
            Location = new Point(18, 18)
        };
        var name = new Label
        {
            Text = p.Name,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 14f),
            ForeColor = Color.White,
            Location = new Point(18, 44)
        };
        var version = new Label
        {
            Text = $"v{p.Version} • generation {p.Generation} • backend {p.BackendPort} • router {p.RouterPort}",
            AutoSize = true,
            ForeColor = Color.FromArgb(190, 207, 229),
            Location = new Point(20, 75)
        };
        var commit = new Label
        {
            Text = string.IsNullOrWhiteSpace(p.Commit) ? "commit unknown" : $"commit {p.Commit[..Math.Min(12, p.Commit.Length)]}",
            AutoSize = true,
            ForeColor = Color.FromArgb(139, 166, 200),
            Location = new Point(20, 99)
        };
        card.Controls.Add(dot);
        card.Controls.Add(name);
        card.Controls.Add(version);
        card.Controls.Add(commit);
        return card;
    }

    private async Task<bool> IsHealthyAsync(int routerPort, int pid)
    {
        if (routerPort <= 0 || pid <= 0) return false;
        try
        {
            using var process = Process.GetProcessById(pid);
            if (process.HasExited) return false;
            using var response = await http.GetAsync($"http://127.0.0.1:{routerPort}/health");
            return response.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    private bool onboardingLaunched;

    private void LaunchPendingProfileOnboarding()
    {
        if (onboardingLaunched || !ToolInstalled("profile-enrollment-windows.ps1")) return;
        var queue = Path.Combine(stateRoot, "onboarding", "requested-profiles.txt");
        if (!File.Exists(queue)) return;
        try
        {
            if (!File.ReadLines(queue).Any(line => !string.IsNullOrWhiteSpace(line))) return;
        }
        catch { return; }
        onboardingLaunched = true;
        LaunchPowerShellTool("profile-enrollment-windows.ps1", "Profile Setup");
    }

    private static bool ToolInstalled(string fileName) =>
        File.Exists(Path.Combine(AppContext.BaseDirectory, fileName));

    private void LaunchPowerShellTool(string fileName, string displayName)
    {
        var tool = Path.Combine(AppContext.BaseDirectory, fileName);
        if (!File.Exists(tool))
        {
            MessageBox.Show(this, $"{displayName} is not installed.", "Remote Commander",
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        var pwsh = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "PowerShell", "7", "pwsh.exe");
        if (!File.Exists(pwsh)) pwsh = "pwsh.exe";

        Process.Start(new ProcessStartInfo
        {
            FileName = pwsh,
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            Arguments = $"-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"{tool}\""
        });
    }

    private void LaunchBrowser()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Remote Commander Browser", "current", "chatgpt-cef-v2.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Remote Commander Browser", "current", "RemoteCommanderBrowser.exe")
        };
        var target = candidates.FirstOrDefault(File.Exists);
        if (target is null)
        {
            MessageBox.Show(this, "Remote Commander Browser is not installed yet.", "Remote Commander",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
    }

    private void OpenPath(string path)
    {
        if (!Directory.Exists(path)) Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }

    private void CopyDiagnostics()
    {
        var lines = LoadProfiles().Select(p =>
            $"{p.Name}: v{p.Version}, generation={p.Generation}, backend={p.BackendPort}, router={p.RouterPort}, commit={p.Commit}");
        Clipboard.SetText(string.Join(Environment.NewLine, lines));
        MessageBox.Show(this, "Profile diagnostics copied to clipboard.", "Remote Commander",
            MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) http.Dispose();
        base.Dispose(disposing);
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new DashboardForm());
    }
}
