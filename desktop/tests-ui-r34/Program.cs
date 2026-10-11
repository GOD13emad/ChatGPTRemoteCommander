using System.Drawing;
using System.Windows.Forms;

namespace RemoteCommander;

internal sealed record ProfileRow(
    string Name, int Generation, string Version, string Commit,
    int BackendPort, int RouterPort, int RouterPid,
    DateTimeOffset? UpdatedAt, string ProjectDir);

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        ApplicationConfiguration.Initialize();
        var chrome = new DashboardChrome();
        if (chrome.Metrics is not TableLayoutPanel table || table.ColumnCount != 4)
            throw new Exception("R34_METRIC_GRID_CARDINALITY");
        if (table.Controls.Count != 4)
            throw new Exception("R34_MISSING_METRICS");

        var cards = new FlowLayoutPanel { Width = 900, Height = 500 };
        var primary = new Panel { Tag = "primary", Width = 700, Height = 100 };
        var secondary = new Panel { Tag = "secondary", Width = 700, Height = 100 };
        cards.Controls.Add(primary);
        cards.Controls.Add(secondary);
        chrome.Attach(cards);
        chrome.ApplyTheme(false);
        var backgroundLight = table.BackColor;
        chrome.ApplyTheme(true);
        var backgroundDark = table.BackColor;
        if (backgroundLight == backgroundDark)
            throw new Exception("R34_DARK_LIGHT_THEME_NOT_APPLIED");

        var profiles = new ProfileRow[] {
            new("default", 34, "0.10.20", "362375c", 48831, 48831, 42, null, "C:/private")
        };
        chrome.Update(profiles);
        var actual = table.Controls.OfType<Panel>()
            .SelectMany(p => p.Controls.OfType<Label>())
            .Select(l => l.Text).ToArray();
        if (!actual.Contains("1") || !actual.Contains("0.10.20")
            || !actual.Contains("UNVERIFIED") || !actual.Contains("READ ONLY"))
            throw new Exception("R34_FALSE_METRIC_VALUES");

        if (chrome.Search is not Panel search || search.Controls.OfType<TextBox>().Count() != 1)
            throw new Exception("R34_MISSING_ACCESSIBLE_SEARCH");
        var field = search.Controls.OfType<TextBox>().Single();
        if (field.AccessibleName != "Filter verified local routing profiles")
            throw new Exception("R34_SEARCH_A11Y");
        field.Text = "primary";
        chrome.ApplyFilter();
        if (!primary.Visible && secondary.Visible)
            throw new Exception("R34_FILTER_IGNORED");

        DashboardChrome.RoundCard(primary, 16);
        primary.Size = new Size(700, 110);
        if (primary.Region is null)
            throw new Exception("R34_ROUNDED_CARD_REGION");
        chrome.Footer.Dispose();
        chrome.Search.Dispose();
        chrome.Metrics.Dispose();
        cards.Dispose();
        Console.WriteLine("R34_NATIVE_WINFORMS_STRUCTURE_THEME_A11Y_NO_SCREEN_PASS");
        return 0;
    }
}
