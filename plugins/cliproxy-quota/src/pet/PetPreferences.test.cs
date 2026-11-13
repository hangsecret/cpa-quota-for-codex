using System;
using System.IO;
using System.Windows;

internal static class PetPreferencesTests
{
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }

    [STAThread]
    private static int Main()
    {
        string directory = Path.Combine(Path.GetTempPath(), "quota-prefs-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        string file = Path.Combine(directory, "preferences.json");
        try
        {
            var defaults = PetPreferences.Load(file);
            Check(defaults.Theme == "dark" && defaults.ActiveOpacity == 1 && defaults.IdleOpacity == 0.15, "Missing-file defaults");
            Check(defaults.DisplayScope == "codex", "Default display is scoped to Codex");
            Check(!PetBehavior.ShouldShow("codex", false, false, false), "Other applications hide the panel");
            Check(PetBehavior.ShouldShow("codex", false, true, false), "Codex foreground restores the panel");
            Check(PetBehavior.ShouldShow("codex", false, false, true), "Panel and its dialogs remain interactive");
            Check(PetBehavior.ShouldShow("all", false, false, false), "All-app scope keeps panel visible");
            Check(!PetBehavior.ShouldShow("codex", true, true, false), "Switching back does not undo manual hiding");
            Check(!PetBehavior.ShouldShow("all", true, false, true), "Manual hiding also works in all-app mode");
            Check(PetBehavior.TargetOpacity(defaults, TimeSpan.Zero) == 1, "Approach restores active opacity");
            Check(PetBehavior.TargetOpacity(defaults, TimeSpan.FromMilliseconds(650)) == 1, "Brief departure keeps visible");
            Check(PetBehavior.TargetOpacity(defaults, TimeSpan.FromMilliseconds(900)) == 0.15, "Departure fades to idle opacity");
            defaults.AutoFade = false;
            Check(PetBehavior.TargetOpacity(defaults, TimeSpan.FromHours(1)) == 1, "Fade can be disabled");
            File.WriteAllText(file, "{\"Theme\":\"light\"}");
            var partial = PetPreferences.Load(file);
            Check(partial.Theme == "light" && partial.ActiveOpacity == 1 && partial.SnapEdges && partial.AutoStart && partial.DisplayScope == "codex", "Older settings preserve new defaults");
            partial.ActiveOpacity = 0.7; partial.IdleOpacity = 0.2; partial.AutoFade = false; partial.Topmost = false; partial.AutoStart = false; partial.DisplayScope = "all";
            partial.Save(file);
            var saved = PetPreferences.Load(file);
            Check(saved.Theme == "light" && saved.ActiveOpacity == 0.7 && saved.IdleOpacity == 0.2 && !saved.AutoFade && !saved.Topmost && !saved.AutoStart && saved.DisplayScope == "all", "Preferences survive restart");
            saved.IdleOpacity = 0.9; saved.ActiveOpacity = 0.4; saved.Save(file);
            Check(PetPreferences.Load(file).IdleOpacity == 0.4, "Idle opacity cannot exceed active opacity");
            saved.Theme = "unsupported"; saved.ActiveOpacity = Double.NaN; saved.IdleOpacity = -1; saved.Normalize();
            Check(saved.Theme == "dark" && saved.ActiveOpacity == 1 && saved.IdleOpacity == 0.05, "Invalid values normalize");
            File.WriteAllText(file, "invalid json");
            Check(PetPreferences.Load(file).IdleOpacity == 0.15, "Malformed settings recover");
            var area = new Rect(0, 0, 1920, 1040);
            Check(PetBehavior.Snap(new Rect(1655, 200, 250, 347), area, 20) == new Point(1670, 200), "Right edge snaps");
            Check(PetBehavior.Snap(new Rect(15, 18, 250, 347), area, 20) == new Point(0, 0), "Top-left corner snaps");
            Check(PetBehavior.Snap(new Rect(500, 680, 250, 347), area, 20) == new Point(500, 693), "Bottom edge uses working area");
            Check(PetBehavior.Snap(new Rect(500, 250, 250, 347), area, 20) == new Point(500, 250), "Middle position stays draggable");
            Check(PetBehavior.Snap(new Rect(-1910, 210, 250, 347), new Rect(-1920, 0, 1920, 1040), 20) == new Point(-1920, 210), "Negative-coordinate display snaps");
            Check(PetBehavior.Snap(new Rect(1900, 1000, 250, 347), area, 20) == new Point(1670, 693), "Offscreen drop clamps");
            Check(PetBehavior.RefreshDelay(false, false, 0) == TimeSpan.FromMinutes(1), "Successful refresh uses the normal interval");
            Check(PetBehavior.RefreshDelay(true, false, 1) == null, "Authentication and configuration failures stop polling");
            Check(PetBehavior.RefreshDelay(true, true, 1) == TimeSpan.FromMinutes(1), "First transient failure retries after one minute");
            Check(PetBehavior.RefreshDelay(true, true, 2) == TimeSpan.FromMinutes(2), "Second failure backs off to two minutes");
            Check(PetBehavior.RefreshDelay(true, true, 3) == TimeSpan.FromMinutes(5), "Repeated failures back off to five minutes");
            Check(PetBehavior.RefreshDelay(true, true, 100) == TimeSpan.FromMinutes(5), "Retry delay stays capped");
            Console.WriteLine("29 preference, opacity, visibility, retry and snapping checks passed");
            return 0;
        }
        finally { Directory.Delete(directory, true); }
    }
}
