using System;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows;

internal sealed class PetPreferences
{
    public string Theme { get; set; }
    public double ActiveOpacity { get; set; }
    public double IdleOpacity { get; set; }
    public bool AutoFade { get; set; }
    public bool SnapEdges { get; set; }
    public bool Topmost { get; set; }
    public bool AllAccounts { get; set; }
    public bool AutoStart { get; set; }
    public string DisplayScope { get; set; }

    public PetPreferences()
    {
        Theme = "dark";
        ActiveOpacity = 1;
        IdleOpacity = 0.15;
        AutoFade = true;
        SnapEdges = true;
        Topmost = true;
        AutoStart = true;
        DisplayScope = "codex";
    }

    internal void Normalize()
    {
        if (Theme != "light") Theme = "dark";
        if (DisplayScope != "all") DisplayScope = "codex";
        ActiveOpacity = ValidOpacity(ActiveOpacity, 1, 0.4);
        IdleOpacity = Math.Min(ActiveOpacity, ValidOpacity(IdleOpacity, 0.15, 0.05));
    }

    private static double ValidOpacity(double value, double fallback, double minimum)
    {
        return Double.IsNaN(value) || Double.IsInfinity(value) ? fallback : Math.Max(minimum, Math.Min(1, value));
    }

    internal static PetPreferences Load(string file)
    {
        try
        {
            var result = new JavaScriptSerializer().Deserialize<PetPreferences>(File.ReadAllText(file));
            if (result == null) return new PetPreferences();
            result.Normalize();
            return result;
        }
        catch (IOException) { return new PetPreferences(); }
        catch (UnauthorizedAccessException) { return new PetPreferences(); }
        catch (ArgumentException) { return new PetPreferences(); }
        catch (InvalidOperationException) { return new PetPreferences(); }
    }

    internal void Save(string file)
    {
        Normalize();
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(this));
            if (File.Exists(file)) File.Replace(temporary, file, null);
            else File.Move(temporary, file);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

internal static class PetBehavior
{
    internal static bool ShouldShow(string scope, bool manuallyHidden, bool codexForeground, bool panelForeground)
    {
        return !manuallyHidden && (scope == "all" || codexForeground || panelForeground);
    }

    internal static double TargetOpacity(PetPreferences preferences, TimeSpan timeAway)
    {
        return preferences.AutoFade && timeAway > TimeSpan.FromMilliseconds(650) ? preferences.IdleOpacity : preferences.ActiveOpacity;
    }

    internal static Point Snap(Rect window, Rect workArea, double threshold)
    {
        double right = Math.Max(workArea.Left, workArea.Right - window.Width);
        double bottom = Math.Max(workArea.Top, workArea.Bottom - window.Height);
        double left = Math.Max(workArea.Left, Math.Min(right, window.Left));
        double top = Math.Max(workArea.Top, Math.Min(bottom, window.Top));
        if (Math.Abs(left - workArea.Left) <= threshold) left = workArea.Left;
        else if (Math.Abs(left - right) <= threshold) left = right;
        if (Math.Abs(top - workArea.Top) <= threshold) top = workArea.Top;
        else if (Math.Abs(top - bottom) <= threshold) top = bottom;
        return new Point(left, top);
    }
}
