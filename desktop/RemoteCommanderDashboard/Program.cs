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
        actions.Controls.Add(Button("Open Browser", (_, _) => LaunchBrowser()));
        actions.Controls.Add(Button("Copy Diagnostics", (_, _) => CopyDiagnostics()));

        Controls.Add(cards);
        Controls.Add(actions);
        Controls.Add(header);

        Shown += async (_, _) => await RefreshAsync();
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

    private async Task RefreshAsync()
    {
        cards.Controls.Clear();
        var profiles = LoadProfiles();
        summary.Text = profiles.Count == 0
            ? "No routing profiles discovered."
            : $"{profiles.Count} profile(s) • read-only dashboard • {Environment.MachineName}";

        foreach (var p in profiles)
            cards.Controls.Add(await ProfileCardAsync(p));
    }

    private List<ProfileRow> LoadProfiles()
    {
        var routing = Path.Combine(stateRoot, "routing");
        var result = new List<ProfileRow>();
        if (!Directory.Exists(routing)) return result;

        foreach (var file in Directory.EnumerateFiles(routing, "*.json")
                     .Where(x => !x.EndsWith(".runtime.json", StringComparison.OrdinalIgnoreCase))
                     .OrderBy(x => x, StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(file));
                var root = doc.RootElement;
                var name = root.TryGetProperty("profile", out var profile) ? profile.GetString() ?? Path.GetFileNameWithoutExtension(file) : Path.GetFileNameWithoutExtension(file);
                var generation = root.TryGetProperty("generation", out var gen) ? gen.GetInt32() : 0;
                var active = root.GetProperty("active");
                var version = active.TryGetProperty("version", out var ver) ? ver.GetString() ?? "unknown" : "unknown";
                var commit = active.TryGetProperty("commit", out var sha) ? sha.GetString() ?? "" : "";
                var backendPort = active.TryGetProperty("port", out var bp) ? bp.GetInt32() : 0;
                var projectDir = active.TryGetProperty("projectDir", out var pd) ? pd.GetString() ?? "" : "";
                DateTimeOffset? updated = root.TryGetProperty("updatedAt", out var ua) &&
                                          DateTimeOffset.TryParse(ua.GetString(), out var parsed) ? parsed : null;

                var runtimePath = Path.Combine(routing, name + ".runtime.json");
                var routerPort = 0;
                var routerPid = 0;
                if (File.Exists(runtimePath))
                {
                    using var runtime = JsonDocument.Parse(File.ReadAllText(runtimePath));
                    var rr = runtime.RootElement;
                    routerPort = rr.TryGetProperty("port", out var rp) ? rp.GetInt32() : 0;
                    routerPid = rr.TryGetProperty("pid", out var pid) ? pid.GetInt32() : 0;
                }

                result.Add(new ProfileRow(name, generation, version, commit, backendPort, routerPort, routerPid, updated, projectDir));
            }
            catch
            {
                // Fail closed: malformed profile state is not rendered as healthy.
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