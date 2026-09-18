using System.Text.Json;
using System.Drawing;
using System.Windows.Forms;

if (args.Length < 2) throw new ArgumentException("ready/result paths required");
var readyPath = Path.GetFullPath(args[0]);
var resultPath = Path.GetFullPath(args[1]);
Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
Application.EnableVisualStyles();

var form = new Form {
    Text = "Remote Commander GUI E2E",
    StartPosition = FormStartPosition.Manual,
    Location = new Point(180, 160),
    ClientSize = new Size(900, 440),
    KeyPreview = true,
    TopMost = true
};
var title = new Label { Text = "Remote Commander v0.5 native GUI test", AutoSize = true, Location = new Point(70, 40), Font = new Font("Segoe UI", 16) };
var box = new TextBox { Name = "MarkerBox", Location = new Point(70, 110), Size = new Size(700, 36), Font = new Font("Segoe UI", 14) };
var button = new Button { Name = "CommitButton", Text = "Commit GUI test", Location = new Point(70, 200), Size = new Size(230, 60), Font = new Font("Segoe UI", 12) };
var label = new Label { Name = "ResultLabel", Text = "WAITING", AutoSize = true, Location = new Point(70, 310), Font = new Font("Segoe UI", 14) };
form.Controls.AddRange(new Control[] { title, box, button, label });

void WriteReady() {
    var textPoint = box.PointToScreen(new Point(box.Width / 2, box.Height / 2));
    var buttonPoint = button.PointToScreen(new Point(button.Width / 2, button.Height / 2));
    var state = new {
        handle = form.Handle.ToInt64().ToString(),
        pid = Environment.ProcessId,
        textX = textPoint.X, textY = textPoint.Y,
        buttonX = buttonPoint.X, buttonY = buttonPoint.Y,
        bounds = new { form.Left, form.Top, form.Width, form.Height }
    };
    File.WriteAllText(readyPath, JsonSerializer.Serialize(state));
}
button.Click += (_, _) => {
    label.Text = "PASS: " + box.Text;
    File.WriteAllText(resultPath, JsonSerializer.Serialize(new { ok = true, text = box.Text, clickedUtc = DateTimeOffset.UtcNow.ToString("O") }));
};
form.Shown += (_, _) => form.BeginInvoke(() => {
    form.Activate();
    box.Focus();
    WriteReady();
});
form.FormClosed += (_, _) => {
    try { if (File.Exists(readyPath)) File.Delete(readyPath); } catch {}
};
Application.Run(form);
