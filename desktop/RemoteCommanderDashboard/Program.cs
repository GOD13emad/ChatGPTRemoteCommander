using System.Diagnostics;
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

    public DashboardForm()
    {
        Text = "Remote Commander";
        Width = 940;
        Height = 650;
        MinimumSize = new Size(760, 520);
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
            Height = 58,
            Padding = new Padding(20, 8, 20, 8),
            FlowDirection = FlowDirection.LeftToRight
        };
        actions.Controls.Add(Button("Refresh", async (_, _) => await RefreshAsync()));
        actions.Controls.Add(Button("Open Logs", (_, _) => OpenPath(Path.Combine(stateRoot, "update-logs"))));
        actions.Controls.Add(Button("Open Data", (_, _) => OpenPath(stateRoot)));
        if (ToolInstalled("profile-enrollment-windows.ps1"))
            actions.Controls.Add(Button("Add Profiles", (_, _) => LaunchPowerShellTool("profile-enrollment-windows.ps1", "Profile Setup")));
        if (ToolInstalled("profile-manager-windows.ps1"))
            actions.Controls.Add(Button("Profiles & Access", (_, _) => LaunchPowerShellTool("profile-manager-windows.ps1", "Profiles & Access")));
        if (ToolInstalled("operations-monitor-windows.ps1"))
            actions.Controls.Add(Button("Operations Monitor", (_, _) => LaunchPowerShellTool("operations-monitor-windows.ps1", "Operations Monitor")));
        if (ToolInstalled("admin-runtime-windows.ps1"))
            actions.Controls.Add(Button("Admin Runtime", (_, _) => LaunchPowerShellTool("admin-runtime-windows.ps1", "Admin Runtime")));
        actions.Controls.Add(Button("Browser", (_, _) => LaunchBrowser()));
        actions.Controls.Add(Button("Copy Diagnostics", (_, _) => CopyDiagnostics()));

        Controls.Add(cards);
        Controls.Add(actions);
        Controls.Add(header);

        Shown += async (_, _) =>
        {
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
