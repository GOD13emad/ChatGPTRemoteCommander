using System;
using System.Windows.Forms;
using System.Drawing;

public sealed class RcManagerNoticeForm : Form {
  private readonly Label body;
  private readonly Button reject;
  public bool Rejected { get; private set; }
  public RcManagerNoticeForm() {
    Text = "Commander — درخواست کنترل موقت";
    Width = 480; Height = 172;
    FormBorderStyle = FormBorderStyle.FixedToolWindow;
    StartPosition = FormStartPosition.Manual;
    var area = Screen.PrimaryScreen.WorkingArea;
    Left = Math.Max(area.Left, area.Right - Width - 24);
    Top = Math.Max(area.Top, area.Bottom - Height - 24);
    TopMost = true; ShowInTaskbar = false;
    body = new Label { Left=18,Top=16,Width=430,Height=54,
      Text="Commander درخواست کنترل موقت دارد. اگر نمی‌خواهید کنترل را واگذار کنید، «رد کنترل» را بزنید. در صورت عدم رد تا ۶۰ ثانیه، ورودی فیزیکی موقتاً مسدود می‌شود." };
    reject = new Button { Left=318,Top=82,Width=130,Height=34,Text="رد کنترل" };
    reject.Click += (sender,e) => { Rejected=true; Close(); };
    Controls.Add(body); Controls.Add(reject); AcceptButton=reject;
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { var cp=base.CreateParams; cp.ExStyle |= 0x08000000 | 0x00000080; return cp; }
  }
  public void CloseForApproval() { if(!IsDisposed) Close(); }
}
