using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

internal static class Data
{
    internal static Dictionary<string, object> Map(object value) { return value as Dictionary<string, object> ?? new Dictionary<string, object>(); }
    internal static object Get(object value, string key) { object item; return Map(value).TryGetValue(key, out item) ? item : null; }
    internal static string Text(object value, string key) { return Convert.ToString(Get(value, key), CultureInfo.InvariantCulture); }
    internal static IEnumerable<object> Rows(object value) { return (value as IEnumerable ?? new object[0]).Cast<object>(); }
}

internal sealed class Backend : IDisposable
{
    private readonly Process process;
    private readonly Dictionary<int, TaskCompletionSource<object>> pending = new Dictionary<int, TaskCompletionSource<object>>();
    private int sequence;
    private readonly object gate = new object();
    private bool disposed;

    internal Backend(string node, string script)
    {
        process = new Process { StartInfo = new ProcessStartInfo(node, "--disable-warning=ExperimentalWarning \"" + script + "\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        }, EnableRaisingEvents = true };
        process.OutputDataReceived += Receive;
        process.ErrorDataReceived += delegate { };
        process.Exited += delegate { FailPending("桌面面板后台已退出，请重新打开面板。"); };
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
    }

    private void Receive(object sender, DataReceivedEventArgs args)
    {
        if (String.IsNullOrEmpty(args.Data)) return;
        try
        {
            var reply = Data.Map(new JavaScriptSerializer { MaxJsonLength = 8388608 }.DeserializeObject(args.Data));
            int id = Convert.ToInt32(reply["id"]);
            TaskCompletionSource<object> completion;
            lock (gate) { if (!pending.TryGetValue(id, out completion)) return; pending.Remove(id); }
            if (reply.ContainsKey("error")) completion.TrySetException(new Exception(Convert.ToString(reply["error"])));
            else completion.TrySetResult(reply["result"]);
        }
        catch { FailPending("桌面面板后台响应格式错误。"); }
    }

    internal async Task<object> Call(string method, object args = null)
    {
        int id;
        var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (gate)
        {
            if (disposed || process.HasExited) throw new Exception("桌面面板后台连接已关闭。");
            id = ++sequence;
            pending.Add(id, completion);
            try
            {
                byte[] request = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new { id, method, args = args ?? new { } }) + "\n");
                process.StandardInput.BaseStream.Write(request, 0, request.Length);
                process.StandardInput.BaseStream.Flush();
            }
            catch { pending.Remove(id); throw; }
        }
        if (await Task.WhenAny(completion.Task, Task.Delay(method == "install_update" ? 300000 : 180000)) != completion.Task)
        {
            lock (gate) { pending.Remove(id); }
            throw new Exception("操作超时，请稍后重试。");
        }
        return await completion.Task;
    }

    private void FailPending(string message)
    {
        lock (gate) { foreach (var item in pending.Values) item.TrySetException(new Exception(message)); pending.Clear(); }
    }

    public void Dispose()
    {
        lock (gate) { disposed = true; }
        FailPending("面板已退出。");
        try { if (!process.HasExited) process.Kill(); } catch (InvalidOperationException) { }
        process.Dispose();
    }
}

internal static class Ui
{
    internal static Brush Color(string value) { return (Brush)new BrushConverter().ConvertFromString(value); }
    internal static readonly SolidColorBrush Foreground = new SolidColorBrush();
    internal static readonly SolidColorBrush Muted = new SolidColorBrush();
    internal static readonly SolidColorBrush Accent = new SolidColorBrush();
    internal static readonly SolidColorBrush Warning = new SolidColorBrush();
    internal static readonly SolidColorBrush Panel = new SolidColorBrush();
    internal static readonly SolidColorBrush Card = new SolidColorBrush();
    internal static readonly SolidColorBrush Edge = new SolidColorBrush();
    internal static readonly SolidColorBrush Surface = new SolidColorBrush();
    internal static readonly SolidColorBrush InputBackground = new SolidColorBrush();
    internal static readonly SolidColorBrush Track = new SolidColorBrush();
    static Ui() { ApplyTheme("dark"); }
    internal static void ApplyTheme(string theme)
    {
        bool light = theme == "light";
        Foreground.Color = Parse(light ? "#17212C" : "#EDF1F6");
        Muted.Color = Parse(light ? "#65717E" : "#979FAA");
        Accent.Color = Parse(light ? "#17845C" : "#75DFB1");
        Warning.Color = Parse(light ? "#A45A00" : "#F2BD86");
        Panel.Color = Parse(light ? "#FFFFFF" : "#191D23");
        Card.Color = Parse(light ? "#F0F3F6" : "#242A32");
        Edge.Color = Parse(light ? "#D0D7DF" : "#39404B");
        Surface.Color = Parse(light ? "#E5EAF0" : "#2B3038");
        InputBackground.Color = Parse(light ? "#EDF1F5" : "#303640");
        Track.Color = Parse(light ? "#D1D9E2" : "#3A414B");
    }
    private static System.Windows.Media.Color Parse(string value) { return (System.Windows.Media.Color)ColorConverter.ConvertFromString(value); }
    internal static TextBlock Text(string value, double size = 12, Brush brush = null)
    {
        return new TextBlock { Text = value, FontSize = size, Foreground = brush ?? Foreground,
            TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
    }
    internal static Button Button(string label, Action action, string hint = null)
    {
        var button = new Button { Content = label, Foreground = Foreground, Background = Surface,
            BorderThickness = new Thickness(0), Padding = new Thickness(9, 4, 9, 4),
            Margin = new Thickness(3, 0, 0, 0), Cursor = Cursors.Hand, ToolTip = hint ?? label };
        button.Click += delegate { action(); };
        return button;
    }
    internal static Window Dialog(Window owner, string title, double height)
    {
        return new Window { Owner = owner, Title = title, Width = 380, Height = height,
            Icon = owner.Icon,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize,
            Background = Panel, Foreground = Foreground, FontFamily = new FontFamily("Segoe UI"),
            Topmost = owner.Topmost, ShowInTaskbar = false };
    }
    internal static TextBox Input(string value = "")
    {
        return new TextBox { Text = value, Margin = new Thickness(0, 4, 0, 12), Padding = new Thickness(7),
            Background = InputBackground, Foreground = Foreground, BorderThickness = new Thickness(0) };
    }
    internal static TabItem Tab(string title, object content)
    {
        var border = new FrameworkElementFactory(typeof(Border), "headerBorder");
        border.SetValue(Border.BackgroundProperty, Surface.Clone());
        border.SetValue(Border.PaddingProperty, new Thickness(15, 8, 15, 8));
        border.SetValue(Border.BorderThicknessProperty, new Thickness(0, 0, 0, 2));
        border.SetValue(Border.BorderBrushProperty, Brushes.Transparent);
        var presenter = new FrameworkElementFactory(typeof(ContentPresenter));
        presenter.SetValue(ContentPresenter.ContentSourceProperty, "Header");
        border.AppendChild(presenter);
        var template = new ControlTemplate(typeof(TabItem)) { VisualTree = border };
        var selected = new Trigger { Property = TabItem.IsSelectedProperty, Value = true };
        selected.Setters.Add(new Setter(Border.BorderBrushProperty, Accent.Clone(), "headerBorder"));
        template.Triggers.Add(selected);
        return new TabItem { Header = title, Content = content, Template = template, Foreground = Foreground };
    }
}

internal sealed class ModelChoice
{
    internal string Id;
    internal string Name;
    public override string ToString() { return Name; }
}

internal sealed class PetWindow : Window
{
    [StructLayout(LayoutKind.Sequential)] private struct CursorPoint { public int X; public int Y; }
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out CursorPoint point);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    private static readonly string PreferencesFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexCLIProxyQuota", "desktop-preferences.json");
    private readonly Backend backend;
    private PetPreferences preferences;
    private readonly StackPanel cards = new StackPanel();
    private readonly ComboBox modelPicker = new ComboBox();
    private readonly TextBlock focus = Ui.Text("读取当前模型…", 11, Ui.Muted);
    private readonly TextBlock status = Ui.Text("等待连接", 10, Ui.Muted);
    private readonly TextBlock error = Ui.Text("", 11, Ui.Warning);
    private readonly TextBlock updateNotice = Ui.Text("", 10, Ui.Accent);
    private readonly DispatcherTimer updateTimer = new DispatcherTimer { Interval = TimeSpan.FromHours(6) };
    private object updateInfo;
    private bool checkingUpdates;
    private bool installingUpdate;
    private readonly DispatcherTimer focusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer refreshTimer = new DispatcherTimer { Interval = TimeSpan.FromMinutes(1) };
    private readonly DispatcherTimer appearanceTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
    private readonly Forms.NotifyIcon tray;
    private readonly System.Drawing.Icon applicationIcon;
    private readonly EventWaitHandle showSignal;
    private RegisteredWaitHandle showWait;
    private bool loading;
    private bool syncing;
    private bool loadingModels;
    private bool closing;
    private bool closingWithCodex;
    private bool allAccounts;
    private string selectedModel = "";
    private string lastViewKey;
    private bool dragging;
    private int openDialogs;
    private DateTime lastNear = DateTime.UtcNow;
    private double opacityTarget = -1;
    private string dockedHorizontal;
    private string dockedVertical;
    private bool manuallyHidden;
    private bool scopeHidden;
    private readonly List<Window> hiddenDialogs = new List<Window>();
    private readonly int panelProcessId = Process.GetCurrentProcess().Id;
    private int foregroundProcessId = -1;
    private bool codexForeground;

    internal PetWindow(Backend connection, EventWaitHandle signal, string previewTheme = null, Action ready = null)
    {
        backend = connection;
        showSignal = signal;
        preferences = previewTheme == null ? PetPreferences.Load(PreferencesFile) : new PetPreferences { Theme = previewTheme, AutoFade = false, DisplayScope = "all" };
        Ui.ApplyTheme(preferences.Theme);
        allAccounts = preferences.AllAccounts;
        Title = "额度与模型 · 桌面面板";
        using (var stream = typeof(PetWindow).Assembly.GetManifestResourceStream("QuotaPet.Icon"))
        using (var icon = new System.Drawing.Icon(stream, Forms.SystemInformation.SmallIconSize))
        {
            applicationIcon = (System.Drawing.Icon)icon.Clone();
        }
        Icon = Imaging.CreateBitmapSourceFromHIcon(applicationIcon.Handle, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
        Width = 250;
        SizeToContent = SizeToContent.Height;
        MaxHeight = Math.Min(660, SystemParameters.WorkArea.Height - 24);
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        AllowsTransparency = true;
        Background = Brushes.Transparent;
        ShowInTaskbar = false;
        ShowActivated = false;
        Topmost = preferences.Topmost;
        FontFamily = new FontFamily("Segoe UI");
        Foreground = Ui.Foreground;

        var body = new StackPanel();
        var header = new DockPanel { Margin = new Thickness(0, 0, 0, 7) };
        var actions = new StackPanel { Orientation = Orientation.Horizontal };
        actions.Children.Add(Ui.Button("↻", async delegate { await Refresh(true); }, "刷新额度"));
        actions.Children.Add(Ui.Button("−", HidePanel, "隐藏到托盘"));
        DockPanel.SetDock(actions, Dock.Right);
        header.Children.Add(actions);
        var title = Ui.Text("额度与模型", 12);
        title.FontWeight = FontWeights.SemiBold;
        title.Cursor = Cursors.SizeAll;
        title.MouseLeftButtonDown += DragPanel;
        header.Children.Add(title);
        body.Children.Add(header);
        modelPicker.FontSize = 11;
        modelPicker.Margin = new Thickness(0, 0, 0, 4);
        modelPicker.Height = 23;
        modelPicker.Items.Add(new ModelChoice { Id = "", Name = "跟随当前聊天模型" });
        modelPicker.SelectedIndex = 0;
        modelPicker.SelectionChanged += async delegate {
            if (loadingModels) return;
            selectedModel = ((ModelChoice)modelPicker.SelectedItem).Id;
            lastViewKey = null;
            await Sync();
        };
        body.Children.Add(modelPicker);
        focus.Margin = new Thickness(0, 0, 0, 7);
        body.Children.Add(focus);
        body.Children.Add(new ScrollViewer { Content = cards, MaxHeight = Math.Max(160, MaxHeight - 155), VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        error.TextWrapping = TextWrapping.Wrap;
        error.Margin = new Thickness(0, 5, 0, 3);
        error.Visibility = Visibility.Collapsed;
        body.Children.Add(error);
        var footer = new DockPanel { Margin = new Thickness(0, 5, 0, 0) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal };
        buttons.Children.Add(Ui.Button("模型", async delegate { await Models(); }));
        buttons.Children.Add(Ui.Button("设置", async delegate { await Settings(); }));
        DockPanel.SetDock(buttons, Dock.Right);
        footer.Children.Add(buttons);
        footer.Children.Add(status);
        body.Children.Add(footer);
        updateNotice.Visibility = Visibility.Collapsed;
        updateNotice.TextWrapping = TextWrapping.Wrap;
        updateNotice.Cursor = Cursors.Hand;
        updateNotice.Margin = new Thickness(0, 6, 0, 0);
        updateNotice.MouseLeftButtonUp += async delegate { await Settings(true); };
        body.Children.Add(updateNotice);
        Content = new Border { Background = Ui.Panel, BorderBrush = Ui.Edge, BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12), Padding = new Thickness(10), Child = body };

        tray = new Forms.NotifyIcon { Icon = applicationIcon, Text = "额度与模型", Visible = true };
        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("显示 / 隐藏", null, delegate { Dispatcher.BeginInvoke(new Action(ToggleVisible)); });
        menu.Items.Add("刷新额度", null, delegate { Dispatcher.BeginInvoke(new Action(async delegate { await Refresh(true); })); });
        menu.Items.Add("退出", null, delegate { Dispatcher.BeginInvoke(new Action(Close)); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { Dispatcher.BeginInvoke(new Action(ToggleVisible)); };
        showWait = ThreadPool.RegisterWaitForSingleObject(showSignal, delegate { Dispatcher.BeginInvoke(new Action(ShowPanel)); }, null, -1, false);
        Loaded += async delegate { PositionRight(); UpdateDisplayScope(); UpdateOpacity(); appearanceTimer.Start(); if (ready != null) ready(); if (backend != null) { await LoadModels(); await Refresh(false); focusTimer.Start(); } };
        Loaded += async delegate { if (backend != null) { await CheckUpdates(false); if (!closing) updateTimer.Start(); } };
        updateTimer.Tick += async delegate { await CheckUpdates(false); };
        appearanceTimer.Tick += delegate { UpdateDisplayScope(); UpdateOpacity(); };
        MouseEnter += delegate { lastNear = DateTime.UtcNow; UpdateOpacity(); };
        SizeChanged += delegate { if (IsLoaded && !dragging && preferences.SnapEdges) SnapToEdge(false); };
        focusTimer.Tick += async delegate { await Sync(); };
        refreshTimer.Tick += async delegate { await Refresh(false); };
        Closed += delegate { closing = true; Program.RecordRuntime(!closingWithCodex); focusTimer.Stop(); refreshTimer.Stop(); appearanceTimer.Stop(); updateTimer.Stop(); showWait.Unregister(null); tray.Visible = false; tray.Dispose(); applicationIcon.Dispose(); if (backend != null) backend.Dispose(); };
    }

    internal void CloseWithCodex()
    {
        if (closing) return;
        closingWithCodex = true;
        Close();
    }

    private void PositionRight()
    {
        var area = SystemParameters.WorkArea;
        Left = area.Right - ActualWidth - 12;
        Top = area.Top + Math.Max(12, (area.Height - ActualHeight) / 2);
        if (preferences.SnapEdges) SnapToEdge(true);
    }
    private void ToggleVisible() { if (IsVisible && !scopeHidden) HidePanel(); else ShowPanel(); }
    internal void HidePanel() { manuallyHidden = true; UpdateDisplayScope(); }
    internal void ShowPanel()
    {
        manuallyHidden = false;
        lastNear = DateTime.UtcNow;
        if (!IsVisible) Show();
        ApplyDisplayScope(false, true);
        UpdateOpacity();
        Activate();
    }
    private void Error(string message) { error.Text = message ?? ""; error.Visibility = String.IsNullOrEmpty(message) ? Visibility.Collapsed : Visibility.Visible; }

    private void DragPanel(object sender, MouseButtonEventArgs args)
    {
        if (args.ButtonState != MouseButtonState.Pressed) return;
        dragging = true;
        UpdateOpacity();
        dockedHorizontal = null;
        dockedVertical = null;
        try { DragMove(); }
        finally
        {
            dragging = false;
            lastNear = DateTime.UtcNow;
            if (preferences.SnapEdges) SnapToEdge(true);
            UpdateOpacity();
        }
    }

    private void SnapToEdge(bool detect)
    {
        var source = PresentationSource.FromVisual(this);
        if (source == null) return;
        var screen = Forms.Screen.FromHandle(new WindowInteropHelper(this).Handle).WorkingArea;
        var area = Rect.Transform(new Rect(screen.Left, screen.Top, screen.Width, screen.Height), source.CompositionTarget.TransformFromDevice);
        var target = PetBehavior.Snap(new Rect(Left, Top, ActualWidth, ActualHeight), area, detect ? 20 : 0);
        if (detect)
        {
            dockedHorizontal = Math.Abs(target.X - area.Left) < 0.5 ? "left" : Math.Abs(target.X + ActualWidth - area.Right) < 0.5 ? "right" : null;
            dockedVertical = Math.Abs(target.Y - area.Top) < 0.5 ? "top" : Math.Abs(target.Y + ActualHeight - area.Bottom) < 0.5 ? "bottom" : null;
        }
        if (dockedHorizontal == "right") target.X = Math.Max(area.Left, area.Right - ActualWidth);
        if (dockedVertical == "bottom") target.Y = Math.Max(area.Top, area.Bottom - ActualHeight);
        Left = target.X;
        Top = target.Y;
    }

    private void UpdateOpacity()
    {
        if (!IsVisible || scopeHidden) return;
        CursorPoint cursor;
        bool near = false;
        if (GetCursorPos(out cursor))
        {
            var point = PointFromScreen(new Point(cursor.X, cursor.Y));
            near = new Rect(-24, -24, ActualWidth + 48, ActualHeight + 48).Contains(point);
        }
        if (near || dragging || openDialogs > 0 || modelPicker.IsDropDownOpen) lastNear = DateTime.UtcNow;
        double target = PetBehavior.TargetOpacity(preferences, DateTime.UtcNow - lastNear);
        if (opacityTarget == target) return;
        opacityTarget = target;
        double previous = Opacity;
        BeginAnimation(OpacityProperty, null);
        Opacity = target;
        BeginAnimation(OpacityProperty, new DoubleAnimation(previous, target, TimeSpan.FromMilliseconds(180)) { FillBehavior = FillBehavior.Stop });
    }

    private void UpdateDisplayScope()
    {
        if (closing || !IsLoaded) return;
        uint id;
        GetWindowThreadProcessId(GetForegroundWindow(), out id);
        if (foregroundProcessId != (int)id)
        {
            foregroundProcessId = (int)id;
            codexForeground = id != 0 && CodexLifetime.IsCodexProcess((int)id);
        }
        ApplyDisplayScope(codexForeground, id == panelProcessId);
    }

    internal void ApplyDisplayScope(bool codexActive, bool panelActive)
    {
        if (closing || !IsVisible) return;
        bool visible = PetBehavior.ShouldShow(preferences.DisplayScope, manuallyHidden, codexActive, panelActive);
        if (visible == !scopeHidden) return;
        var handle = new WindowInteropHelper(this).Handle;
        if (visible)
        {
            scopeHidden = false;
            lastNear = DateTime.UtcNow;
            UpdateOpacity();
            ShowWindow(handle, 8);
            foreach (var dialog in hiddenDialogs)
                if (dialog.IsVisible) ShowWindow(new WindowInteropHelper(dialog).Handle, 8);
            hiddenDialogs.Clear();
        }
        else
        {
            modelPicker.IsDropDownOpen = false;
            hiddenDialogs.Clear();
            foreach (Window dialog in OwnedWindows)
            {
                var dialogHandle = new WindowInteropHelper(dialog).Handle;
                if (dialogHandle != IntPtr.Zero && IsWindowVisible(dialogHandle))
                {
                    hiddenDialogs.Add(dialog);
                    ShowWindow(dialogHandle, 0);
                }
            }
            scopeHidden = true;
            ShowWindow(handle, 0);
        }
    }

    private void PresentDialog(Window dialog)
    {
        openDialogs++;
        UpdateOpacity();
        try { dialog.ShowDialog(); }
        finally { openDialogs--; lastNear = DateTime.UtcNow; UpdateOpacity(); }
    }

    private async Task LoadModels()
    {
        try
        {
            var data = await backend.Call("list_models");
            loadingModels = true;
            modelPicker.Items.Clear();
            modelPicker.Items.Add(new ModelChoice { Id = "", Name = "跟随当前聊天模型" });
            foreach (var row in Data.Rows(Data.Get(data, "models")).Where(row => Object.Equals(Data.Get(row, "enabled"), true)))
                modelPicker.Items.Add(new ModelChoice { Id = Data.Text(row, "id"), Name = Data.Text(row, "name") });
            modelPicker.SelectedItem = modelPicker.Items.Cast<ModelChoice>().FirstOrDefault(item => item.Id == selectedModel) ?? modelPicker.Items[0];
            selectedModel = ((ModelChoice)modelPicker.SelectedItem).Id;
        }
        catch (Exception exception) { Error(exception.Message); }
        finally { loadingModels = false; }
    }

    private async Task Sync()
    {
        if (closing || syncing || backend == null) return;
        syncing = true;
        string model = selectedModel;
        try { var data = await backend.Call("pet_state", new { model }); if (!closing && model == selectedModel) Apply(data); }
        catch (Exception exception) { if (!closing) Error(exception.Message); }
        finally { syncing = false; }
    }

    private async Task Refresh(bool force)
    {
        if (closing || loading || backend == null) return;
        loading = true;
        status.Text = "正在查询…";
        string model = selectedModel;
        try
        {
            var data = await backend.Call("pet_refresh", new { model, refresh = force });
            if (!closing)
            {
                if (String.IsNullOrEmpty(Data.Text(data, "error"))) refreshTimer.Start();
                else refreshTimer.Stop();
            }
            if (!closing && model == selectedModel) Apply(data);
        }
        catch (Exception exception) { if (!closing) { refreshTimer.Stop(); Error(exception.Message); status.Text = "查询失败"; } }
        finally { loading = false; }
    }

    internal void Apply(object data)
    {
        string key = new JavaScriptSerializer().Serialize(data) + allAccounts;
        if (lastViewKey == key) return;
        lastViewKey = key;
        object model = Data.Get(data, "focus");
        string modelId = Data.Text(model, "id");
        focus.Text = String.IsNullOrEmpty(modelId) ? "当前模型暂不可用" : modelId;
        focus.ToolTip = Data.Text(model, "label") + "\n" + Data.Text(model, "warning");
        Error(Data.Text(data, "error"));
        DateTimeOffset fetched;
        status.Text = DateTimeOffset.TryParse(Data.Text(data, "fetchedAt"), out fetched) ? "更新 " + fetched.ToLocalTime().ToString("HH:mm") : "等待连接";
        if (!String.IsNullOrEmpty(Data.Text(data, "error"))) status.Text = "查询失败 · " + status.Text;
        cards.Children.Clear();
        var accounts = Data.Rows(Data.Get(data, "matching"));
        if (allAccounts) accounts = accounts.Concat(Data.Rows(Data.Get(data, "others")));
        foreach (var account in accounts) cards.Children.Add(Card(account));
        if (cards.Children.Count == 0)
        {
            var empty = Ui.Text("暂无已确认的匹配账户\n可在设置中查看全部账户", 12, Ui.Muted);
            empty.Margin = new Thickness(3, 15, 3, 15);
            cards.Children.Add(empty);
        }
    }

    private Border Card(object account)
    {
        var content = new StackPanel();
        var heading = new DockPanel();
        var provider = Ui.Text(Data.Text(account, "provider"), 10, Ui.Muted);
        DockPanel.SetDock(provider, Dock.Right);
        heading.Children.Add(provider);
        var supplier = Ui.Text(Data.Text(account, "supplier"), 12);
        supplier.FontWeight = FontWeights.SemiBold;
        supplier.ToolTip = Data.Text(account, "name");
        heading.Children.Add(supplier);
        content.Children.Add(heading);
        var grid = new Grid { Margin = new Thickness(0, 7, 0, 0) };
        var windows = Data.Rows(Data.Get(account, "windows")).Take(2).ToArray();
        if (windows.Length == 0)
        {
            var text = Ui.Text(Data.Text(account, "error") == "" ? "配额暂不可用" : Data.Text(account, "error"), 11, Ui.Muted);
            text.TextWrapping = TextWrapping.Wrap;
            grid.Children.Add(text);
        }
        for (int index = 0; index < windows.Length; index++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition());
            var row = windows[index];
            var column = new StackPanel { Margin = new Thickness(index == 0 ? 0 : 10, 0, 0, 0) };
            column.Children.Add(Ui.Text(Data.Text(row, "label"), 10, Ui.Muted));
            object value = Data.Get(row, "remainingPercent");
            double percent = value == null ? 0 : Convert.ToDouble(value);
            var brush = value != null && percent < 20 ? Ui.Warning : Ui.Accent;
            var number = Ui.Text(value == null ? "—" : percent.ToString("0") + "%", 21, brush);
            number.FontWeight = FontWeights.SemiBold;
            column.Children.Add(number);
            var track = new Grid { Height = 2, Background = Ui.Track, Margin = new Thickness(0, 2, 0, 5) };
            var fill = new Border { Background = brush, HorizontalAlignment = HorizontalAlignment.Left };
            track.SizeChanged += delegate { fill.Width = track.ActualWidth * Math.Max(0, Math.Min(100, percent)) / 100; };
            track.Children.Add(fill);
            column.Children.Add(track);
            DateTimeOffset reset;
            bool hasReset = DateTimeOffset.TryParse(Data.Text(row, "resetAt"), out reset);
            string resetText = "重置时间未知";
            string relative = "";
            if (hasReset)
            {
                reset = reset.ToLocalTime();
                resetText = reset.ToString(reset.Date == DateTime.Today ? "HH:mm" : "MM/dd HH:mm") + " 重置";
                double minutes = Math.Max(0, (reset - DateTimeOffset.Now).TotalMinutes);
                relative = minutes >= 1440 ? "约 " + (minutes / 1440).ToString("0.#") + " 天后" : minutes >= 60 ? "约 " + (minutes / 60).ToString("0.#") + " 小时后" : Math.Ceiling(minutes) + " 分钟后";
            }
            var resetLine = Ui.Text(resetText, 9, Ui.Muted);
            resetLine.ToolTip = hasReset ? reset.ToString("yyyy-MM-dd HH:mm:ss zzz") + "\n" + relative : resetText;
            column.Children.Add(resetLine);
            Grid.SetColumn(column, index);
            grid.Children.Add(column);
        }
        content.Children.Add(grid);
        return new Border { Background = Ui.Card, CornerRadius = new CornerRadius(8), Padding = new Thickness(9),
            Margin = new Thickness(0, 0, 0, 5), Child = content };
    }

    private void ApplyUpdateInfo(object value)
    {
        updateInfo = value;
        bool restart = Data.Get(value, "restartRequired") is bool && (bool)Data.Get(value, "restartRequired");
        bool available = Data.Get(value, "available") is bool && (bool)Data.Get(value, "available");
        updateNotice.Text = restart ? "已安装 " + Data.Text(value, "installedVersion") + " · 请重启 Codex"
            : available ? "发现新版 " + Data.Text(value, "latestVersion") + " · 点击查看" : "";
        updateNotice.Visibility = restart || available ? Visibility.Visible : Visibility.Collapsed;
    }

    private async Task CheckUpdates(bool force)
    {
        if (checkingUpdates || installingUpdate || closing) return;
        checkingUpdates = true;
        try { ApplyUpdateInfo(await backend.Call("check_updates", new { force })); }
        catch (Exception exception) { ApplyUpdateInfo(new Dictionary<string, object> { { "error", exception.Message } }); }
        finally { checkingUpdates = false; }
    }

    private async Task Settings(bool showUpdates = false)
    {
        try
        {
            var config = await backend.Call("get_console_settings");
            var dialog = Ui.Dialog(this, "面板设置", 570);
            var tabs = new TabControl { Background = Ui.Panel, Foreground = Ui.Foreground, BorderThickness = new Thickness(0) };
            var appearance = new StackPanel { Margin = new Thickness(16) };
            appearance.Children.Add(Ui.Text("背景颜色"));
            var theme = new ComboBox { ItemsSource = new[] { "深色", "白色" }, SelectedIndex = preferences.Theme == "light" ? 1 : 0, Margin = new Thickness(0, 5, 0, 16) };
            appearance.Children.Add(theme);
            var activeLabel = Ui.Text("显示不透明度", 11);
            appearance.Children.Add(activeLabel);
            var active = new Slider { Minimum = 0.4, Maximum = 1, Value = preferences.ActiveOpacity, TickFrequency = 0.05, IsSnapToTickEnabled = true, Margin = new Thickness(0, 7, 0, 15) };
            appearance.Children.Add(active);
            var fade = new CheckBox { Content = "鼠标远离后自动淡化", IsChecked = preferences.AutoFade, Foreground = Ui.Foreground, Margin = new Thickness(0, 0, 0, 10) };
            appearance.Children.Add(fade);
            var idleLabel = Ui.Text("远离时不透明度", 11);
            appearance.Children.Add(idleLabel);
            var idle = new Slider { Minimum = 0.05, Maximum = preferences.ActiveOpacity, Value = preferences.IdleOpacity, TickFrequency = 0.05, IsSnapToTickEnabled = true, IsEnabled = preferences.AutoFade, Margin = new Thickness(0, 7, 0, 16) };
            appearance.Children.Add(idle);
            Action opacityLabels = delegate {
                activeLabel.Text = "显示不透明度  " + active.Value.ToString("P0");
                idleLabel.Text = "远离时不透明度  " + idle.Value.ToString("P0");
            };
            active.ValueChanged += delegate { idle.Maximum = active.Value; opacityLabels(); };
            idle.ValueChanged += delegate { opacityLabels(); };
            fade.Click += delegate { idle.IsEnabled = fade.IsChecked == true; };
            opacityLabels();
            var snap = new CheckBox { Content = "拖动靠近屏幕边缘时吸附", IsChecked = preferences.SnapEdges, Foreground = Ui.Foreground, Margin = new Thickness(0, 0, 0, 12) };
            appearance.Children.Add(snap);
            var top = new CheckBox { Content = "始终置顶", IsChecked = Topmost, Foreground = Ui.Foreground, Margin = new Thickness(0, 0, 0, 12) };
            appearance.Children.Add(top);
            appearance.Children.Add(Ui.Text("显示范围", 11));
            var scope = new ComboBox { ItemsSource = new[] { "仅 Codex 窗口", "所有应用窗口" }, SelectedIndex = preferences.DisplayScope == "all" ? 1 : 0, Margin = new Thickness(0, 5, 0, 16) };
            appearance.Children.Add(scope);
            var all = new CheckBox { Content = "显示全部账户", IsChecked = allAccounts, Foreground = Ui.Foreground, Margin = new Thickness(0, 0, 0, 16) };
            appearance.Children.Add(all);
            var autoStart = new CheckBox { Content = "随 Codex 启动悬浮窗", IsChecked = preferences.AutoStart, Foreground = Ui.Foreground, Margin = new Thickness(0, 0, 0, 16) };
            appearance.Children.Add(autoStart);
            var appearanceMessage = Ui.Text("鼠标靠近约 24 像素时恢复显示，远离后约 0.7 秒淡化。", 11, Ui.Muted);
            appearanceMessage.TextWrapping = TextWrapping.Wrap;
            appearance.Children.Add(Ui.Button("保存外观", async delegate {
                try
                {
                    var next = new PetPreferences { Theme = theme.SelectedIndex == 1 ? "light" : "dark", ActiveOpacity = active.Value,
                        IdleOpacity = idle.Value, AutoFade = fade.IsChecked == true, SnapEdges = snap.IsChecked == true,
                        Topmost = top.IsChecked == true, AllAccounts = all.IsChecked == true, AutoStart = autoStart.IsChecked == true,
                        DisplayScope = scope.SelectedIndex == 1 ? "all" : "codex" };
                    next.Save(PreferencesFile);
                    preferences = next;
                    Ui.ApplyTheme(next.Theme);
                    Topmost = next.Topmost;
                    allAccounts = next.AllAccounts;
                    lastViewKey = null;
                    if (preferences.SnapEdges) SnapToEdge(true);
                    dialog.Close();
                    UpdateDisplayScope();
                    await Sync();
                }
                catch (Exception exception) { appearanceMessage.Text = "外观保存失败。" + exception.Message; }
            }));
            appearance.Children.Add(appearanceMessage);
            tabs.Items.Add(Ui.Tab("外观", new ScrollViewer { Content = appearance, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }));
            var body = new StackPanel { Margin = new Thickness(20) };
            body.Children.Add(Ui.Text("管理后台"));
            var address = Ui.Input(Data.Text(config, "baseUrl")); body.Children.Add(address);
            body.Children.Add(Ui.Text("管理接口"));
            var version = new ComboBox { ItemsSource = new[] { "v8", "v0" }, SelectedItem = Data.Text(config, "apiVersion"), Margin = new Thickness(0, 4, 0, 12) }; body.Children.Add(version);
            body.Children.Add(Ui.Text("管理密钥 · 留空沿用已保存密钥", 11, Ui.Muted));
            var key = new PasswordBox { Padding = new Thickness(7), Margin = new Thickness(0, 4, 0, 15) }; body.Children.Add(key);
            var message = Ui.Text("密钥由 Windows 当前用户加密保存", 11, Ui.Muted); message.TextWrapping = TextWrapping.Wrap;
            var save = Ui.Button("保存", async delegate {
                try {
                    await backend.Call("save_console_settings", new { baseUrl = address.Text.Trim(), apiVersion = Convert.ToString(version.SelectedItem), managementKey = key.Password });
                    key.Clear(); lastViewKey = null;
                    dialog.Close(); await Refresh(true);
                } catch (Exception exception) { message.Text = exception.Message; }
            });
            body.Children.Add(save); body.Children.Add(message);
            var diagnostics = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, Height = 130,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Ui.Card, Foreground = Ui.Foreground,
                BorderBrush = Ui.Edge, Padding = new Thickness(8), Margin = new Thickness(0, 10, 0, 0),
                Text = "使用已保存的管理地址和密钥测试连接。测试结果可选择复制。" };
            var testConnection = Ui.Button("测试已保存连接", delegate { });
            testConnection.Margin = new Thickness(0, 12, 0, 0);
            testConnection.Click += async delegate {
                testConnection.IsEnabled = false; diagnostics.Text = "正在测试管理接口…";
                try {
                    var result = await backend.Call("test_management_connection");
                    bool connected = Object.Equals(Data.Get(result, "connected"), true);
                    diagnostics.Text = (connected ? Data.Text(result, "message") : Data.Text(result, "error"))
                        + "\n接口 " + Data.Text(result, "endpoint") + "\n耗时 " + Data.Text(result, "elapsedMs")
                        + " ms\n运行时 " + Data.Text(result, "runtime");
                }
                catch (Exception exception) { diagnostics.Text = exception.Message; }
                finally { testConnection.IsEnabled = true; }
            };
            body.Children.Add(testConnection); body.Children.Add(diagnostics);
            tabs.Items.Add(Ui.Tab("连接", new ScrollViewer { Content = body, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }));
            var updates = new StackPanel { Margin = new Thickness(20) };
            updates.Children.Add(Ui.Text("CPA Quota for Codex", 16));
            var versions = Ui.Text("当前版本 " + Data.Text(config, "backendVersion"), 12);
            versions.Margin = new Thickness(0, 12, 0, 8);
            updates.Children.Add(versions);
            var updateMessage = Ui.Text("启动时自动检查，每 24 小时最多检查一次。", 11, Ui.Muted);
            updateMessage.TextWrapping = TextWrapping.Wrap;
            updates.Children.Add(updateMessage);
            var notes = new TextBox { IsReadOnly = true, TextWrapping = TextWrapping.Wrap, Height = 140,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Background = Ui.Card, Foreground = Ui.Foreground,
                BorderBrush = Ui.Edge, Padding = new Thickness(8), Margin = new Thickness(0, 12, 0, 12) };
            updates.Children.Add(notes);
            var checkUpdate = Ui.Button("检查更新", delegate { });
            var installUpdate = Ui.Button("下载并安装更新", delegate { });
            var releasePage = Ui.Button("GitHub 发布页", delegate {
                Process.Start(new ProcessStartInfo("https://github.com/hangsecret/cpa-quota-for-codex/releases") { UseShellExecute = true });
            });
            Action renderUpdates = delegate {
                var value = updateInfo;
                versions.Text = "当前版本 " + Data.Text(config, "backendVersion") + "    最新版本 "
                    + (String.IsNullOrEmpty(Data.Text(value, "latestVersion")) ? "尚未检查" : Data.Text(value, "latestVersion"));
                notes.Text = Data.Text(value, "notes");
                string checkedAt = Data.Text(value, "checkedAt");
                DateTimeOffset checkedTime;
                string time = DateTimeOffset.TryParse(checkedAt, out checkedTime) ? "上次检查 " + checkedTime.ToLocalTime().ToString("MM/dd HH:mm") : "启动时自动检查，每 24 小时最多检查一次。";
                bool restart = Data.Get(value, "restartRequired") is bool && (bool)Data.Get(value, "restartRequired");
                bool available = Data.Get(value, "available") is bool && (bool)Data.Get(value, "available");
                string updateError = Data.Text(value, "error");
                updateMessage.Text = restart ? "已安装 " + Data.Text(value, "installedVersion") + "，请完全退出并重启 Codex。"
                    : !String.IsNullOrEmpty(updateError) ? updateError : available ? "发现新版本。" + time
                    : !String.IsNullOrEmpty(Data.Text(value, "latestVersion")) ? "已是最新版本。" + time : time;
                installUpdate.IsEnabled = available && !restart && String.IsNullOrEmpty(updateError) && !installingUpdate;
            };
            checkUpdate.Click += async delegate {
                checkUpdate.IsEnabled = false; installUpdate.IsEnabled = false; updateMessage.Text = "正在检查更新…";
                try { ApplyUpdateInfo(await backend.Call("check_updates", new { force = true })); renderUpdates(); }
                catch (Exception exception) { updateMessage.Text = exception.Message; }
                finally { checkUpdate.IsEnabled = true; }
            };
            installUpdate.Click += async delegate {
                if (installingUpdate) return;
                installingUpdate = true; checkUpdate.IsEnabled = false; installUpdate.IsEnabled = false;
                updateMessage.Text = "正在下载、校验并安装，请稍候…";
                try {
                    ApplyUpdateInfo(await backend.Call("install_update", new { version = Data.Text(updateInfo, "latestVersion") }));
                    renderUpdates();
                }
                catch (Exception exception) { updateMessage.Text = exception.Message; installUpdate.IsEnabled = true; }
                finally { installingUpdate = false; checkUpdate.IsEnabled = true; }
            };
            updates.Children.Add(checkUpdate); updates.Children.Add(installUpdate); updates.Children.Add(releasePage);
            var updateHint = Ui.Text("更新使用 GitHub Release 安装包和 SHA256 校验。更新后采用本地 Release 安装源，后续可在这里继续升级。连接密钥与外观设置保存在用户数据目录。", 11, Ui.Muted);
            updateHint.TextWrapping = TextWrapping.Wrap; updateHint.Margin = new Thickness(0, 12, 0, 0);
            updates.Children.Add(updateHint);
            renderUpdates();
            tabs.Items.Add(Ui.Tab("关于与更新", new ScrollViewer { Content = updates, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }));
            if (showUpdates) tabs.SelectedIndex = 2;
            dialog.Content = tabs; PresentDialog(dialog);
        }
        catch (Exception exception) { Error(exception.Message); }
    }

    private async Task Models()
    {
        try
        {
            var dialog = Ui.Dialog(this, "模型管理", 590);
            var body = new DockPanel { Margin = new Thickness(16) };
            var header = new StackPanel();
            var toolbar = new DockPanel { Margin = new Thickness(0, 0, 0, 8) };
            var fetch = Ui.Button("拉取模型", delegate { });
            DockPanel.SetDock(fetch, Dock.Right); toolbar.Children.Add(fetch);
            toolbar.Children.Add(Ui.Text("中转站模型", 13));
            header.Children.Add(toolbar);
            var search = Ui.Input();
            search.ToolTip = "搜索模型名称或 ID";
            header.Children.Add(search);
            DockPanel.SetDock(header, Dock.Top);
            body.Children.Add(header);
            var bottom = new StackPanel();
            var manual = new StackPanel { Margin = new Thickness(0, 8, 0, 8) };
            manual.Children.Add(Ui.Text("模型 ID", 11, Ui.Muted));
            var id = Ui.Input(); manual.Children.Add(id);
            manual.Children.Add(Ui.Text("显示名称（选填）", 11, Ui.Muted));
            var name = Ui.Input(); manual.Children.Add(name);
            var message = Ui.Text("勾选添加或启用模型，取消勾选隐藏；重启 Codex 生效。", 11, Ui.Muted); message.TextWrapping = TextWrapping.Wrap;
            var list = new StackPanel();
            var offered = new List<object>();
            object modelState = null;
            Action<object> render = null;
            render = state => {
                modelState = state;
                list.Children.Clear();
                var configured = Data.Rows(Data.Get(state, "models")).ToList();
                var known = new HashSet<string>(configured.Select(row => Data.Text(row, "id")), StringComparer.Ordinal);
                var rows = configured.Concat(offered.Where(row => !known.Contains(Data.Text(row, "id"))));
                foreach (var row in rows.Where(row =>
                    (Data.Text(row, "id") + " " + Data.Text(row, "name")).IndexOf(search.Text, StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    string modelId = Data.Text(row, "id");
                    string modelName = Data.Text(row, "name");
                    bool exists = known.Contains(modelId);
                    var label = Ui.Text(modelName + (exists ? "" : " · 待添加"), 11);
                    label.TextWrapping = TextWrapping.Wrap;
                    var toggle = new CheckBox { Content = label, ToolTip = modelId, IsChecked = Object.Equals(Data.Get(row, "enabled"), true),
                        IsEnabled = !Object.Equals(Data.Get(row, "current"), true), Foreground = Ui.Foreground, Margin = new Thickness(0, 6, 0, 6), MaxWidth = 320 };
                    toggle.Click += async delegate {
                        list.IsEnabled = false;
                        try {
                            string action = toggle.IsChecked == true ? (exists ? "enable" : "add") : "disable";
                            render(await backend.Call("update_model", new { action, id = modelId, name = modelName }));
                            message.Text = "已保存模型菜单，请重启 Codex 生效。";
                            await LoadModels();
                        }
                        catch (Exception exception) { toggle.IsChecked = !toggle.IsChecked; message.Text = exception.Message; }
                        finally { list.IsEnabled = true; }
                    };
                    list.Children.Add(toggle);
                }
            };
            search.TextChanged += delegate { if (modelState != null) render(modelState); };
            manual.Children.Add(Ui.Button("添加到菜单", async delegate {
                try { render(await backend.Call("update_model", new { action = "add", id = id.Text.Trim(), name = name.Text.Trim() })); id.Clear(); name.Clear(); await LoadModels(); }
                catch (Exception exception) { message.Text = exception.Message; }
            }));
            bottom.Children.Add(new Expander { Header = "手动添加模型", Content = manual, Foreground = Ui.Foreground, Margin = new Thickness(0, 10, 0, 8) });
            var fetched = Ui.Text("", 10, Ui.Muted); fetched.TextWrapping = TextWrapping.Wrap;
            bottom.Children.Add(fetched);
            bottom.Children.Add(message); DockPanel.SetDock(bottom, Dock.Bottom); body.Children.Add(bottom);
            body.Children.Add(new ScrollViewer { Content = list, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
            bool pulling = false;
            Func<Task> pull = async delegate {
                if (pulling) return;
                pulling = true; fetch.IsEnabled = false; fetched.Text = "正在从中转站拉取公共模型…";
                try {
                    var remote = await backend.Call("fetch_models");
                    offered = Data.Rows(Data.Get(remote, "models")).ToList();
                    render(modelState);
                    fetched.Text = "已拉取 " + offered.Count + " 个模型，已合并可匹配的账号前缀重复项。";
                    fetched.ToolTip = Data.Text(remote, "source");
                }
                catch (Exception exception) { fetched.Text = "拉取失败。" + exception.Message; }
                finally { pulling = false; fetch.IsEnabled = true; }
            };
            fetch.Click += async delegate { await pull(); };
            dialog.Loaded += async delegate { await pull(); };
            render(await backend.Call("list_models")); dialog.Content = body; PresentDialog(dialog);
        }
        catch (Exception exception) { Error(exception.Message); }
    }
}

internal static class Program
{
    private static string QuoteArgument(string value)
    {
        var result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { backslashes++; continue; }
            if (character == '"') result.Append('\\', backslashes * 2 + 1);
            else result.Append('\\', backslashes);
            result.Append(character);
            backslashes = 0;
        }
        return result.Append('\\', backslashes * 2).Append('"').ToString();
    }
    private static int LaunchThroughDesktop(string[] args)
    {
        dynamic windows = null;
        dynamic desktop = null;
        dynamic document = null;
        dynamic shell = null;
        try
        {
            windows = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("9BA05972-F6A8-11CF-A442-00A0C90A8F39")));
            object location = 0;
            object root = 0;
            int desktopHandle;
            desktop = windows.FindWindowSW(ref location, ref root, 8, out desktopHandle, 1);
            if (desktop == null) throw new InvalidOperationException("Windows 桌面暂未就绪，请稍后重试。");
            document = desktop.Document;
            shell = document.Application;
            string executable = Process.GetCurrentProcess().MainModule.FileName;
            var forwarded = args.Where(value => value != "--shell-launch").ToList();
            var owner = CodexLifetime.Resolve();
            if (owner != null)
            {
                forwarded.Add("--codex-pid"); forwarded.Add(owner.Id.ToString(CultureInfo.InvariantCulture));
                forwarded.Add("--codex-start"); forwarded.Add(owner.StartedUtcTicks.ToString(CultureInfo.InvariantCulture));
            }
            else if (args.Contains("--background-start")) return 1;
            string arguments = String.Join(" ", forwarded.Select(QuoteArgument));
            shell.ShellExecute(executable, arguments, Path.GetDirectoryName(executable), "open", 1);
            return 0;
        }
        catch (Exception exception)
        {
            try { WriteJson(Path.Combine(DataDirectory, "desktop-startup-error.json"), new { time = DateTimeOffset.Now, error = exception.ToString() }); } catch (IOException) { }
            return 1;
        }
        finally
        {
            if (shell != null) Marshal.FinalReleaseComObject(shell);
            if (document != null) Marshal.FinalReleaseComObject(document);
            if (desktop != null) Marshal.FinalReleaseComObject(desktop);
            if (windows != null) Marshal.FinalReleaseComObject(windows);
        }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    private static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexCLIProxyQuota");
    private static bool trackingRuntime;
    private static CodexOwner runtimeOwner;
    internal static void RecordRuntime(bool closedByUser)
    {
        if (!trackingRuntime) return;
        try { WriteJson(Path.Combine(DataDirectory, "desktop-runtime.json"), new { pid = Process.GetCurrentProcess().Id, closedByUser,
            codexPid = runtimeOwner == null ? 0 : runtimeOwner.Id, codexStartedUtcTicks = runtimeOwner == null ? 0 : runtimeOwner.StartedUtcTicks }); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
    private static void WriteJson(string path, object value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value));
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static void Acknowledge(string[] args, int pid)
    {
        string file = Argument(args, "--ack");
        if (file != null) WriteJson(file, new { pid, launchId = Argument(args, "--launch-id") });
    }
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Contains("--shell-launch")) return LaunchThroughDesktop(args);
        string identity = "Local\\CodexQuotaPet-" + System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
        bool created;
        using (var signal = new EventWaitHandle(false, EventResetMode.AutoReset, identity + "-show"))
        using (var mutex = new Mutex(true, identity, out created))
        {
            if (!created)
            {
                if (!args.Contains("--background-start")) signal.Set();
                if (Argument(args, "--ack") == null) return 0;
                for (int attempt = 0; attempt < 60; attempt++)
                {
                    var existing = FindWindow(null, "额度与模型 · 桌面面板");
                    if (existing != IntPtr.Zero)
                    {
                        uint pid; GetWindowThreadProcessId(existing, out pid);
                        Acknowledge(args, (int)pid);
                        return 0;
                    }
                    Thread.Sleep(50);
                }
                return 1;
            }
            try
            {
                string node = Argument(args, "--node");
                string script = Argument(args, "--bridge");
                string preview = Argument(args, "--preview");
                var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
                Backend backend = preview == null ? new Backend(node, script) : null;
                trackingRuntime = preview == null;
                int ownerId;
                long ownerStarted;
                runtimeOwner = preview != null ? null : Int32.TryParse(Argument(args, "--codex-pid"), out ownerId)
                    && Int64.TryParse(Argument(args, "--codex-start"), out ownerStarted)
                    ? new CodexOwner { Id = ownerId, StartedUtcTicks = ownerStarted } : CodexLifetime.Resolve();
                var window = new PetWindow(backend, signal, preview == null ? null : Argument(args, "--theme") ?? "dark", delegate {
                    if (preview != null) return;
                    RecordRuntime(false);
                    Acknowledge(args, Process.GetCurrentProcess().Id);
                });
                CodexLifetime lifetime = null;
                if (preview == null)
                {
                    window.Loaded += delegate {
                        lifetime = new CodexLifetime(runtimeOwner, delegate { window.Dispatcher.BeginInvoke(new Action(window.CloseWithCodex)); });
                    };
                    window.Closed += delegate { if (lifetime != null) lifetime.Dispose(); };
                }
                if (preview != null)
                {
                    string fixture = Argument(args, "--fixture");
                    window.Loaded += delegate {
                        window.Apply(new JavaScriptSerializer().DeserializeObject(File.ReadAllText(fixture)));
                        window.UpdateLayout();
                        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(window.ActualWidth), (int)Math.Ceiling(window.ActualHeight), 96, 96, PixelFormats.Pbgra32);
                        bitmap.Render(window);
                        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap));
                        using (var file = File.Create(preview)) encoder.Save(file);
                        window.Close();
                    };
                }
                app.Run(window);
                return 0;
            }
            catch (Exception exception)
            {
                try { WriteJson(Path.Combine(DataDirectory, "desktop-startup-error.json"), new { time = DateTimeOffset.Now, error = exception.ToString() }); } catch (IOException) { }
                if (!args.Contains("--background-start")) System.Windows.MessageBox.Show(exception.Message, "额度与模型", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
        }
    }
    private static string Argument(string[] args, string name) { int index = Array.IndexOf(args, name); return index >= 0 && index + 1 < args.Length ? args[index + 1] : null; }
}
